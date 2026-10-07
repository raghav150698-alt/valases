from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

import httpx
from sqlalchemy import func, select

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.entities import AuditLog, User
from app.services.supabase_auth import ensure_supabase_user


def reset_password(email: str, *, create_if_missing: bool = False) -> str:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_secret_key:
        raise RuntimeError("Supabase administrator configuration is missing.")

    normalized_email = email.strip().lower()
    base_url = settings.supabase_url.rstrip("/")
    headers = {
        "apikey": settings.supabase_secret_key,
        "Authorization": f"Bearer {settings.supabase_secret_key}",
    }
    response = httpx.get(
        f"{base_url}/auth/v1/admin/users",
        headers=headers,
        params={"page": 1, "per_page": 1000},
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    users = payload.get("users", []) if isinstance(payload, dict) else payload
    auth_user = next(
        (item for item in users if str(item.get("email") or "").strip().lower() == normalized_email),
        None,
    )
    temporary_password = secrets.token_urlsafe(18)
    if not auth_user:
        if not create_if_missing:
            raise RuntimeError(f"Supabase user not found: {normalized_email}")
        with SessionLocal() as db:
            local_user = db.scalar(
                select(User).where(func.lower(func.trim(User.email)) == normalized_email),
            )
            if not local_user:
                raise RuntimeError(f"Valases user not found: {normalized_email}")
            result = ensure_supabase_user(
                email=normalized_email,
                password=temporary_password,
                full_name=local_user.full_name,
                role=local_user.role.value,
                settings=settings,
            )
            if not result.get("created"):
                raise RuntimeError(
                    f"Supabase identity could not be provisioned: {result.get('reason') or 'identity already exists'}",
                )
            db.add(
                AuditLog(
                    actor_user_id=None,
                    action="supabase_identity_recovered",
                    target_type="user",
                    target_id=local_user.id,
                    details_json={
                        "email": normalized_email,
                        "reason": "missing_auth_identity_recovery",
                    },
                ),
            )
            db.commit()
        return temporary_password

    update = httpx.put(
        f"{base_url}/auth/v1/admin/users/{auth_user['id']}",
        headers=headers,
        json={"password": temporary_password},
        timeout=20,
    )
    update.raise_for_status()

    with SessionLocal() as db:
        local_user = db.scalar(
            select(User).where(func.lower(func.trim(User.email)) == normalized_email),
        )
        db.add(
            AuditLog(
                actor_user_id=None,
                action="supabase_password_reset",
                target_type="user",
                target_id=local_user.id if local_user else None,
                details_json={
                    "email": normalized_email,
                    "reason": "administrator_access_recovery",
                },
            ),
        )
        db.commit()
    return temporary_password


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset a provisioned Supabase user's password.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--create-if-missing", action="store_true")
    args = parser.parse_args()
    password = reset_password(args.email, create_if_missing=args.create_if_missing)
    print(f"EMAIL={args.email.strip().lower()}")
    print(f"TEMPORARY_PASSWORD={password}")
    print("STATUS=reset")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
