from typing import Any

import httpx
from jose import jwt

from app.core.config import Settings


def sign_in_with_password(email: str, password: str, settings: Settings) -> str:
    if not settings.supabase_url or not settings.supabase_publishable_key:
        raise ValueError("Supabase authentication is not configured")
    response = httpx.post(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/token?grant_type=password",
        headers={"apikey": settings.supabase_publishable_key},
        json={"email": email, "password": password},
        timeout=10,
    )
    if response.status_code != 200:
        try:
            detail = response.json().get("error_description") or response.json().get("msg")
        except Exception:
            detail = None
        raise ValueError(str(detail or "Invalid email or password."))
    token = response.json().get("access_token")
    if not token:
        raise ValueError("Supabase did not return a session token")
    return str(token)


def verify_supabase_token(token: str | None, settings: Settings) -> dict[str, Any]:
    if not token or not settings.supabase_url or not settings.supabase_publishable_key:
        raise ValueError("Supabase authentication is not configured")
    base_url = settings.supabase_url.rstrip("/")
    response = httpx.get(
        f"{base_url}/auth/v1/user",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
        },
        timeout=10,
    )
    if response.status_code == 200:
        data = response.json()
    else:
        # Some Supabase projects reject the publishable key on the user lookup
        # endpoint while still exposing their signed access-token keys. Verify
        # the token against the project JWKS as a secure fallback.
        header = jwt.get_unverified_header(token)
        jwks_response = httpx.get(f"{base_url}/auth/v1/.well-known/jwks.json", timeout=10)
        jwks_response.raise_for_status()
        keys = jwks_response.json().get("keys") or []
        signing_key = next((key for key in keys if key.get("kid") == header.get("kid")), None)
        if not signing_key:
            raise ValueError(f"Supabase session validation failed with status {response.status_code}")
        data = jwt.decode(
            token,
            signing_key,
            algorithms=[str(header.get("alg") or "RS256")],
            audience="authenticated",
            issuer=f"{base_url}/auth/v1",
        )
        data = {
            **data,
            "id": data.get("sub"),
            "email": data.get("email"),
            "user_metadata": data.get("user_metadata") or {},
            "app_metadata": data.get("app_metadata") or {},
        }
    if not data.get("id") or not data.get("email"):
        raise ValueError("Supabase user identity is incomplete")
    metadata = data.get("user_metadata") or {}
    app_metadata = data.get("app_metadata") or {}
    return {
        **data,
        "uid": data.get("id"),
        "name": metadata.get("full_name") or metadata.get("name") or str(data["email"]).split("@", 1)[0],
        "role": app_metadata.get("role") or metadata.get("role") or "provider",
    }
