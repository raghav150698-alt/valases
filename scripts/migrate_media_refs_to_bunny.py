from __future__ import annotations

import argparse
import http.client
import mimetypes
import re
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

try:
    import boto3
except ImportError:  # pragma: no cover
    boto3 = None
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.db.session import engine
from app.models.entities import Base, Certificate, Course, Lesson, ProctorEvidence, ProviderCourseDraft, ProviderDocument, VideoUploadSession

S3_RE = re.compile(r"^s3://(?P<bucket>[^/]+)/(?P<key>.+)$", re.IGNORECASE)


class MigrationSpec:
    def __init__(self, label: str, model, column: str, object_prefix: str):
        self.label = label
        self.model = model
        self.column = column
        self.object_prefix = object_prefix.strip("/")


SPECS = [
    MigrationSpec("courses.thumbnail_url", Course, "thumbnail_url", "course-thumbnails/migrated"),
    MigrationSpec("provider_course_drafts.thumbnail_url", ProviderCourseDraft, "thumbnail_url", "course-thumbnails/drafts-migrated"),
    MigrationSpec("lessons.recorded_video_url", Lesson, "recorded_video_url", "videos/migrated"),
    MigrationSpec("certificates.pdf_url", Certificate, "pdf_url", "certificates/migrated"),
    MigrationSpec("provider_documents.file_url", ProviderDocument, "file_url", "provider-documents/migrated"),
    MigrationSpec("video_upload_sessions.file_url", VideoUploadSession, "file_url", "videos/upload-sessions-migrated"),
    MigrationSpec("proctor_evidence.file_url", ProctorEvidence, "file_url", "proctor-evidence/migrated"),
]


def _sanitize_filename(name: str, *, fallback_ext: str = ".bin") -> str:
    clean = re.sub(r"[^A-Za-z0-9._-]", "_", (name or "").strip())
    if not clean:
        clean = f"asset{fallback_ext}"
    if "." not in clean:
        clean = f"{clean}{fallback_ext}"
    return clean[:200]


def _should_migrate(value: str | None) -> bool:
    raw = str(value or "").strip()
    if not raw:
        return False
    low = raw.lower()
    if low.startswith("bunny://"):
        return False
    if low.startswith("data:"):
        return False
    if low.startswith("s3://"):
        return True
    if raw.startswith("/media/"):
        return True
    if low.startswith("http://") or low.startswith("https://"):
        p = urlparse(raw)
        host = (p.hostname or "").lower()
        return host in {"localhost", "127.0.0.1"} and p.path.startswith("/media/")
    if "://" not in raw:
        return True
    return False


def _s3_client():
    if boto3 is None:
        raise RuntimeError("boto3 is required to migrate s3:// references.")
    settings = get_settings()
    kwargs = {}
    if settings.aws_region:
        kwargs["region_name"] = settings.aws_region
    if settings.aws_access_key_id and settings.aws_secret_access_key:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    return boto3.client("s3", **kwargs)


