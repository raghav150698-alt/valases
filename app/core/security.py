import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import get_settings

# Use pbkdf2_sha256 as primary for cross-platform stability.
# Keep bcrypt in the context so existing bcrypt hashes remain verifiable.
pwd_context = CryptContext(
    schemes=["pbkdf2_sha256", "bcrypt"],
    deprecated="auto",
    pbkdf2_sha256__default_rounds=600_000,
)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def hash_generated_secret(secret: str) -> str:
    """Hash a server-generated high-entropy secret without a costly password KDF."""
    key = get_settings().jwt_secret_key.encode("utf-8")
    digest = hmac.new(key, secret.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"hmac_sha256${digest}"


def verify_generated_secret(secret: str, hashed_secret: str) -> bool:
    if not str(hashed_secret or "").startswith("hmac_sha256$"):
        # Invitations created before this optimization remain valid.
        return verify_password(secret, hashed_secret)
    return hmac.compare_digest(hash_generated_secret(secret), hashed_secret)


def create_access_token(subject: str, role: str) -> str:
    settings = get_settings()
    expires_delta = timedelta(minutes=settings.access_token_expire_minutes)
    expire = datetime.now(timezone.utc) + expires_delta
    payload: dict[str, Any] = {"sub": subject, "role": role, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
