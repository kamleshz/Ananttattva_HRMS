from typing import Any

import fakeredis.aioredis
import pytest
from bson import ObjectId

from app.core.config import Settings
from app.core.errors import AppError
from app.core.security import hash_password
from app.services.auth import AuthService


class MemoryUsers:
    def __init__(self) -> None:
        self.user: dict[str, Any] = {
            "_id": ObjectId(),
            "firstName": "Asha",
            "lastName": "Patel",
            "email": "asha@example.com",
            "passwordHash": hash_password("Str0ng!Password"),
            "role": "employee",
            "employee": None,
            "isActive": True,
            "mustChangePassword": False,
        }
        self.login_recorded = False

    async def find_by_email(self, email: str) -> dict[str, Any] | None:
        return self.user if email == self.user["email"] else None

    async def find_by_id(self, user_id: str) -> dict[str, Any] | None:
        return self.user if user_id == str(self.user["_id"]) else None

    async def employee_summary(self, _: object) -> None:
        return None

    async def update_password(self, _: ObjectId, password_hash: str, must_change: bool = False) -> None:
        self.user["passwordHash"] = password_hash
        self.user["mustChangePassword"] = must_change

    async def record_login(self, _: ObjectId) -> None:
        self.login_recorded = True


class MemoryAudit:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def record(self, **event: Any) -> None:
        self.events.append(event)


class DevelopmentEmail:
    async def send_otp(self, recipient: str, first_name: str, code: str, purpose: str) -> bool:
        assert recipient == "asha@example.com"
        assert first_name == "Asha"
        assert len(code) == 6
        assert purpose in {"login", "password_reset"}
        return False


@pytest.fixture
async def auth_service() -> tuple[AuthService, MemoryUsers, MemoryAudit]:
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    users = MemoryUsers()
    audit = MemoryAudit()
    settings = Settings(app_env="test", otp_emails_enabled=False)
    service = AuthService(users, audit, redis, DevelopmentEmail(), settings)  # type: ignore[arg-type]
    yield service, users, audit
    await redis.aclose()


async def test_otp_is_single_use_and_issues_rotating_session(
    auth_service: tuple[AuthService, MemoryUsers, MemoryAudit],
) -> None:
    service, users, audit = auth_service
    challenge = await service.login(
        "asha@example.com",
        "Str0ng!Password",
        "user",
        ip="127.0.0.1",
        request_id="request-1",
    )
    assert challenge.developmentOtp

    tokens, refresh_token = await service.verify_otp(
        challenge.challengeId,
        challenge.developmentOtp,
        ip="127.0.0.1",
        user_agent="pytest",
        request_id="request-2",
    )
    assert tokens.user.email == "asha@example.com"
    assert tokens.token
    assert users.login_recorded is True
    assert [event["action"] for event in audit.events] == ["LOGIN_OTP_REQUESTED", "LOGIN_SUCCEEDED"]

    with pytest.raises(AppError, match="invalid or expired"):
        await service.verify_otp(
            challenge.challengeId,
            challenge.developmentOtp,
            ip="127.0.0.1",
            user_agent="pytest",
            request_id="request-3",
        )

    refreshed, rotated_token = await service.refresh(refresh_token, ip="127.0.0.1", user_agent="pytest")
    assert refreshed.token != tokens.token
    assert rotated_token != refresh_token

    with pytest.raises(AppError, match="already used"):
        await service.refresh(refresh_token, ip="127.0.0.1", user_agent="pytest")

    with pytest.raises(AppError, match="revoked"):
        await service.refresh(rotated_token, ip="127.0.0.1", user_agent="pytest")


async def test_incorrect_otp_tracks_attempts(auth_service: tuple[AuthService, MemoryUsers, MemoryAudit]) -> None:
    service, _, _ = auth_service
    challenge = await service.login(
        "asha@example.com",
        "Str0ng!Password",
        "user",
        ip="127.0.0.2",
        request_id="request-4",
    )
    with pytest.raises(AppError, match="4 attempts remaining"):
        await service.verify_otp(
            challenge.challengeId,
            "000000" if challenge.developmentOtp != "000000" else "999999",
            ip="127.0.0.2",
            user_agent="pytest",
            request_id="request-5",
        )
