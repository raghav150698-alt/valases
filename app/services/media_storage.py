from __future__ import annotations

import base64
import binascii
import http.client
import json
import mimetypes
from pathlib import Path
import re
import ssl
import time
from urllib.parse import quote, urlparse
from urllib import error, request
from uuid import uuid4

try:
    import boto3
except ImportError:  # pragma: no cover - runtime dependency safety
    boto3 = None
try:
    from firebase_admin import storage
except ImportError:  # Firebase storage is not part of the Supabase production runtime.
    storage = None

from app.core.config import get_settings
from app.services.firebase_auth import init_firebase

_DATA_URL_RE = re.compile(r"^data:(?P<mime>[-\w.+/]+)?;base64,(?P<data>.+)$", re.IGNORECASE)


def _bucket_name() -> str:
    settings = get_settings()
    if settings.firebase_storage_bucket:
        return settings.firebase_storage_bucket
    if settings.firebase_project_id:
        return f"{settings.firebase_project_id}.appspot.com"
    raise RuntimeError("Firebase Storage bucket is not configured.")


def _s3_client():
    if boto3 is None:
        raise RuntimeError("S3 client unavailable. Install boto3.")
    settings = get_settings()
    if not all((settings.aws_region, settings.aws_access_key_id, settings.aws_secret_access_key, settings.aws_s3_bucket_name)):
        raise RuntimeError("AWS S3 settings are incomplete.")
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )


def _supabase_storage_settings() -> tuple[str, str, str]:
    settings = get_settings()
    base_url = str(settings.supabase_url or "").strip().rstrip("/")
    secret = str(settings.supabase_secret_key or "").strip()
    bucket = str(settings.supabase_storage_bucket or "").strip()
    if not (base_url.startswith("https://") and secret and bucket):
        raise RuntimeError("Supabase Storage settings are incomplete.")
    return base_url, secret, bucket


def _supabase_storage_headers(*, content_type: str = "application/json") -> dict[str, str]:
    _, secret, _ = _supabase_storage_settings()
    return {
        "apikey": secret,
        "Authorization": f"Bearer {secret}",
        "Accept": "application/json",
        "Content-Type": content_type,
    }


def _upload_file_to_supabase_storage(
    local_path: Path,
    *,
    object_path: str,
    content_type: str | None = None,
) -> str:
    if not local_path.exists():
        raise RuntimeError(f"Local file not found for upload: {local_path}")
    base_url, _, bucket = _supabase_storage_settings()
    key = object_path.lstrip("/")
    ctype = content_type or mimetypes.guess_type(str(local_path))[0] or "application/octet-stream"
    encoded_key = quote(key, safe="/")
    parsed = urlparse(base_url)
    content_length = int(local_path.stat().st_size)
    conn = http.client.HTTPSConnection(parsed.netloc, timeout=120, context=ssl.create_default_context())
    try:
        conn.putrequest("POST", f"/storage/v1/object/{quote(bucket, safe='')}/{encoded_key}")
        for header, value in _supabase_storage_headers(content_type=ctype).items():
            conn.putheader(header, value)
        conn.putheader("x-upsert", "true")
        conn.putheader("Content-Length", str(content_length))
        conn.endheaders()
        with local_path.open("rb") as fh:
            while True:
                chunk = fh.read(1024 * 1024)
                if not chunk:
                    break
                conn.send(chunk)
        resp = conn.getresponse()
        status = int(getattr(resp, "status", 0) or 0)
        body_text = (resp.read() or b"").decode("utf-8", errors="ignore")
        if status not in {200, 201}:
            raise RuntimeError(f"Supabase Storage upload failed with HTTP {status}: {body_text[:400]}")
    finally:
        conn.close()
    return f"supabase://{bucket}/{key}"


def _parse_supabase_ref(storage_ref: str) -> tuple[str, str] | None:
    raw = str(storage_ref or "").strip()
    if not raw.startswith("supabase://"):
        return None
    ref = raw[len("supabase://"):]
    parts = ref.split("/", 1)
    if len(parts) != 2:
        return None
    bucket = parts[0].strip()
    key = parts[1].lstrip("/")
    if not bucket or not key:
        return None
    return bucket, key


