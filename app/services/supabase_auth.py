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
        algorithm = str(header.get("alg") or "").upper()
        if algorithm not in {"RS256", "ES256"}:
            raise ValueError("Supabase session uses an unsupported signing algorithm")
        jwks_response = httpx.get(f"{base_url}/auth/v1/.well-known/jwks.json", timeout=10)
        jwks_response.raise_for_status()
        keys = jwks_response.json().get("keys") or []
        signing_key = next((key for key in keys if key.get("kid") == header.get("kid")), None)
        if not signing_key:
            raise ValueError(f"Supabase session validation failed with status {response.status_code}")
        data = jwt.decode(
            token,
            signing_key,
            algorithms=[algorithm],
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
        # app_metadata is administrator-controlled; user_metadata is editable by
        # the account holder and must never grant an application role.
        "role": app_metadata.get("role") or "",
    }


def ensure_supabase_user(
    *,
    email: str,
    password: str,
    full_name: str,
    role: str,
    settings: Settings,
) -> dict[str, Any]:
    """Create an auth identity when the Supabase secret key is configured."""
    if not settings.supabase_url or not settings.supabase_secret_key:
        return {"configured": False, "created": False, "reason": "Supabase admin provisioning is not configured."}
    secret = settings.supabase_secret_key
    response = httpx.post(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
        headers={"apikey": secret, "Authorization": f"Bearer {secret}"},
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": full_name},
            "app_metadata": {"role": role},
        },
        timeout=15,
    )
    if response.status_code in {200, 201}:
        data = response.json()
        return {"configured": True, "created": True, "user_id": data.get("id")}
    try:
        data = response.json()
        detail = str(data.get("msg") or data.get("message") or data.get("error_description") or "")
    except Exception:
        detail = response.text
    if response.status_code in {400, 422} and any(term in detail.lower() for term in {"already", "registered", "exists"}):
        return {"configured": True, "created": False, "existing": True}
    raise ValueError(detail or f"Supabase user provisioning failed with status {response.status_code}.")
