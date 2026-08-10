from fastapi import APIRouter, Request, Response

from app.core.dependencies import AuthServiceDep, CurrentUser, SettingsDep
from app.core.errors import AppError
from app.schemas.auth import (
    AuthTokens,
    AuthUser,
    ForgotPasswordRequest,
    LoginChallenge,
    LoginRequest,
    PasswordResetChallenge,
    PasswordResetResult,
    RefreshResult,
    ResetPasswordRequest,
    VerifyOtpRequest,
)
from app.schemas.common import MessageResponse, SuccessResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])
REFRESH_COOKIE = "at_connect_refresh"


def request_metadata(request: Request) -> tuple[str | None, str | None, str | None]:
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",", 1)[0].strip() if forwarded else (request.client.host if request.client else None)
    return ip, request.headers.get("user-agent"), getattr(request.state, "request_id", None)


def set_refresh_cookie(response: Response, token: str, settings: SettingsDep) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.refresh_token_expires_days * 86_400,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        path="/api/auth",
    )


@router.post("/login", response_model=SuccessResponse[LoginChallenge])
async def login(payload: LoginRequest, request: Request, service: AuthServiceDep) -> SuccessResponse[LoginChallenge]:
    ip, _, request_id = request_metadata(request)
    data = await service.login(payload.email, payload.password, payload.login_type, ip=ip, request_id=request_id)
    return SuccessResponse(data=data)


@router.post("/verify-otp", response_model=SuccessResponse[AuthTokens])
async def verify_otp(
    payload: VerifyOtpRequest,
    request: Request,
    response: Response,
    service: AuthServiceDep,
    settings: SettingsDep,
) -> SuccessResponse[AuthTokens]:
    ip, user_agent, request_id = request_metadata(request)
    data, refresh_token = await service.verify_otp(
        payload.challenge_id,
        payload.code,
        ip=ip,
        user_agent=user_agent,
        request_id=request_id,
    )
    set_refresh_cookie(response, refresh_token, settings)
    return SuccessResponse(data=data)


@router.post("/refresh", response_model=SuccessResponse[RefreshResult])
async def refresh(
    request: Request,
    response: Response,
    service: AuthServiceDep,
    settings: SettingsDep,
) -> SuccessResponse[RefreshResult]:
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    if not refresh_token:
        raise AppError(401, "Refresh session required")
    ip, user_agent, _ = request_metadata(request)
    data, rotated_token = await service.refresh(refresh_token, ip=ip, user_agent=user_agent)
    set_refresh_cookie(response, rotated_token, settings)
    return SuccessResponse(data=RefreshResult(**data.model_dump()))


@router.post("/logout", response_model=MessageResponse)
async def logout(request: Request, response: Response, service: AuthServiceDep) -> MessageResponse:
    await service.logout(request.cookies.get(REFRESH_COOKIE))
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth", httponly=True, samesite="strict")
    return MessageResponse(message="Signed out successfully")


@router.post("/forgot-password", response_model=SuccessResponse[PasswordResetChallenge])
async def forgot_password(
    payload: ForgotPasswordRequest, service: AuthServiceDep
) -> SuccessResponse[PasswordResetChallenge]:
    return SuccessResponse(data=await service.request_password_reset(payload.email))


@router.post("/reset-password", response_model=SuccessResponse[PasswordResetResult])
async def reset_password(
    payload: ResetPasswordRequest, service: AuthServiceDep
) -> SuccessResponse[PasswordResetResult]:
    await service.reset_password(payload.challenge_id, payload.code, payload.new_password)
    return SuccessResponse(data=PasswordResetResult(message="Password changed successfully. You can now sign in."))


@router.get("/me", response_model=SuccessResponse[AuthUser])
async def me(user: CurrentUser, service: AuthServiceDep) -> SuccessResponse[AuthUser]:
    return SuccessResponse(data=await service.sanitize_user(user))
