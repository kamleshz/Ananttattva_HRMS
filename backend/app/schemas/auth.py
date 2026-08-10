from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

Role = Literal["super_admin", "admin", "hr_admin", "manager", "finance_admin", "it_admin", "employee"]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    login_type: Literal["admin", "user"] = Field(default="user", alias="loginType")


class VerifyOtpRequest(BaseModel):
    challenge_id: str = Field(alias="challengeId")
    code: str = Field(pattern=r"^\d{6}$")


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    challenge_id: str = Field(alias="challengeId")
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=8, max_length=128, alias="newPassword")


class EmployeeSummary(BaseModel):
    id: str
    employeeCode: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    profilePhoto: str | None = None
    department: str | None = None
    designation: str | None = None


class AuthUser(BaseModel):
    id: str
    firstName: str
    lastName: str
    email: EmailStr
    role: Role
    employee: EmployeeSummary | None = None
    mustChangePassword: bool = False


class LoginChallenge(BaseModel):
    otpRequired: bool = True
    challengeId: str
    email: str
    expiresIn: int
    developmentOtp: str | None = None


class AuthTokens(BaseModel):
    token: str
    tokenType: str = "Bearer"
    expiresIn: int
    user: AuthUser


class RefreshResult(AuthTokens):
    pass


class PasswordResetChallenge(BaseModel):
    challengeId: str
    email: str
    expiresIn: int
    developmentOtp: str | None = None


class PasswordResetResult(BaseModel):
    message: str


class TokenPayload(BaseModel):
    sub: str
    role: Role
    type: str
    jti: str

    @field_validator("sub")
    @classmethod
    def validate_subject(cls, value: str) -> str:
        if not value:
            raise ValueError("Token subject is required")
        return value