def _delete_supabase_object(storage_ref: str) -> bool:
    parsed = _parse_supabase_ref(storage_ref)
    if not parsed:
        return False
    bucket, key = parsed
    base_url, _, _ = _supabase_storage_settings()
    payload = json.dumps({"prefixes": [key]}).encode("utf-8")
    req = request.Request(
        f"{base_url}/storage/v1/object/{quote(bucket, safe='')}",
        data=payload,
        method="DELETE",
        headers=_supabase_storage_headers(),
    )
    try:
        with request.urlopen(req, timeout=60) as resp:
            status = int(getattr(resp, "status", 0) or 0)
            return status in {200, 201, 202, 204}
    except error.HTTPError as exc:
        if int(getattr(exc, "code", 0) or 0) == 404:
            return True
        return False
    except Exception:
        return False


def _resolve_supabase_media_url(storage_ref: str, *, expires_in_seconds: int) -> str | None:
    parsed = _parse_supabase_ref(storage_ref)
    if not parsed:
        return None
    bucket, key = parsed
    base_url, _, _ = _supabase_storage_settings()
    settings = get_settings()
    ttl = max(60, min(int(expires_in_seconds or settings.supabase_storage_signed_url_ttl_seconds), 7 * 24 * 3600))
    payload = json.dumps({"expiresIn": ttl}).encode("utf-8")
    req = request.Request(
        f"{base_url}/storage/v1/object/sign/{quote(bucket, safe='')}/{quote(key, safe='/')}",
        data=payload,
        method="POST",
        headers=_supabase_storage_headers(),
    )
    try:
        with request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        signed_url = str(body.get("signedURL") or body.get("signedUrl") or "").strip()
        if not signed_url:
            return None
        if signed_url.startswith("http://") or signed_url.startswith("https://"):
            return signed_url
        if signed_url.startswith("/storage/v1/"):
            return f"{base_url}{signed_url}"
        return f"{base_url}/storage/v1{signed_url if signed_url.startswith('/') else '/' + signed_url}"
    except Exception:
        return None


def _upload_file_to_firebase_storage(
    local_path: Path,
    *,
    object_path: str,
    content_type: str | None = None,
) -> str:
    if storage is None:
        raise RuntimeError("Firebase Storage support is not installed in this deployment.")
    if not local_path.exists():
        raise RuntimeError(f"Local file not found for upload: {local_path}")
    init_firebase()
    bucket = storage.bucket(_bucket_name())
    blob = bucket.blob(object_path.lstrip("/"))
    token = uuid4().hex
    blob.metadata = {"firebaseStorageDownloadTokens": token}
    blob.upload_from_filename(str(local_path), content_type=content_type)
    blob.patch()
    encoded_path = quote(blob.name, safe="")
    return f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/{encoded_path}?alt=media&token={token}"


def _upload_file_to_s3(local_path: Path, *, object_path: str, content_type: str | None = None) -> str:
    if not local_path.exists():
        raise RuntimeError(f"Local file not found for upload: {local_path}")
    settings = get_settings()
    key = object_path.lstrip("/")
    client = _s3_client()
    extra_args = {"ServerSideEncryption": "AES256"}
    if content_type:
        extra_args["ContentType"] = content_type
    client.upload_file(str(local_path), settings.aws_s3_bucket_name, key, ExtraArgs=extra_args)
    return f"s3://{settings.aws_s3_bucket_name}/{key}"


def _delete_s3_object(storage_ref: str) -> bool:
    settings = get_settings()
    bucket = str(settings.aws_s3_bucket_name or "").strip()
    if not bucket:
        return False
    key = storage_ref[len(f"s3://{bucket}/"):] if storage_ref.startswith(f"s3://{bucket}/") else storage_ref.split("/", 3)[-1]
    client = _s3_client()
    client.delete_object(Bucket=bucket, Key=key)
    return True


