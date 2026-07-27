import base64
import binascii

from fastapi import HTTPException


DEFAULT_ORGANIZATION_LOGO_URL = "/assets/brand/valases-logo.png"
MAX_ORGANIZATION_LOGO_BYTES = 256 * 1024
_ALLOWED_LOGO_PREFIXES = {
    "data:image/png;base64,": b"\x89PNG\r\n\x1a\n",
    "data:image/jpeg;base64,": b"\xff\xd8\xff",
    "data:image/webp;base64,": b"RIFF",
}


def normalize_organization_logo(value: str | None, *, required: bool = False) -> str:
    logo = str(value or "").strip()
    if not logo:
        if required:
            raise HTTPException(status_code=422, detail="Upload a PNG, JPEG, or WebP company logo")
        return ""
    prefix = next((item for item in _ALLOWED_LOGO_PREFIXES if logo.startswith(item)), "")
    if not prefix:
        raise HTTPException(status_code=422, detail="Company logo must be a PNG, JPEG, or WebP image")
    try:
        content = base64.b64decode(logo[len(prefix):], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=422, detail="Company logo data is invalid") from exc
    if not content or len(content) > MAX_ORGANIZATION_LOGO_BYTES:
        raise HTTPException(status_code=422, detail="Company logo must be smaller than 256 KB")
    if not content.startswith(_ALLOWED_LOGO_PREFIXES[prefix]):
        raise HTTPException(status_code=422, detail="Company logo content does not match its image type")
    if prefix.startswith("data:image/webp") and content[8:12] != b"WEBP":
        raise HTTPException(status_code=422, detail="Company logo content does not match its image type")
    return logo


def organization_logo_url(settings_json: dict | None) -> str:
    branding = dict((settings_json or {}).get("branding") or {})
    return str(branding.get("logo_data_url") or DEFAULT_ORGANIZATION_LOGO_URL)
