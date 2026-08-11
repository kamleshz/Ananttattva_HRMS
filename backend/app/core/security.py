import hashlib
import hmac
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import Settings
from app.core.errors import AppError

password_hasher = PasswordHasher(time_cost=3, memory_cost=65_536, parallelism=4)
PASSWORD_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$")


def validate_password_policy(password: str) -> None:
    if not PASSWORD_PATTERN.match(password):
        raise AppError(
            422,
            "Password must be 8-128 characters and include uppercase, lowercase, number, and special character",
        )


def hash_password(password: str) -> str:
    validate_password_policy(password)
    return password_hasher.hash(password)


def upgrade_password_hash(password: str) -> str:
    """Rehash a verified legacy password without changing the user's login contract."""
    return password_hasher.hash(password)


def verify_password(password: str, encoded: str) -> tuple[bool, bool]:
    """Return (matches, needs_argon2_upgrade), supporting legacy bcrypt records."""
    if encoded.startswith(("$2a$", "$2b$", "$2y$")):
        try:
            matches = bcrypt.checkpw(password.encode(), encoded.encode())
        except ValueError:
            return False, False
        return matches, matches
    try:
        matches = password_hasher.verify(encoded, password)
        return matches, matches and password_hasher.check_needs_rehash(encoded)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False, False


def create_access_token(user_id: str, role: str, settings: Settings) -> tuple[str, int]:
    now = datetime.now(UTC)
    expires_in = settings.jwt_expires_minutes * 60
    payload = {
        "sub": user_id,
        "role": role,
        "type": "access",
        "jti": str(uuid.uuid4()),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": now,
        "nbf": now,
        "exp": now + timedelta(seconds=expires_in),
    }
    token = jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm="HS256")
    return token, expires_in


def decode_access_token(token: str, settings: Settings) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=["HS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "role", "type", "jti", "iat", "exp"]},
        )
    except jwt.PyJWTError as exc:
        if not settings.accept_legacy_access_tokens:
            raise AppError(401, "Invalid or expired access token") from exc
        try:
            payload = jwt.decode(
                token,
                settings.jwt_secret.get_secret_value(),
                algorithms=["HS256"],
                options={"require": ["sub", "role", "exp"]},
            )
            payload.setdefault("type", "access")
        except jwt.PyJWTError as legacy_exc:
            raise AppError(401, "Invalid or expired access token") from legacy_exc
    if payload.get("type") != "access":
        raise AppError(401, "Invalid access token")
    return payload


def generate_otp() -> str:
    return f"{secrets.randbelow(900_000) + 100_000:06d}"


def hmac_value(value: str, secret: Any) -> str:
    raw_secret = secret.get_secret_value() if hasattr(secret, "get_secret_value") else str(secret)
    return hmac.new(raw_secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def constant_time_matches(left: str, right: str) -> bool:
    return hmac.compare_digest(left, right)


def new_refresh_token() -> tuple[str, str, str]:
    session_id = str(uuid.uuid4())
    family_id = str(uuid.uuid4())
    secret = secrets.token_urlsafe(48)
    return f"{session_id}.{secret}", session_id, family_id


def parse_refresh_token(token: str) -> tuple[str, str]:
    try:
        session_id, secret = token.split(".", 1)
        uuid.UUID(session_id)
    except (ValueError, AttributeError) as exc:
        raise AppError(401, "Invalid refresh session") from exc
    if len(secret) < 48:
        raise AppError(401, "Invalid refresh session")
    return session_id, secret