def _upload_file_to_bunny_storage(local_path: Path, *, object_path: str, content_type: str | None = None) -> str:
    if not local_path.exists():
        raise RuntimeError(f"Local file not found for upload: {local_path}")
    settings = get_settings()
    zone = str(settings.bunny_storage_zone or "").strip()
    access_key = str(settings.bunny_storage_access_key or "").strip()
    endpoint = str(settings.bunny_storage_endpoint or "storage.bunnycdn.com").strip()
    if not (zone and access_key and endpoint):
        raise RuntimeError("Bunny Storage settings are incomplete.")
    timeout = max(60, int(settings.bunny_storage_upload_timeout_seconds or 900))
    retries = max(1, int(settings.bunny_storage_upload_retries or 3))
    key = object_path.lstrip("/")
    ctype = content_type or mimetypes.guess_type(str(local_path))[0] or "application/octet-stream"
    content_length = int(local_path.stat().st_size)
    target_path = f"/{zone}/{key}"
    for attempt in range(1, retries + 1):
        conn = None
        try:
            conn = http.client.HTTPSConnection(endpoint, timeout=timeout, context=ssl.create_default_context())
            conn.putrequest("PUT", target_path)
            conn.putheader("AccessKey", access_key)
            conn.putheader("Content-Type", ctype)
            conn.putheader("Accept", "application/json")
            conn.putheader("Content-Length", str(content_length))
            conn.endheaders()
            with local_path.open("rb") as fh:
                while True:
                    chunk = fh.read(1024 * 1024)
                    if not chunk:
                        break
                    conn.send(chunk)
            resp = conn.getresponse()
            status = int(getattr(resp, "status", 0) or 0)
            body_text = (resp.read() or b"").decode("utf-8", errors="ignore")
            if status in {200, 201}:
                break
            if status in {401, 403}:
                raise RuntimeError(f"Bunny upload failed with HTTP {status}: {body_text[:400]}")
            if attempt >= retries:
                raise RuntimeError(f"Bunny upload failed with HTTP {status}: {body_text[:400]}")
            time.sleep(min(8, attempt * 2))
        except Exception as exc:
            if attempt >= retries:
                raise RuntimeError(f"Bunny upload failed: {exc}") from exc
            time.sleep(min(8, attempt * 2))
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    return f"bunny://{zone}/{key}"


def _delete_bunny_object(storage_ref: str) -> bool:
    settings = get_settings()
    access_key = str(settings.bunny_storage_access_key or "").strip()
    endpoint = str(settings.bunny_storage_endpoint or "storage.bunnycdn.com").strip()
    if not (access_key and endpoint):
        return False
    ref = storage_ref[len("bunny://"):]
    parts = ref.split("/", 1)
    if len(parts) != 2:
        return False
    zone = parts[0].strip()
    object_key = parts[1].lstrip("/")
    if not (zone and object_key):
        return False
    url = f"https://{endpoint}/{zone}/{object_key}"
    req = request.Request(
        url,
        method="DELETE",
        headers={
            "AccessKey": access_key,
            "Accept": "application/json",
        },
    )
    try:
        with request.urlopen(req, timeout=60) as resp:
            status = int(getattr(resp, "status", 0) or 0)
            return status in {200, 201, 202, 204}
    except error.HTTPError as exc:
        # Treat not found as already deleted.
        if int(getattr(exc, "code", 0) or 0) == 404:
            return True
        return False
    except Exception:
        return False


def upload_file_to_cloud_storage(
    local_path: Path,
    *,
    object_path: str,
    content_type: str | None = None,
) -> str:
    backend = get_settings().resolved_object_storage_backend
    if backend == "supabase":
        return _upload_file_to_supabase_storage(local_path, object_path=object_path, content_type=content_type)
    if backend == "bunny":
        return _upload_file_to_bunny_storage(local_path, object_path=object_path, content_type=content_type)
    if backend == "s3":
        return _upload_file_to_s3(local_path, object_path=object_path, content_type=content_type)
    if backend == "firebase":
        return _upload_file_to_firebase_storage(local_path, object_path=object_path, content_type=content_type)
    raise RuntimeError("Cloud storage backend is not configured.")


def delete_storage_reference(value: str | None) -> bool:
    raw = str(value or "").strip()
    if not raw:
        return False
    try:
        if raw.startswith("supabase://"):
            return _delete_supabase_object(raw)
        if raw.startswith("bunny://"):
            return _delete_bunny_object(raw)
        if raw.startswith("s3://"):
            return _delete_s3_object(raw)
        if raw.startswith("/media/"):
            settings = get_settings()
            media_root = Path(settings.resolved_media_dir)
            path = media_root / raw.removeprefix("/media/").lstrip("/")
            if path.exists():
                path.unlink(missing_ok=True)
                return True
            return False
    except Exception:
        return False
    return False


