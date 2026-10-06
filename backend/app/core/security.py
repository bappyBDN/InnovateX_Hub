"""Local login fallback (JWT). Replace token validation with Entra ID (OIDC) for production."""
import hashlib
import hmac
import os
from datetime import timedelta

import jwt

from app.core.config import settings
from app.shared.models.base import utcnow

_ITERATIONS = 120_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or stored.count("$") != 2:
        return False
    _, salt_hex, digest_hex = stored.split("$")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), _ITERATIONS)
    return hmac.compare_digest(digest.hex(), digest_hex)


def create_access_token(user_id: str) -> str:
    now = utcnow()
    payload = {"sub": user_id, "iat": now, "exp": now + timedelta(minutes=settings.jwt_expire_minutes)}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str | None:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]).get("sub")
    except jwt.PyJWTError:
        return None


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
