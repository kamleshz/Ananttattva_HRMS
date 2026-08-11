from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "AT Connect"
    app_env: Literal["development", "test", "staging", "production"] = "development"
    host: str = "127.0.0.1"
    port: int = Field(default=7000, ge=1, le=65535)
    log_level: str = "INFO"

    mongodb_uri: SecretStr = SecretStr("mongodb://127.0.0.1:27017/peoplepulse_hr")
    mongodb_database: str = "peoplepulse_hr"
    redis_url: SecretStr = SecretStr("redis://127.0.0.1:6379/0")

    jwt_secret: SecretStr = SecretStr("development-access-secret-change-me")
    refresh_token_secret: SecretStr = SecretStr("development-refresh-secret-change-me")
    jwt_issuer: str = "at-connect-api"
    jwt_audience: str = "at-connect-web"
    jwt_expires_minutes: int = Field(default=15, ge=5, le=60)
    refresh_token_expires_days: int = Field(default=7, ge=1, le=30)

    client_urls: Annotated[list[str], NoDecode] = ["http://127.0.0.1:7173", "http://localhost:7173"]
    otp_expires_minutes: int = Field(default=10, ge=2, le=30)
    otp_resend_seconds: int = Field(default=60, ge=30, le=600)
    otp_max_attempts: int = Field(default=5, ge=3, le=10)
    otp_emails_enabled: bool = True

    seed_admin_email: str = "admin@peoplepulse.local"
    seed_admin_password: SecretStr = SecretStr("ChangeMe123!")
    seed_admin_enabled: bool = True

    ms_client_id: str = ""
    ms_tenant_id: str = ""
    ms_client_secret: SecretStr = SecretStr("")
    mail_sender_email: str = ""
    mail_from_name: str = "AT Connect"
    mail_reply_to: str = ""

    face_engine: Literal["uniface"] = "uniface"
    face_detector: Literal["scrfd_10g", "scrfd_500m"] = "scrfd_10g"
    face_recognizer: Literal["arcface_mnet", "arcface_resnet"] = "arcface_mnet"
    face_model_version: str = "uniface-3.7.1-scrfd10g-arcface-mnet"
    face_match_threshold: float = Field(default=0.45, ge=-1.0, le=1.0)
    face_min_quality: float = Field(default=0.30, ge=0.0, le=1.0)
    face_anti_spoof_enabled: bool = False
    face_anti_spoof_threshold: float = Field(default=0.80, ge=0.0, le=1.0)
    face_challenge_expiry_seconds: int = Field(default=30, ge=15, le=120)
    face_enrollment_challenge_expiry_seconds: int = Field(default=300, ge=120, le=900)
    face_verification_expiry_seconds: int = Field(default=90, ge=30, le=300)
    face_max_retries: int = Field(default=2, ge=1, le=5)
    face_embedding_key: SecretStr = SecretStr("")
    face_model_cache_dir: str = ""
    accept_legacy_access_tokens: bool = True

    @field_validator("client_urls", mode="before")
    @classmethod
    def parse_client_urls(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if self.app_env != "production":
            return self
        insecure_markers = ("development", "change-me", "changeme")
        for name, secret in (
            ("JWT_SECRET", self.jwt_secret),
            ("REFRESH_TOKEN_SECRET", self.refresh_token_secret),
        ):
            raw = secret.get_secret_value().lower()
            if len(raw) < 32 or any(marker in raw for marker in insecure_markers):
                raise ValueError(f"{name} must be a unique secret of at least 32 characters in production")
        if not self.client_urls or any("localhost" in url or "127.0.0.1" in url for url in self.client_urls):
            raise ValueError("CLIENT_URLS must contain production origins in production")
        if self.seed_admin_enabled:
            seed_password = self.seed_admin_password.get_secret_value()
            if seed_password == "ChangeMe123!" or len(seed_password) < 12:
                raise ValueError("SEED_ADMIN_PASSWORD must be changed or SEED_ADMIN_ENABLED=false in production")
        if not self.face_embedding_key.get_secret_value():
            raise ValueError("FACE_EMBEDDING_KEY is required in production")
        return self

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
