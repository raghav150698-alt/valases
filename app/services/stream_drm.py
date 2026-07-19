from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

from jose import JWTError, jwt

from app.core.config import get_settings


class StreamDrmError(Exception):
    pass


def _secret_key() -> str:
    s = get_settings()
    key = str(s.stream_drm_license_secret or "").strip()
    if key:
        return key
    fallback = str(s.jwt_secret_key or "").strip()
    if fallback:
        return fallback
    raise StreamDrmError("STREAM_DRM_LICENSE_SECRET is missing")


def issue_stream_license(
    *,
    user_id: int,
    course_id: int,
    lesson_video_id: int,
    session_id: int,
    client_app: str = "web",
    ttl_seconds: int | None = None,
) -> tuple[str, int]:
    s = get_settings()
    ttl = max(30, int(ttl_seconds or s.stream_drm_license_ttl_seconds or 180))
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=ttl)
    claims: dict[str, Any] = {
        "typ": "stream_license",
        "sub": str(int(user_id)),
        "sid": int(session_id),
        "cid": int(course_id),
        "lvid": int(lesson_video_id),
        "app": str(client_app or "web")[:30],
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(claims, _secret_key(), algorithm=str(s.jwt_algorithm or "HS256"))
    return token, ttl


def verify_stream_license(
    *,
    token: str,
    user_id: int,
    course_id: int,
    lesson_video_id: int,
    session_id: int,
    client_app: str = "web",
) -> dict[str, Any]:
    s = get_settings()
    algo = str(s.jwt_algorithm or "HS256")
    try:
        payload = jwt.decode(token, _secret_key(), algorithms=[algo])
    except JWTError as exc:
        raise StreamDrmError("Invalid or expired stream license token") from exc

    if str(payload.get("typ") or "") != "stream_license":
        raise StreamDrmError("Invalid stream license type")
    if str(payload.get("sub") or "") != str(int(user_id)):
        raise StreamDrmError("Stream license user mismatch")
    if int(payload.get("sid") or 0) != int(session_id):
        raise StreamDrmError("Stream license session mismatch")
    if int(payload.get("cid") or 0) != int(course_id):
        raise StreamDrmError("Stream license course mismatch")
    if int(payload.get("lvid") or 0) != int(lesson_video_id):
        raise StreamDrmError("Stream license lesson video mismatch")

    expected_app = str(client_app or "web")
    token_app = str(payload.get("app") or "web")
    if token_app != expected_app:
        raise StreamDrmError("Stream license client mismatch")
    return payload
