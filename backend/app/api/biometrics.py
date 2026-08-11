from typing import Annotated, Any

from bson import ObjectId
from fastapi import APIRouter, Depends, Query, Request
from pymongo.asynchronous.database import AsyncDatabase

from app.core.database import get_database
from app.core.dependencies import BiometricServiceDep, CurrentUser
from app.core.errors import AppError
from app.core.permissions import require_role
from app.repositories.audit import AuditRepository
from app.schemas.biometrics import (
    BatchMigrationRequest,
    BiometricStatus,
    ChallengeRequest,
    ChallengeResult,
    EnrollmentRequest,
    MigrationResult,
    ResetBiometricRequest,
    VerificationRequest,
    VerificationResult,
)
from app.schemas.common import MessageResponse, SuccessResponse

router = APIRouter(prefix="/biometrics", tags=["Biometrics"])
admin_router = APIRouter(tags=["Biometric Administration"])
BiometricAdmin = Annotated[dict[str, Any], Depends(require_role("super_admin", "admin", "hr_admin"))]


def metadata(request: Request) -> dict[str, str | None]:
    forwarded = request.headers.get("x-forwarded-for")
    return {
        "ip": forwarded.split(",", 1)[0].strip() if forwarded else (request.client.host if request.client else None),
        "user_agent": request.headers.get("user-agent"),
        "request_id": getattr(request.state, "request_id", None),
    }


@router.post("/challenge", response_model=SuccessResponse[ChallengeResult])
async def challenge(payload: ChallengeRequest, user: CurrentUser, service: BiometricServiceDep) -> SuccessResponse[ChallengeResult]:
    return SuccessResponse(data=await service.create_challenge(user, payload))


@router.post("/enroll", response_model=SuccessResponse[BiometricStatus])
async def enroll(payload: EnrollmentRequest, request: Request, user: CurrentUser, service: BiometricServiceDep) -> SuccessResponse[BiometricStatus]:
    return SuccessResponse(data=await service.enroll(user, payload, metadata(request)))


@router.post("/verify", response_model=SuccessResponse[VerificationResult])
async def verify(payload: VerificationRequest, request: Request, user: CurrentUser, service: BiometricServiceDep) -> SuccessResponse[VerificationResult]:
    return SuccessResponse(data=await service.verify(user, payload, metadata(request)))


@router.get("/me/status", response_model=SuccessResponse[BiometricStatus])
async def my_status(user: CurrentUser, service: BiometricServiceDep) -> SuccessResponse[BiometricStatus]:
    employee_id = str(user.get("employee") or "")
    if not employee_id:
        raise AppError(409, "No employee profile is linked to this account")
    return SuccessResponse(data=await service.status(employee_id))


@router.post("/re-enroll-request", response_model=MessageResponse)
async def request_re_enrollment(
    request: Request,
    user: CurrentUser,
    database: Annotated[AsyncDatabase[dict[str, Any]], Depends(get_database)],
) -> MessageResponse:
    employee_id = user.get("employee")
    if not employee_id:
        raise AppError(409, "No employee profile is linked to this account")
    reviewers = await database.users.find({"role": {"$in": ["super_admin", "hr_admin"]}, "isActive": True}, {"_id": 1}).to_list(length=100)
    for reviewer in reviewers:
        await database.notifications.update_one(
            {"recipient": reviewer["_id"], "dedupeKey": f"biometric-reenroll:{employee_id}"},
            {"$setOnInsert": {"recipient": reviewer["_id"], "dedupeKey": f"biometric-reenroll:{employee_id}", "type": "Biometric Re-enrollment", "title": "Biometric re-enrollment requested", "message": "An employee requested live UniFace enrollment.", "employee": employee_id}},
            upsert=True,
        )
    await AuditRepository(database).record(action="BIOMETRIC_REENROLLMENT_REQUESTED", entity_type="Employee", entity_id=str(employee_id), actor_user_id=str(user["_id"]), actor_employee_id=str(employee_id), role=user.get("role"), **metadata(request))
    return MessageResponse(message="Your re-enrollment request was sent to HR.")


@admin_router.get("/employees/{employee_id}/biometrics/status", response_model=SuccessResponse[BiometricStatus])
async def employee_status(employee_id: str, _: BiometricAdmin, service: BiometricServiceDep) -> SuccessResponse[BiometricStatus]:
    return SuccessResponse(data=await service.status(employee_id))


@admin_router.post("/employees/{employee_id}/biometrics/reset", response_model=MessageResponse)
async def reset_biometrics(
    employee_id: str, payload: ResetBiometricRequest, request: Request, user: BiometricAdmin,
    service: BiometricServiceDep, database: Annotated[AsyncDatabase[dict[str, Any]], Depends(get_database)],
) -> MessageResponse:
    if not ObjectId.is_valid(employee_id) or not await service.repository.employee(employee_id):
        raise AppError(404, "Employee not found")
    await service.repository.reset(employee_id)
    await AuditRepository(database).record(action="BIOMETRIC_RESET", entity_type="Employee", entity_id=employee_id, actor_user_id=str(user["_id"]), actor_employee_id=str(user.get("employee") or "") or None, role=user.get("role"), metadata={"confirmation": payload.confirmation}, **metadata(request))
    return MessageResponse(message="UniFace biometric access was reset. Legacy data was preserved.")


@admin_router.post("/admin/biometrics/migrate/{employee_id}", response_model=SuccessResponse[MigrationResult])
async def migrate_employee(employee_id: str, request: Request, user: BiometricAdmin, service: BiometricServiceDep) -> SuccessResponse[MigrationResult]:
    return SuccessResponse(data=await service.migrate(user, employee_id, metadata(request)))


@admin_router.post("/admin/biometrics/migrate-batch", response_model=SuccessResponse[list[MigrationResult]])
async def migrate_batch(payload: BatchMigrationRequest, request: Request, user: BiometricAdmin, service: BiometricServiceDep) -> SuccessResponse[list[MigrationResult]]:
    return SuccessResponse(data=await service.migrate_batch(user, payload, metadata(request)))


@admin_router.get("/admin/biometrics/health-report", response_model=SuccessResponse[dict[str, Any]])
async def biometric_health_report(
    _: BiometricAdmin,
    service: BiometricServiceDep,
    days: int = Query(default=30, ge=1, le=365),
) -> SuccessResponse[dict[str, Any]]:
    return SuccessResponse(data=await service.health_report(days))
