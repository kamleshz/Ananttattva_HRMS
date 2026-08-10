import pytest

from app.core.config import Settings
from app.core.errors import AppError
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    validate_password_policy,
    verify_password,
)


def test_argon2_password_round_trip() -> None:
    encoded = hash_password("Str0ng!Password")
    matches, needs_upgrade = verify_password("Str0ng!Password", encoded)
    assert matches is True
    assert needs_upgrade is False
    assert verify_password("wrong", encoded)[0] is False


def test_legacy_bcrypt_password_requests_upgrade() -> None:
    import bcrypt

    legacy = bcrypt.hashpw(b"Str0ng!Password", bcrypt.gensalt()).decode()
    assert verify_password("Str0ng!Password", legacy) == (True, True)


def test_legacy_bcrypt_rejects_overlong_input_without_server_error() -> None:
    import bcrypt

    legacy = bcrypt.hashpw(b"short-password", bcrypt.gensalt()).decode()
    assert verify_password("x" * 100, legacy) == (False, False)


@pytest.mark.parametrize("password", ["short", "alllowercase1!", "ALLUPPERCASE1!", "NoNumber!", "NoSpecial1"])
def test_password_policy_rejects_weak_passwords(password: str) -> None:
    with pytest.raises(AppError):
        validate_password_policy(password)


def test_access_token_has_expected_claims() -> None:
    settings = Settings(app_env="test")
    token, expires_in = create_access_token("507f1f77bcf86cd799439011", "employee", settings)
    payload = decode_access_token(token, settings)
    assert expires_in == settings.jwt_expires_minutes * 60
    assert payload["sub"] == "507f1f77bcf86cd799439011"
    assert payload["role"] == "employee"
    assert payload["type"] == "access"
