import json
import uuid
from datetime import UTC, datetime
from typing import Any

from redis.asyncio import Redis
from redis.exceptions import WatchError

from app.core.config import Settings
from app.core.errors import AppError
from app.core.security import (
    constant_time_matches,
    create_access_token,
    generate_otp,
    hash_password,
    hmac_value,
    new_refresh_token,
    parse_refresh_token,
    upgrade_password_hash,
    validate_password_policy,
    verify_password,
)
from app.repositories.audit import AuditRepository
from app.repositories.users import UserRepository
from app.schemas.auth import AuthTokens, AuthUser, EmployeeSummary, LoginChallenge, PasswordResetChallenge
from app.services.email import GraphEmailService

ADMIN_LOGIN_ROLES = {"super_admin", "admin", "it_admin"}


class AuthService:
    def __init__(
        self,
        users: UserRepository,
        audit: AuditRepository,
        redis: Redis,
        email: GraphEmailService,
        settings: Settings,
    ) -> None:
        self.users = users
        self.audit = audit
        self.redis = redis
        self.email = email
        self.settings = settings

    async def login(
        self, email: str, password: str, login_type: str, *, ip: str | None, request_id: str | None
    ) -> LoginChallenge:
        normalized_email = email.lower().strip()
        await self._rate_limit(f"login:{ip or 'unknown'}", limit=10, window_seconds=900)
        user = await self.users.find_by_email(normalized_email)
        matches, needs_upgrade = verify_password(password, user.get("passwordHash", "") if user else "")
        if not user or not matches:
            raise AppError(401, "Invalid email or password")
        if not user.get("isActive", True):
            raise AppError(403, "Your account is inactive")
        role = user.get("role", "employee")
        if login_type == "admin" and role not in ADMIN_LOGIN_ROLES:
            raise AppError(403, "This account does not have administrative access")
        if login_type == "user" and role in ADMIN_LOGIN_ROLES:
            raise AppError(403, "Use Admin Login for this administrative account")
        if needs_upgrade:
            await self.users.update_password(
                user["_id"], upgrade_password_hash(password), bool(user.get("mustChangePassword", False))
            )

        cooldown_key = f"auth:otp:cooldown:{user['_id']}:login"
        if not await self.redis.set(cooldown_key, "1", ex=self.settings.otp_resend_seconds, nx=True):
            raise AppError(429, "Please wait before requesting another code")
        challenge = await self._create_challenge(user, "login")
        delivered = False
        try:
            delivered = await self.email.send_otp(
                normalized_email, user.get("firstName", "there"), challenge["code"], "login"
            )
        except Exception:
            await self.redis.delete(challenge["key"], cooldown_key)
            raise
        await self.audit.record(
            action="LOGIN_OTP_REQUESTED",
            entity_type="user",
            entity_id=str(user["_id"]),
            actor_user_id=str(user["_id"]),
            role=role,
            metadata={"delivery": "email" if delivered else "development"},
            ip=ip,
            request_id=request_id,
        )
        return LoginChallenge(
            challengeId=challenge["id"],
            email=self._mask_email(normalized_email),
            expiresIn=self.settings.otp_expires_minutes * 60,
            developmentOtp=challenge["code"] if not delivered and not self.settings.is_production else None,
        )

    async def verify_otp(
        self,
        challenge_id: str,
        code: str,
        *,
        ip: str | None,
        user_agent: str | None,
        request_id: str | None,
    ) -> tuple[AuthTokens, str]:
        challenge = await self._verify_and_consume_challenge(challenge_id, code, "login")
        user = await self.users.find_by_id(challenge["user_id"])
        if not user or not user.get("isActive", True):
            raise AppError(403, "Your account is inactive")
        await self.users.record_login(user["_id"])
        tokens, refresh_token = await self._issue_session(user, ip=ip, user_agent=user_agent)
        await self.audit.record(
            action="LOGIN_SUCCEEDED",
            entity_type="user",
            entity_id=str(user["_id"]),
            actor_user_id=str(user["_id"]),
            actor_employee_id=str(user["employee"]) if user.get("employee") else None,
            role=user.get("role"),
            ip=ip,
            user_agent=user_agent,
            request_id=request_id,
        )
        return tokens, refresh_token

    async def refresh(self, token: str, *, ip: str | None, user_agent: str | None) -> tuple[AuthTokens, str]:
        session_id, secret = parse_refresh_token(token)
        key = f"auth:refresh:{session_id}"
        for _ in range(3):
            try:
                async with self.redis.pipeline(transaction=True) as pipe:
                    await pipe.watch(key)
                    raw = await pipe.get(key)
                    if not raw:
                        family = await self.redis.get(f"auth:refresh:used:{session_id}")
                        if family:
                            await self.redis.set(
                                f"auth:refresh:family-revoked:{family}",
                                "1",
                                ex=self.settings.refresh_token_expires_days * 86_400,
                            )
                        raise AppError(401, "Refresh session expired or already used")
                    session = json.loads(raw)
                    if await self.redis.exists(f"auth:refresh:family-revoked:{session['family_id']}"):
                        raise AppError(401, "Refresh session has been revoked")
                    revoked_after = await self.redis.get(f"auth:refresh:user-revoked-after:{session['user_id']}")
                    if revoked_after and session.get("issued_at", "") <= revoked_after:
                        raise AppError(401, "Refresh session has been revoked")
                    digest = hmac_value(secret, self.settings.refresh_token_secret)
                    if not constant_time_matches(digest, session["digest"]):
                        raise AppError(401, "Invalid refresh session")
                    pipe.multi()
                    pipe.delete(key)
                    pipe.set(
                        f"auth:refresh:used:{session_id}",
                        session["family_id"],
                        ex=self.settings.refresh_token_expires_days * 86_400,
                    )
                    await pipe.execute()
                    break
            except WatchError:
                continue
        else:
            raise AppError(409, "Refresh session changed; sign in again")
        user = await self.users.find_by_id(session["user_id"])
        if not user or not user.get("isActive", True):
            raise AppError(401, "Account is inactive")
        return await self._issue_session(user, ip=ip, user_agent=user_agent, family_id=session["family_id"])

    async def logout(self, refresh_token: str | None) -> None:
        if not refresh_token:
            return
        try:
            session_id, _ = parse_refresh_token(refresh_token)
        except AppError:
            return
        await self.redis.delete(f"auth:refresh:{session_id}")

    async def request_password_reset(self, email: str) -> PasswordResetChallenge:
        normalized_email = email.lower().strip()
        await self._rate_limit(f"password-reset:{normalized_email}", limit=3, window_seconds=900)
        user = await self.users.find_by_email(normalized_email)
        challenge_id = str(uuid.uuid4())
        if not user or not user.get("isActive", True):
            return PasswordResetChallenge(
                challengeId=challenge_id,
                email=self._mask_email(normalized_email),
                expiresIn=self.settings.otp_expires_minutes * 60,
            )
        cooldown_key = f"auth:otp:cooldown:{user['_id']}:password_reset"
        if not await self.redis.set(cooldown_key, "1", ex=self.settings.otp_resend_seconds, nx=True):
            raise AppError(429, "Please wait before requesting another reset code")
        challenge = await self._create_challenge(user, "password_reset", challenge_id)
        try:
            delivered = await self.email.send_otp(
                normalized_email, user.get("firstName", "there"), challenge["code"], "password_reset"
            )
        except Exception:
            await self.redis.delete(challenge["key"], cooldown_key)
            raise
        return PasswordResetChallenge(
            challengeId=challenge["id"],
            email=self._mask_email(normalized_email),
            expiresIn=self.settings.otp_expires_minutes * 60,
            developmentOtp=challenge["code"] if not delivered and not self.settings.is_production else None,
        )

    async def reset_password(self, challenge_id: str, code: str, new_password: str) -> None:
        validate_password_policy(new_password)
        challenge = await self._verify_and_consume_challenge(challenge_id, code, "password_reset")
        user = await self.users.find_by_id(challenge["user_id"])
        if not user or not user.get("isActive", True):
            raise AppError(401, "This reset request is invalid or expired")
        matches, _ = verify_password(new_password, user.get("passwordHash", ""))
        if matches:
            raise AppError(422, "Choose a password different from your current password")
        await self.users.update_password(user["_id"], hash_password(new_password), False)
        await self.redis.set(
            f"auth:refresh:user-revoked-after:{user['_id']}",
            datetime.now(UTC).isoformat(),
            ex=self.settings.refresh_token_expires_days * 86_400,
        )

    async def sanitize_user(self, user: dict[str, Any]) -> AuthUser:
        employee = await self.users.employee_summary(user.get("employee"))
        employee_summary = None
        if employee:
            employee_summary = EmployeeSummary(
                id=str(employee["_id"]),
                employeeCode=employee.get("employeeCode"),
                firstName=employee.get("firstName"),
                lastName=employee.get("lastName"),
                profilePhoto=employee.get("profilePhoto"),
                department=employee.get("department"),
                designation=employee.get("designation"),
            )
        return AuthUser(
            id=str(user["_id"]),
            firstName=user.get("firstName", ""),
            lastName=user.get("lastName", ""),
            email=user["email"],
            role=user.get("role", "employee"),
            employee=employee_summary,
            mustChangePassword=bool(user.get("mustChangePassword", False)),
        )

    async def _issue_session(
        self,
        user: dict[str, Any],
        *,
        ip: str | None,
        user_agent: str | None,
        family_id: str | None = None,
    ) -> tuple[AuthTokens, str]:
        access_token, expires_in = create_access_token(str(user["_id"]), user.get("role", "employee"), self.settings)
        refresh_token, session_id, generated_family = new_refresh_token()
        family = family_id or generated_family
        _, secret = parse_refresh_token(refresh_token)
        record = {
            "user_id": str(user["_id"]),
            "family_id": family,
            "digest": hmac_value(secret, self.settings.refresh_token_secret),
            "issued_at": datetime.now(UTC).isoformat(),
            "ip": ip,
            "user_agent": (user_agent or "")[:500],
        }
        await self.redis.set(
            f"auth:refresh:{session_id}",
            json.dumps(record, separators=(",", ":")),
            ex=self.settings.refresh_token_expires_days * 86_400,
        )
        auth_user = await self.sanitize_user(user)
        return AuthTokens(token=access_token, expiresIn=expires_in, user=auth_user), refresh_token

    async def _create_challenge(
        self, user: dict[str, Any], purpose: str, challenge_id: str | None = None
    ) -> dict[str, str]:
        challenge_id = challenge_id or str(uuid.uuid4())
        code = generate_otp()
        key = f"auth:otp:{challenge_id}"
        payload = {
            "user_id": str(user["_id"]),
            "purpose": purpose,
            "code_hash": hmac_value(f"{challenge_id}:{code}", self.settings.jwt_secret),
            "attempts": self.settings.otp_max_attempts,
        }
        await self.redis.set(key, json.dumps(payload, separators=(",", ":")), ex=self.settings.otp_expires_minutes * 60)
        return {"id": challenge_id, "code": code, "key": key}

    async def _verify_and_consume_challenge(self, challenge_id: str, code: str, purpose: str) -> dict[str, Any]:
        try:
            uuid.UUID(challenge_id)
        except ValueError as exc:
            raise AppError(401, "This verification code is invalid or expired") from exc
        key = f"auth:otp:{challenge_id}"
        for _ in range(3):
            try:
                async with self.redis.pipeline(transaction=True) as pipe:
                    await pipe.watch(key)
                    raw = await pipe.get(key)
                    if not raw:
                        raise AppError(401, "This verification code is invalid or expired")
                    challenge = json.loads(raw)
                    if challenge.get("purpose") != purpose:
                        raise AppError(401, "This verification code is invalid or expired")
                    supplied = hmac_value(f"{challenge_id}:{code}", self.settings.jwt_secret)
                    if not constant_time_matches(supplied, challenge["code_hash"]):
                        attempts = int(challenge.get("attempts", 1)) - 1
                        pipe.multi()
                        if attempts <= 0:
                            pipe.delete(key)
                        else:
                            challenge["attempts"] = attempts
                            ttl = max(1, await self.redis.ttl(key))
                            pipe.set(key, json.dumps(challenge, separators=(",", ":")), ex=ttl)
                        await pipe.execute()
                        if attempts <= 0:
                            raise AppError(429, "Too many incorrect attempts. Request a new code.")
                        raise AppError(
                            401, f"Incorrect code. {attempts} attempt{'s' if attempts != 1 else ''} remaining."
                        )
                    pipe.multi()
                    pipe.delete(key)
                    await pipe.execute()
                    return challenge
            except WatchError:
                continue
        raise AppError(409, "Verification state changed. Try again.")

    async def _rate_limit(self, bucket: str, *, limit: int, window_seconds: int) -> None:
        key = f"rate:{bucket}"
        count = await self.redis.incr(key)
        if count == 1:
            await self.redis.expire(key, window_seconds)
        if count > limit:
            raise AppError(429, "Too many attempts. Please try again later.")

    @staticmethod
    def _mask_email(email: str) -> str:
        name, separator, domain = email.partition("@")
        if not separator:
            return "***"
        visible = name[:2]
        return f"{visible}{'*' * max(2, len(name) - len(visible))}@{domain}"
