import json
from unittest.mock import MagicMock

import fakeredis.aioredis
import pytest

from app.core.config import Settings
from app.core.errors import AppError
from app.schemas.biometrics import VerificationRequest
from app.services.biometrics import BiometricService


def service(redis: fakeredis.aioredis.FakeRedis) -> BiometricService:
    database = MagicMock()
    manager = MagicMock()
    return BiometricService(database, redis, Settings(app_env="test", _env_file=None), manager)


async def challenge(redis: fakeredis.aioredis.FakeRedis, challenge_id: str = "challenge-1") -> None:
    await redis.set(
        f"face:challenge:{challenge_id}",
        json.dumps({"challengeId": challenge_id, "userId": "user-1", "employeeId": "employee-1", "action": "check-in", "steps": ["blink"]}),
        ex=30,
    )


def code(error: AppError) -> str:
    return error.details[0]["code"]


async def test_challenge_is_single_use() -> None:
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    await challenge(redis)
    biometric = service(redis)
    user = {"_id": "user-1"}
    consumed = await biometric._consume_challenge("challenge-1", user, ["blink"], "check-in")
    assert consumed["employeeId"] == "employee-1"
    with pytest.raises(AppError) as repeated:
        await biometric._consume_challenge("challenge-1", user, ["blink"], "check-in")
    assert code(repeated.value) == "CHALLENGE_ALREADY_USED"
    await redis.aclose()


async def test_expired_challenge_is_rejected() -> None:
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    with pytest.raises(AppError) as expired:
        await service(redis)._consume_challenge("missing", {"_id": "user-1"}, ["blink"])
    assert code(expired.value) == "CHALLENGE_EXPIRED"
    await redis.aclose()


async def test_challenge_cannot_be_used_by_another_user() -> None:
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    await challenge(redis)
    with pytest.raises(AppError) as mismatch:
        await service(redis)._consume_challenge("challenge-1", {"_id": "user-2"}, ["blink"])
    assert code(mismatch.value) == "CHALLENGE_EMPLOYEE_MISMATCH"
    await redis.aclose()


def test_attendance_verification_accepts_missing_location() -> None:
    request = VerificationRequest(
        challengeId="challenge-1",
        completedSteps=["blink"],
        proofImage="data:image/jpeg;base64," + "a" * 100,
    )
    assert request.location is None


async def test_missing_office_location_is_recorded_as_unavailable() -> None:
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    result = await service(redis)._assess_location("507f1f77bcf86cd799439011", "office", None)
    assert result == {"verified": False, "status": "unavailable"}
    await redis.aclose()
