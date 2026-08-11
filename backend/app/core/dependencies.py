from typing import Annotated, Any

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.asynchronous.database import AsyncDatabase
from redis.asyncio import Redis

from app.core.config import Settings, get_settings
from app.core.database import get_database
from app.core.errors import AppError
from app.core.redis import get_redis
from app.core.security import decode_access_token
from app.ml.face_engine import face_engine_manager
from app.repositories.audit import AuditRepository
from app.repositories.users import UserRepository
from app.services.auth import AuthService
from app.services.biometrics import BiometricService
from app.services.email import GraphEmailService

bearer_scheme = HTTPBearer(auto_error=False)


def get_auth_service(
    database: Annotated[AsyncDatabase[dict[str, Any]], Depends(get_database)],
    redis: Annotated[Redis, Depends(get_redis)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthService:
    return AuthService(
        UserRepository(database),
        AuditRepository(database),
        redis,
        GraphEmailService(settings),
        settings,
    )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    database: Annotated[AsyncDatabase[dict[str, Any]], Depends(get_database)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(401, "Authentication required")
    payload = decode_access_token(credentials.credentials, settings)
    user = await UserRepository(database).find_by_id(payload["sub"])
    if not user or not user.get("isActive", True):
        raise AppError(401, "Account is inactive")
    if user.get("role") != payload.get("role"):
        raise AppError(401, "Your access has changed. Please sign in again.")
    return user


CurrentUser = Annotated[dict[str, Any], Depends(get_current_user)]
AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_biometric_service(
    database: Annotated[AsyncDatabase[dict[str, Any]], Depends(get_database)],
    redis: Annotated[Redis, Depends(get_redis)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> BiometricService:
    return BiometricService(database, redis, settings, face_engine_manager)


BiometricServiceDep = Annotated[BiometricService, Depends(get_biometric_service)]