def normalize_image_storage_reference(
    value: str | None,
    *,
    object_prefix: str = "images",
) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    match = _DATA_URL_RE.match(raw)
    if not match:
        return raw

    mime = (match.group("mime") or "application/octet-stream").strip().lower()
    if mime not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
        raise ValueError("Unsupported image media type.")
    b64_data = match.group("data") or ""
    try:
        image_bytes = base64.b64decode(b64_data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Invalid base64 data URL.") from exc
    if not image_bytes:
        raise ValueError("Image data is empty.")
    if len(image_bytes) > 5_000_000:
        raise ValueError("Image data exceeds the 5 MB limit.")

    ext = mimetypes.guess_extension(mime) or ".bin"
    if ext == ".jpe":
        ext = ".jpg"
    object_prefix_clean = object_prefix.strip("/").replace("\\", "/") or "images"
    filename = f"{uuid4().hex}{ext}"
    object_path = f"{object_prefix_clean}/{filename}"

    settings = get_settings()
    media_root = Path(settings.resolved_media_dir)
    local_target = media_root / object_path
    local_target.parent.mkdir(parents=True, exist_ok=True)
    local_target.write_bytes(image_bytes)

    backend = settings.resolved_object_storage_backend
    if backend == "local":
        rel = local_target.relative_to(media_root).as_posix()
        return f"/media/{rel}"
    try:
        return upload_file_to_cloud_storage(local_target, object_path=object_path, content_type=mime)
    finally:
        try:
            local_target.unlink(missing_ok=True)
        except Exception:
            pass


def resolve_media_url(value: str | None, *, expires_in_seconds: int = 3600) -> str | None:
    if not value:
        return None
    try:
        # Normalize legacy localhost absolute URLs to same-origin media paths to avoid
        # mixed-content errors on HTTPS deployments.
        if value.startswith("http://") or value.startswith("https://"):
            try:
                parsed = urlparse(value)
                host = (parsed.hostname or "").lower()
                if host in {"localhost", "127.0.0.1"} and parsed.path.startswith("/media/"):
                    return parsed.path
            except Exception:
                pass
        if value.startswith("http://") or value.startswith("https://"):
            return value
        if value.startswith("/media/"):
            # Return relative path so browser always uses current origin/protocol.
            # If local media file is missing (common after cloud deploy), suppress broken URL.
            settings = get_settings()
            media_root = Path(settings.resolved_media_dir)
            rel = value.removeprefix("/media/").lstrip("/")
            local_file = media_root / rel
            if not local_file.exists():
                return None
            return value
        if value.startswith("s3://"):
            settings = get_settings()
            if not settings.aws_s3_bucket_name:
                return None
            key = value[len(f"s3://{settings.aws_s3_bucket_name}/"):] if value.startswith(f"s3://{settings.aws_s3_bucket_name}/") else value.split("/", 3)[-1]
            client = _s3_client()
            return client.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.aws_s3_bucket_name, "Key": key},
                ExpiresIn=max(60, min(expires_in_seconds, 7 * 24 * 3600)),
            )
        if value.startswith("supabase://"):
            return _resolve_supabase_media_url(value, expires_in_seconds=expires_in_seconds)
        if value.startswith("bunny://"):
            settings = get_settings()
            pull_zone = str(settings.bunny_storage_pull_zone or "").strip().strip("/")
            key = value[len("bunny://"):]
            parts = key.split("/", 1)
            if len(parts) != 2:
                return None
            zone_name = parts[0].strip()
            object_key = parts[1].lstrip("/")
            if not pull_zone:
                # Fallback for misconfigured env: many Bunny setups expose storage
                # files via "<zone>.b-cdn.net". This keeps media playable while
                # pull zone/domain env is being corrected.
                pull_zone = f"{zone_name}.b-cdn.net" if zone_name else ""
                if not pull_zone:
                    return None
            if pull_zone.startswith("http://") or pull_zone.startswith("https://"):
                return f"{pull_zone.rstrip('/')}/{object_key}"
            return f"https://{pull_zone}/{object_key}"
        return value
    except Exception:
        # Never break API responses due to media-url resolution issues.
        return None
