from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.title() for part in tail)


class BiometricModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


AttendanceAction = Literal["check-in", "check-out", "enroll"]
AttendanceMode = Literal["office", "wfh", "client_location", "field_visit"]


class ChallengeRequest(BiometricModel):
    action: AttendanceAction
    attendance_mode: AttendanceMode = "office"
    employee_id: str | None = None


class ChallengeResult(BiometricModel):
    challenge_id: str
    steps: list[str]
    expires_in: int
    max_retries: int


class EnrollmentSample(BiometricModel):
    pose: Literal["front", "left", "right"]
    photo: str = Field(min_length=100, max_length=4_500_000)


class EnrollmentRequest(BiometricModel):
    employee_id: str
    challenge_id: str
    completed_steps: list[str] = Field(min_length=1, max_length=4)
    samples: list[EnrollmentSample] = Field(min_length=3, max_length=3)


class LocationInput(BiometricModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: float = Field(gt=0, le=10_000)


class VerificationRequest(BiometricModel):
    challenge_id: str
    completed_steps: list[str] = Field(min_length=1, max_length=4)
    proof_image: str = Field(min_length=100, max_length=4_500_000)
    location: LocationInput


class VerificationResult(BiometricModel):
    verified: bool
    message: str
    verification_token: str | None = None
    mismatch_token: str | None = None
    expires_in: int | None = None


class BiometricStatus(BiometricModel):
    enrolled: bool
    engine: str | None = None
    detector: str | None = None
    recognizer: str | None = None
    model_version: str | None = None
    template_version: int | None = None
    embedding_dimension: int | None = None
    enrollment_required: bool
    migration_status: Literal["compatible", "migrated", "migration_required", "re_enrollment_required", "not_enrolled"]
    enrolled_at: datetime | None = None
    updated_at: datetime | None = None
    recent_verification_failure_count: int = 0
    manual_attendance_count: int = 0


class MigrationResult(BiometricModel):
    employee_id: str
    status: Literal["migration_available", "migrated", "re_enrollment_required", "already_migrated", "not_enrolled"]
    message: str


class BatchMigrationRequest(BiometricModel):
    employee_ids: list[str] = Field(default_factory=list, max_length=100)
    dry_run: bool = True


class ResetBiometricRequest(BiometricModel):
    confirmation: Literal["RESET BIOMETRICS"]