def _human_bytes(size: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(max(0, int(size)))
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024.0
        idx += 1
    return f"{value:.1f}{units[idx]}"


def _print_progress(prefix: str, sent: int, total: int, started_at: float, width: int = 28, force: bool = False):
    now = time.time()
    elapsed = max(0.001, now - started_at)
    pct = 100.0 if total <= 0 else min(100.0, (float(sent) / float(total)) * 100.0)
    filled = width if total <= 0 else int((float(sent) / float(total)) * width)
    bar = "#" * filled + "-" * max(0, width - filled)
    speed = sent / elapsed
    line = (
        f"\r{prefix} [{bar}] {pct:6.2f}% "
        f"{_human_bytes(sent)}/{_human_bytes(total)} { _human_bytes(int(speed)) }/s"
    )
    if force:
        print(line)
    else:
        print(line, end="", flush=True)


def _resolve_source_to_local_path(value: str, *, media_root: Path, s3, temp_dir: Path) -> tuple[Path, str, bool]:
    raw = str(value or "").strip()
    if raw.startswith("/media/"):
        rel = raw.removeprefix("/media/").lstrip("/")
        path = media_root / rel
        if not path.exists():
            raise FileNotFoundError(f"Local file not found: {path}")
        return path, path.name, False

    if raw.lower().startswith("http://") or raw.lower().startswith("https://"):
        p = urlparse(raw)
        host = (p.hostname or "").lower()
        if host in {"localhost", "127.0.0.1"} and p.path.startswith("/media/"):
            rel = p.path.removeprefix("/media/").lstrip("/")
            path = media_root / rel
            if not path.exists():
                raise FileNotFoundError(f"Local file not found: {path}")
            return path, path.name, False
        raise ValueError(f"Unsupported URL source: {raw}")

    m = S3_RE.match(raw)
    if m:
        bucket = m.group("bucket")
        key = m.group("key")
        filename = Path(key).name or "asset.bin"
        suffix = Path(filename).suffix or ".bin"
        fd, tmp_name = tempfile.mkstemp(prefix="bunny_src_", suffix=suffix, dir=str(temp_dir))
        tmp_path = Path(tmp_name)
        with open(fd, "wb", closefd=True) as out:
            obj = s3.get_object(Bucket=bucket, Key=key)
            stream = obj["Body"]
            while True:
                chunk = stream.read(8 * 1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        return tmp_path, filename, True

    if "://" not in raw:
        rel_path = Path(raw.strip("/\\"))
        path = media_root / rel_path
        if not path.exists():
            raise FileNotFoundError(f"Relative local file not found: {path}")
        return path, path.name, False

    raise ValueError(f"Unsupported source reference: {raw}")


def _upload_file_to_bunny_chunked(
    local_path: Path,
    *,
    object_path: str,
    settings,
    chunk_size: int,
    progress_prefix: str,
) -> str:
    zone = str(settings.bunny_storage_zone or "").strip()
    access_key = str(settings.bunny_storage_access_key or "").strip()
    endpoint = str(settings.bunny_storage_endpoint or "storage.bunnycdn.com").strip()
    endpoint = endpoint.replace("https://", "").replace("http://", "").strip("/")
    if not (zone and access_key and endpoint):
        raise RuntimeError("Bunny Storage settings are incomplete.")

    key = object_path.lstrip("/")
    total_size = int(local_path.stat().st_size)
    timeout = max(60, int(settings.bunny_storage_upload_timeout_seconds or 900))
    retries = max(1, int(settings.bunny_storage_upload_retries or 3))
    target_path = f"/{zone}/{key}"

    for attempt in range(1, retries + 1):
        conn = http.client.HTTPSConnection(endpoint, timeout=timeout)
        try:
            conn.putrequest("PUT", target_path)
            conn.putheader("AccessKey", access_key)
            conn.putheader("Content-Type", mimetypes.guess_type(str(local_path))[0] or "application/octet-stream")
            conn.putheader("Content-Length", str(total_size))
            conn.putheader("Accept", "application/json")
            conn.endheaders()

            sent = 0
            started_at = time.time()
            last_tick = 0.0
            with local_path.open("rb") as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    conn.send(chunk)
                    sent += len(chunk)
                    now = time.time()
                    if (now - last_tick) >= 0.2:
                        _print_progress(f"{progress_prefix} (try {attempt}/{retries})", sent, total_size, started_at)
                        last_tick = now
            _print_progress(f"{progress_prefix} (try {attempt}/{retries})", sent, total_size, started_at, force=True)

            resp = conn.getresponse()
            resp_body = (resp.read() or b"").decode("utf-8", errors="ignore")
            if resp.status in {200, 201}:
                return f"bunny://{zone}/{key}"
            if resp.status in {401, 403}:
                raise RuntimeError(f"Bunny upload failed with HTTP {resp.status}: {resp_body[:400]}")
            if attempt >= retries:
                raise RuntimeError(f"Bunny upload failed with HTTP {resp.status}: {resp_body[:400]}")
            print(f"[RETRY] upload failed with HTTP {resp.status}; retrying in {attempt * 2}s")
            time.sleep(min(10, attempt * 2))
        except Exception as exc:
            if attempt >= retries:
                raise RuntimeError(f"Bunny upload failed: {exc}") from exc
            print(f"[RETRY] upload error: {exc}; retrying in {attempt * 2}s")
            time.sleep(min(10, attempt * 2))
        finally:
            try:
                conn.close()
            except Exception:
                pass
    raise RuntimeError("Bunny upload failed after retries.")


def _build_object_path(spec: MigrationSpec, row_id: int, original_name: str) -> str:
    ext = Path(original_name).suffix or ".bin"
    safe_name = _sanitize_filename(original_name, fallback_ext=ext)
    return f"{spec.object_prefix}/{int(row_id)}/{safe_name}"


def run(*, apply: bool, table_filter: set[str] | None, limit: int | None, chunk_size_mb: int) -> int:
    settings = get_settings()
    backend = settings.resolved_object_storage_backend
    if apply and backend != "bunny":
        raise RuntimeError(
            "OBJECT_STORAGE_BACKEND must resolve to 'bunny' before running this migration. "
            f"Current resolved backend: '{backend}'.",
        )

    media_root = Path(settings.resolved_media_dir)
    temp_dir = Path(tempfile.gettempdir()) / "certora-bunny-migrate"
    temp_dir.mkdir(parents=True, exist_ok=True)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    s3 = _s3_client() if apply else None
    chunk_size = max(1, int(chunk_size_mb)) * 1024 * 1024

    scanned = 0
    candidates = 0
    migrated = 0
    failed = 0

    with SessionLocal() as db:
        Base.metadata.create_all(bind=engine)
        for spec in SPECS:
            if table_filter and spec.label not in table_filter:
                continue

            query = select(spec.model).order_by(spec.model.id.asc())
            rows = list(db.scalars(query).all())
            if limit is not None:
                rows = rows[: max(0, int(limit))]
            candidate_rows = [row for row in rows if _should_migrate(getattr(row, spec.column, None))]

            spec_scanned = 0
            spec_candidates = len(candidate_rows)
            spec_migrated = 0
            spec_failed = 0

            for row in rows:
                spec_scanned += 1
                scanned += 1
                old_value = getattr(row, spec.column, None)
                if not _should_migrate(old_value):
                    continue

                candidates += 1
                row_id = int(getattr(row, "id"))
                if not apply:
                    print(f"[DRY] {spec.label} id={row_id} value={old_value}")
                    continue

                source_path: Path | None = None
                should_cleanup = False
                try:
                    source_path, original_name, should_cleanup = _resolve_source_to_local_path(
                        str(old_value),
                        media_root=media_root,
                        s3=s3,
                        temp_dir=temp_dir,
                    )
                    object_path = _build_object_path(spec, row_id, original_name)
                    new_ref = _upload_file_to_bunny_chunked(
                        source_path,
                        object_path=object_path,
                        settings=settings,
                        chunk_size=chunk_size,
                        progress_prefix=f"[UPLOAD] {spec.label} id={row_id}",
                    )
                    setattr(row, spec.column, new_ref)
                    db.add(row)
                    spec_migrated += 1
                    migrated += 1
                    if migrated % 25 == 0:
                        db.commit()
                    print(f"[OK] {spec.label} id={row_id} -> {new_ref}")
                except Exception as exc:
                    spec_failed += 1
                    failed += 1
                    print(f"[FAIL] {spec.label} id={row_id} value={old_value} err={exc}")
                finally:
                    try:
                        if should_cleanup and source_path:
                            source_path.unlink(missing_ok=True)
                    except Exception:
                        pass

            if apply:
                db.commit()
            print(
                f"[SUMMARY] {spec.label}: scanned={spec_scanned} candidates={spec_candidates} "
                f"migrated={spec_migrated} failed={spec_failed}",
            )

    print(
        f"[DONE] scanned={scanned} candidates={candidates} migrated={migrated} failed={failed} "
        f"mode={'apply' if apply else 'dry-run'}",
    )
    return 0 if failed == 0 else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate local/s3 media references to Bunny storage.")
    parser.add_argument("--apply", action="store_true", help="Perform upload + DB updates. Default is dry-run.")
    parser.add_argument(
        "--only",
        action="append",
        help=(
            "Limit to specific label(s), e.g. "
            "'courses.thumbnail_url' or 'certificates.pdf_url'. Can be repeated."
        ),
    )
    parser.add_argument("--limit", type=int, default=None, help="Max rows per table (for testing).")
    parser.add_argument("--chunk-size-mb", type=int, default=8, help="Upload chunk size in MB for Bunny PUT stream.")
    args = parser.parse_args()

    table_filter = set(args.only or []) if args.only else None
    return run(apply=bool(args.apply), table_filter=table_filter, limit=args.limit, chunk_size_mb=args.chunk_size_mb)


if __name__ == "__main__":
    raise SystemExit(main())
