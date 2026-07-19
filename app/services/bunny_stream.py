from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
from urllib import error, request

from app.core.config import get_settings


class BunnyStreamError(RuntimeError):
    pass


def _api_base() -> str:
    return "https://video.bunnycdn.com"


def _library_id() -> int:
    s = get_settings()
    library_id = int(s.bunny_stream_library_id or 0)
    if library_id <= 0:
        raise BunnyStreamError("BUNNY_STREAM_LIBRARY_ID is missing")
    return library_id


def _api_headers() -> dict[str, str]:
    s = get_settings()
    token = str(s.bunny_stream_api_key or "").strip()
    if not token:
        raise BunnyStreamError("BUNNY_STREAM_API_KEY is missing")
    return {
        "AccessKey": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def is_configured() -> bool:
    s = get_settings()
    return bool(int(s.bunny_stream_library_id or 0) > 0 and s.bunny_stream_api_key and s.bunny_stream_pull_zone)


def _http_json(method: str, url: str, payload: dict | None = None) -> dict:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, headers=_api_headers(), method=method)
    try:
        with request.urlopen(req, timeout=30) as resp:
            raw = (resp.read() or b"{}").decode("utf-8", errors="ignore")
            out = json.loads(raw or "{}")
            if isinstance(out, dict):
                return out
            raise BunnyStreamError("Unexpected Bunny response")
    except error.HTTPError as exc:
        body = ""
        try:
            body = (exc.read() or b"").decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        raise BunnyStreamError(f"Bunny HTTP {exc.code}: {body[:400]}") from exc
    except Exception as exc:
        raise BunnyStreamError(f"Bunny request failed: {str(exc)}") from exc


def _normalize_pull_zone() -> str:
    s = get_settings()
    pull_zone = str(s.bunny_stream_pull_zone or "").strip().strip("/")
    if not pull_zone:
        raise BunnyStreamError("BUNNY_STREAM_PULL_ZONE is missing")
    if pull_zone.startswith("http://") or pull_zone.startswith("https://"):
        return pull_zone.rstrip("/")
    return f"https://{pull_zone}"


def create_direct_upload(*, max_duration_seconds: int | None = None, metadata: dict | None = None) -> dict:
    title = str((metadata or {}).get("internal_id") or f"video-{datetime.now(timezone.utc).timestamp()}")
    out = _http_json(
        "POST",
        f"{_api_base()}/library/{_library_id()}/videos",
        {"title": title},
    )
    video_id = str(out.get("guid") or "").strip()
    if not video_id:
        raise BunnyStreamError("Bunny create video response missing guid")
    upload_url = f"{_api_base()}/library/{_library_id()}/videos/{video_id}"
    expiry = datetime.now(timezone.utc) + timedelta(seconds=max(300, int(get_settings().stream_direct_upload_expiry_seconds or 3600)))
    return {
        "uid": video_id,
        "upload_url": upload_url,
        "expires_at": expiry,
    }


def upload_video_content(*, video_uid: str, body: bytes, content_type: str | None = None) -> None:
    uid = str(video_uid or "").strip()
    if not uid:
        raise BunnyStreamError("video uid is required")
    if not body:
        raise BunnyStreamError("empty upload body")
    url = f"{_api_base()}/library/{_library_id()}/videos/{uid}"
    req = request.Request(
        url,
        data=body,
        method="PUT",
        headers={
            "AccessKey": _api_headers()["AccessKey"],
            "Accept": "application/json",
            "Content-Type": content_type or "application/octet-stream",
        },
    )
    try:
        with request.urlopen(req, timeout=180) as resp:
            status = int(getattr(resp, "status", 0) or 0)
            if status not in {200, 201, 204}:
                raise BunnyStreamError(f"Bunny upload failed with HTTP {status}")
    except error.HTTPError as exc:
        body_text = ""
        try:
            body_text = (exc.read() or b"").decode("utf-8", errors="ignore")
        except Exception:
            body_text = ""
        raise BunnyStreamError(f"Bunny upload failed with HTTP {exc.code}: {body_text[:400]}") from exc
    except Exception as exc:
        raise BunnyStreamError(f"Bunny upload failed: {str(exc)}") from exc


def get_video_details(video_uid: str) -> dict:
    uid = str(video_uid or "").strip()
    if not uid:
        raise BunnyStreamError("video uid is required")
    out = _http_json("GET", f"{_api_base()}/library/{_library_id()}/videos/{uid}")
    encode_progress = float(out.get("encodeProgress") or 0.0)
    length = int(float(out.get("length") or 0.0))
    ready = encode_progress >= 100.0
    thumbnail = f"{_normalize_pull_zone()}/{uid}/thumbnail.jpg"
    status = "ready" if ready else ("processing" if encode_progress > 0 else "pending")
    return {
        "uid": uid,
        "ready": ready,
        "upload_status": status,
        "duration_seconds": length,
        "thumbnail_url": thumbnail,
    }


def generate_playback_token(*, video_uid: str, user_id: int, course_id: int, ttl_seconds: int | None = None) -> str:
    uid = str(video_uid or "").strip()
    if not uid:
        raise BunnyStreamError("video uid is required")
    s = get_settings()
    key = str(s.bunny_stream_embed_token_key or "").strip()
    if not key:
        # Token auth may be disabled in Bunny; in that case playback URL works without token.
        return ""
    ttl = int(ttl_seconds or s.stream_playback_token_ttl_seconds or 900)
    expires = int((datetime.now(timezone.utc) + timedelta(seconds=max(60, ttl))).timestamp())
    digest = hashlib.sha256(f"{key}{uid}{expires}".encode("utf-8")).hexdigest()
    return f"{digest}:{expires}"


def build_playback_urls(*, video_uid: str, token: str | None) -> dict:
    uid = str(video_uid or "").strip()
    if not uid:
        raise BunnyStreamError("video uid is required")
    s = get_settings()
    library_id = _library_id()
    pull_zone = _normalize_pull_zone()
    iframe_url = f"https://player.mediadelivery.net/embed/{library_id}/{uid}"
    if token and ":" in token:
        tok, expires = token.split(":", 1)
        iframe_url = f"{iframe_url}?token={tok}&expires={expires}"
    hls_url = f"{pull_zone}/{uid}/playlist.m3u8"
    return {
        "iframe_url": iframe_url,
        "hls_url": hls_url,
        "dash_url": "",
    }
