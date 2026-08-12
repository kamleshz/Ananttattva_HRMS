import asyncio
import hashlib
import json
import math
import secrets
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase
from redis.asyncio import Redis

from app.core.config import Settings
from app.core.errors import AppError
from app.ml.face_engine import FaceAnalysis, FaceEngineManager
from app.repositories.audit import AuditRepository
from app.repositories.biometrics import BiometricRepository
from app.schemas.biometrics import (
    BatchMigrationRequest,
    BiometricStatus,
    ChallengeRequest,
    ChallengeResult,
    EnrollmentRequest,
    MigrationResult,
    VerificationRequest,
    VerificationResult,
)


def _identifier(value: Any) -> str:
    return str(value) if value is not None else ""


class BiometricService:
    def __init__(self, database: AsyncDatabase[dict[str, Any]], redis: Redis, settings: Settings, manager: FaceEngineManager) -> None:
        self.database = database
        self.redis = redis
        self.settings = settings
        self.manager = manager
        self.repository = BiometricRepository(database, settings)
        self.audit = AuditRepository(database)

    async def _target_employee(self, user: dict[str, Any], requested: str | None) -> str:
        own = _identifier(user.get("employee"))
        if requested and requested != own and user.get("role") not in {"super_admin", "admin", "hr_admin"}:
            raise AppError(403, "You cannot create a biometric challenge for this employee")
        target = requested or own
        if not target or not ObjectId.is_valid(target) or not await self.database.employees.find_one({"_id": ObjectId(target)}, {"_id": 1}):
            raise AppError(409, "An active employee profile is required")
        return target

    async def create_challenge(self, user: dict[str, Any], payload: ChallengeRequest) -> ChallengeResult:
        self.manager.get()
        employee_id = await self._target_employee(user, payload.employee_id)
        challenge_id = str(uuid.uuid4())
        pool = ["blink", "smile", "turn_left", "turn_right"]
        steps = ["front", "left", "right"] if payload.action == "enroll" else secrets.SystemRandom().sample(pool, 1)
        expires_in = self.settings.face_enrollment_challenge_expiry_seconds if payload.action == "enroll" else self.settings.face_challenge_expiry_seconds
        now = datetime.now(UTC)
        document = {
            "challengeId": challenge_id, "userId": _identifier(user["_id"]), "employeeId": employee_id,
            "action": payload.action, "attendanceMode": payload.attendance_mode, "steps": steps,
            "nonce": secrets.token_urlsafe(24), "createdAt": now.isoformat(),
            "expiresAt": (now + timedelta(seconds=expires_in)).isoformat(),
        }
        await self.redis.set(f"face:challenge:{challenge_id}", json.dumps(document), ex=expires_in)
        return ChallengeResult(challenge_id=challenge_id, steps=steps, expires_in=expires_in, max_retries=self.settings.face_max_retries)

    async def _consume_challenge(self, challenge_id: str, user: dict[str, Any], completed_steps: list[str], expected_action: str | None = None) -> dict[str, Any]:
        used_key = f"face:challenge-used:{challenge_id}"
        key = f"face:challenge:{challenge_id}"
        raw = await self.redis.getdel(key)
        if raw is None:
            code = "CHALLENGE_ALREADY_USED" if await self.redis.exists(used_key) else "CHALLENGE_EXPIRED"
            raise AppError(401, "The liveness challenge expired or was already used", [{"code": code}])
        await self.redis.set(used_key, "1", ex=300)
        challenge = json.loads(raw)
        if challenge.get("userId") != _identifier(user["_id"]):
            raise AppError(403, "This liveness challenge belongs to another user", [{"code": "CHALLENGE_EMPLOYEE_MISMATCH"}])
        if expected_action and challenge.get("action") != expected_action:
            raise AppError(401, "The liveness challenge action is invalid", [{"code": "CHALLENGE_ACTION_MISMATCH"}])
        if completed_steps != challenge.get("steps"):
            raise AppError(422, "Complete every liveness step in the displayed order", [{"code": "LIVENESS_FAILED"}])
        return challenge

    async def _analyze(self, photo: str) -> FaceAnalysis:
        return await asyncio.to_thread(self.manager.get().analyze, photo)

    async def enroll(self, user: dict[str, Any], payload: EnrollmentRequest, request_meta: dict[str, str | None]) -> BiometricStatus:
        if user.get("role") not in {"super_admin", "admin", "hr_admin"}:
            raise AppError(403, "Only authorized HR administrators can enroll biometrics")
        challenge = await self._consume_challenge(payload.challenge_id, user, payload.completed_steps, "enroll")
        if challenge["employeeId"] != payload.employee_id:
            raise AppError(403, "The challenge does not belong to this employee")
        poses = [sample.pose for sample in payload.samples]
        if sorted(poses) != ["front", "left", "right"]:
            raise AppError(422, "Front, left and right enrollment samples are required")
        analyses = [await self._analyze(sample.photo) for sample in payload.samples]
        engine = self.manager.get()
        similarities = [engine.compare_embeddings(analyses[i].embedding, analyses[j].embedding) for i in range(3) for j in range(i + 1, 3)]
        if min(similarities) < self.settings.face_match_threshold:
            raise AppError(422, "Enrollment photos are not sufficiently consistent. Retake all three poses.", [{"code": "ENROLLMENT_IDENTITY_INCONSISTENT"}])
        old = await self.repository.employee(payload.employee_id)
        await self.repository.save_template(
            payload.employee_id,
            embeddings=[item.embedding for item in analyses],
            metadata={
                "engineName": "uniface", "detectorName": self.settings.face_detector, "recognizerName": self.settings.face_recognizer,
                "modelVersion": self.settings.face_model_version, "migrationStatus": "compatible", "enrolledBy": user["_id"],
                "enrollmentQuality": [{"pose": sample.pose, "score": analysis.quality.score, "photoHash": hashlib.sha256(sample.photo.encode()).hexdigest()} for sample, analysis in zip(payload.samples, analyses, strict=True)],
            },
        )
        action = "BIOMETRIC_REENROLLED" if old and (old.get("faceBiometric") or old.get("biometricTemplateVersion")) else "BIOMETRIC_ENROLLED"
        await self.audit.record(action=action, entity_type="Employee", entity_id=payload.employee_id, actor_user_id=_identifier(user["_id"]), actor_employee_id=_identifier(user.get("employee")) or None, role=user.get("role"), metadata={"engine": "uniface", "modelVersion": self.settings.face_model_version, "sampleCount": 3}, **request_meta)
        return await self.status(payload.employee_id)

    async def _assess_location(self, employee_id: str, mode: str, location: Any | None) -> dict[str, Any]:
        def distance(target: dict[str, Any]) -> float:
            lat1, lon1, lat2, lon2 = map(math.radians, [location.latitude, location.longitude, target["latitude"], target["longitude"]])
            value = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
            return 6_371_000 * 2 * math.atan2(math.sqrt(value), math.sqrt(1-value))
        if mode == "office":
            if location is None:
                return {"verified": False, "status": "unavailable"}
            offices = await self.database.officelocations.find({"isActive": True}).to_list(length=100)
            if not offices:
                return {"verified": False, "status": "not_configured", "latitude": location.latitude, "longitude": location.longitude, "accuracyMeters": round(location.accuracy_meters)}
            office = min(offices, key=distance)
            measured = distance(office)
            accurate = location.accuracy_meters <= office.get("maximumAccuracyMeters", 150)
            within_boundary = max(0, measured-location.accuracy_meters) <= office.get("allowedRadiusMeters", 100)
            return {"verified": accurate and within_boundary, "status": "verified" if accurate and within_boundary else "low_accuracy" if not accurate else "outside_boundary", "officeId": str(office["_id"]), "latitude": location.latitude, "longitude": location.longitude, "distanceMeters": round(measured), "accuracyMeters": round(location.accuracy_meters)}
        now = datetime.now(UTC)
        arrangement = await self.database.workarrangementrequests.find_one({"employee": ObjectId(employee_id), "type": mode, "status": "approved", "startDate": {"$lte": now}, "endDate": {"$gte": now}})
        if not arrangement:
            raise AppError(403, "An approved work arrangement is required for today", [{"code": "WORK_ARRANGEMENT_REQUIRED"}])
        if location is None:
            return {"verified": False, "status": "unavailable", "arrangementId": str(arrangement["_id"])}
        if location.accuracy_meters > 150:
            return {"verified": False, "status": "low_accuracy", "arrangementId": str(arrangement["_id"]), "latitude": location.latitude, "longitude": location.longitude, "accuracyMeters": round(location.accuracy_meters)}
        destination = arrangement.get("destination") or {}
        if destination.get("latitude") is None or destination.get("longitude") is None:
            return {"verified": False, "status": "destination_not_configured", "arrangementId": str(arrangement["_id"]), "latitude": location.latitude, "longitude": location.longitude, "accuracyMeters": round(location.accuracy_meters)}
        measured = distance(destination)
        within_boundary = max(0, measured-location.accuracy_meters) <= destination.get("allowedRadiusMeters", 250)
        return {"verified": within_boundary, "status": "verified" if within_boundary else "outside_boundary", "arrangementId": str(arrangement["_id"]), "latitude": location.latitude, "longitude": location.longitude, "distanceMeters": round(measured), "accuracyMeters": round(location.accuracy_meters)}

    async def verify(self, user: dict[str, Any], payload: VerificationRequest, request_meta: dict[str, str | None]) -> VerificationResult:
        challenge = await self._consume_challenge(payload.challenge_id, user, payload.completed_steps)
        if challenge["action"] not in {"check-in", "check-out"}:
            raise AppError(401, "This challenge cannot be used for attendance")
        employee = await self.repository.employee(challenge["employeeId"])
        if not employee:
            raise AppError(404, "Employee not found")
        templates = self.repository.decrypt_templates(employee)
        if not templates:
            status = await self.repository.safe_status(employee)
            code = "BIOMETRIC_REENROLLMENT_REQUIRED" if status["migrationStatus"] != "not_enrolled" else "BIOMETRIC_NOT_ENROLLED"
            raise AppError(409, "UniFace enrollment is required before face attendance can be used", [{"code": code}])
        try:
            analysis = await self._analyze(payload.proof_image)
            location = await self._assess_location(challenge["employeeId"], challenge["attendanceMode"], payload.location)
            engine = self.manager.get()
            similarity = max(engine.compare_embeddings(analysis.embedding, template) for template in templates)
            photo_hash = hashlib.sha256(payload.proof_image.encode()).hexdigest()
            now = datetime.now(UTC)
            common = {
                "sub": _identifier(user["_id"]), "employeeId": challenge["employeeId"], "mode": challenge["action"],
                "attendanceMode": challenge["attendanceMode"], "challengeId": payload.challenge_id, "photoHash": photo_hash,
                "proofRef": photo_hash, "livenessScore": 1.0, "faceMatchScore": round(similarity, 6),
                "identityTemplateVersion": 4, "engineName": "uniface", "modelVersion": self.settings.face_model_version,
                "locationVerified": bool(location.get("verified")), "locationEvidence": location, "verifiedAt": now.isoformat(), "iat": now,
            }
            if similarity < self.settings.face_match_threshold:
                mismatch = jwt.encode({**common, "purpose": "biometric_mismatch", "attemptedAt": now.isoformat(), "jti": str(uuid.uuid4()), "exp": now + timedelta(minutes=10)}, self.settings.jwt_secret.get_secret_value(), algorithm="HS256")
                await self.audit.record(action="FACE_MATCH_FAILED", entity_type="Employee", entity_id=challenge["employeeId"], actor_user_id=_identifier(user["_id"]), actor_employee_id=challenge["employeeId"], role=user.get("role"), metadata={"engine": "uniface", "modelVersion": self.settings.face_model_version, "threshold": self.settings.face_match_threshold, "similarity": round(similarity, 4)}, **request_meta)
                return VerificationResult(verified=False, message="We couldn't verify your face. Please try again.", mismatch_token=mismatch)
            jti = str(uuid.uuid4())
            token = jwt.encode({**common, "purpose": "biometric_verification", "verified": True, "jti": jti, "exp": now + timedelta(seconds=self.settings.face_verification_expiry_seconds)}, self.settings.jwt_secret.get_secret_value(), algorithm="HS256")
            await self.redis.set(f"face:verification:{jti}", json.dumps({"state": "pending", "employeeId": challenge["employeeId"], "action": challenge["action"]}), ex=self.settings.face_verification_expiry_seconds)
            await self.audit.record(action="BIOMETRIC_VERIFICATION_SUCCESS", entity_type="Employee", entity_id=challenge["employeeId"], actor_user_id=_identifier(user["_id"]), actor_employee_id=challenge["employeeId"], role=user.get("role"), metadata={"engine": "uniface", "modelVersion": self.settings.face_model_version, "qualityPassed": True, "livenessPassed": True, "antiSpoofPassed": analysis.anti_spoof_passed, "locationEvidence": location}, **request_meta)
            return VerificationResult(verified=True, message="Identity verified.", verification_token=token, expires_in=self.settings.face_verification_expiry_seconds)
        except AppError as exc:
            await self.audit.record(action="BIOMETRIC_VERIFICATION_FAILED", entity_type="Employee", entity_id=challenge["employeeId"], actor_user_id=_identifier(user["_id"]), actor_employee_id=challenge["employeeId"], role=user.get("role"), metadata={"errorCode": (exc.details[0].get("code") if exc.details and isinstance(exc.details[0], dict) else "UNKNOWN_ERROR"), "engine": "uniface"}, **request_meta)
            raise

    async def status(self, employee_id: str) -> BiometricStatus:
        employee = await self.repository.employee(employee_id)
        if not employee:
            raise AppError(404, "Employee not found")
        return BiometricStatus.model_validate(await self.repository.safe_status(employee))

    async def migrate(self, user: dict[str, Any], employee_id: str, request_meta: dict[str, str | None]) -> MigrationResult:
        employee = await self.repository.employee(employee_id, include_legacy_photos=True)
        if not employee:
            raise AppError(404, "Employee not found")
        if employee.get("faceBiometric", {}).get("encryptedTemplates"):
            return MigrationResult(employee_id=employee_id, status="already_migrated", message="The employee already has a UniFace template.")
        samples = employee.get("biometricSamples") or []
        trusted = [item for item in samples if item.get("pose") in {"front", "left", "right"} and item.get("photo")]
        if len(trusted) != 3:
            await self.repository.mark_re_enrollment_required(employee_id)
            result = MigrationResult(employee_id=employee_id, status="re_enrollment_required", message="Trusted enrollment photos are unavailable; live re-enrollment is required.")
        else:
            analyses = [await self._analyze(item["photo"]) for item in trusted]
            await self.repository.save_template(employee_id, embeddings=[item.embedding for item in analyses], metadata={"engineName": "uniface", "detectorName": self.settings.face_detector, "recognizerName": self.settings.face_recognizer, "modelVersion": self.settings.face_model_version, "migrationStatus": "migrated", "enrolledBy": user["_id"], "enrollmentQuality": [{"pose": sample["pose"], "score": analysis.quality.score, "photoHash": hashlib.sha256(sample["photo"].encode()).hexdigest()} for sample, analysis in zip(trusted, analyses, strict=True)]})
            result = MigrationResult(employee_id=employee_id, status="migrated", message="Existing trusted photos were migrated to UniFace. Legacy data was preserved for rollback.")
        await self.audit.record(action="BIOMETRIC_MIGRATED" if result.status == "migrated" else "BIOMETRIC_REENROLLMENT_REQUIRED", entity_type="Employee", entity_id=employee_id, actor_user_id=_identifier(user["_id"]), actor_employee_id=_identifier(user.get("employee")) or None, role=user.get("role"), metadata={"status": result.status, "legacyDataPreserved": True}, **request_meta)
        return result

    async def migrate_batch(self, user: dict[str, Any], payload: BatchMigrationRequest, request_meta: dict[str, str | None]) -> list[MigrationResult]:
        ids = payload.employee_ids
        if not ids:
            cursor = self.database.employees.find({"faceBiometric.encryptedTemplates": {"$exists": False}, "biometricTemplate": {"$exists": True}}, {"_id": 1}).limit(100)
            ids = [str(item["_id"]) async for item in cursor]
        if payload.dry_run:
            results = []
            for employee_id in ids:
                employee = await self.repository.employee(employee_id, include_legacy_photos=True)
                photos = [item for item in (employee or {}).get("biometricSamples", []) if item.get("photo")]
                status = "migration_available" if len(photos) == 3 else "re_enrollment_required"
                results.append(MigrationResult(employee_id=employee_id, status=status, message="Dry run only; no data changed."))
            return results
        return [await self.migrate(user, employee_id, request_meta) for employee_id in ids]

    async def health_report(self, days: int) -> dict[str, Any]:
        since = datetime.now(UTC) - timedelta(days=days)
        actions = ["BIOMETRIC_VERIFICATION_SUCCESS", "BIOMETRIC_VERIFICATION_FAILED", "FACE_MATCH_FAILED", "LIVENESS_FAILED", "ANTI_SPOOF_FAILED"]
        events = await self.database.auditLogs.find(
            {"timestamp": {"$gte": since}, "action": {"$in": actions}},
            {"action": 1, "entityId": 1, "metadata": 1, "userAgent": 1, "timestamp": 1},
        ).limit(10_000).to_list(length=10_000)
        employees = await self.database.employees.find({}, {"firstName": 1, "lastName": 1, "department": 1, "faceBiometric.migrationStatus": 1, "faceBiometric.enrollmentRequired": 1, "faceBiometric.encryptedTemplates": 1, "biometricTemplate": 1}).to_list(length=10_000)
        employee_map = {str(item["_id"]): item for item in employees}
        offices = await self.database.officelocations.find({}, {"name": 1}).to_list(length=1_000)
        office_map = {str(item["_id"]): item.get("name") or str(item["_id"]) for item in offices}
        departments = await self.database.departments.find({}, {"name": 1}).to_list(length=1_000)
        department_map = {str(item["_id"]): item.get("name") or str(item["_id"]) for item in departments}

        def browser(user_agent: str) -> str:
            value = user_agent.lower()
            if "edg/" in value:
                return "Edge"
            if "chrome/" in value or "crios/" in value:
                return "Chrome"
            if "safari/" in value:
                return "Safari"
            if "firefox/" in value:
                return "Firefox"
            return "Other / unknown"

        def device(user_agent: str) -> str:
            value = user_agent.lower()
            if any(marker in value for marker in ("iphone", "ipad", "android", "mobile")):
                return "Mobile / tablet"
            return "Desktop / unknown"

        successes = sum(item["action"] == "BIOMETRIC_VERIFICATION_SUCCESS" for item in events)
        face_failures = sum(item["action"] == "FACE_MATCH_FAILED" for item in events)
        liveness_failures = sum(item["action"] in {"LIVENESS_FAILED", "ANTI_SPOOF_FAILED"} or item.get("metadata", {}).get("errorCode") in {"LIVENESS_FAILED", "ANTI_SPOOF_FAILED"} for item in events)
        camera_codes = {"CAMERA_NOT_AVAILABLE", "CAMERA_PERMISSION_DENIED", "CAMERA_INITIALIZATION_FAILED", "CAMERA_CAPTURE_FAILED"}
        camera_failures = await self.database.faceattendancerequests.count_documents({"requestedAt": {"$gte": since}, "$or": [{"reasonCode": {"$in": list(camera_codes)}}, {"biometricAttempt.technicalErrorCode": {"$in": list(camera_codes)}}]})
        manual_fallbacks = await self.database.faceattendancerequests.count_documents({"requestedAt": {"$gte": since}})
        total_attempts = successes + len([item for item in events if item["action"] != "BIOMETRIC_VERIFICATION_SUCCESS"])
        migrated = sum(item.get("faceBiometric", {}).get("migrationStatus") == "migrated" for item in employees)
        requiring = sum(item.get("faceBiometric", {}).get("enrollmentRequired", False) or item.get("faceBiometric", {}).get("migrationStatus") == "re_enrollment_required" for item in employees)
        old_templates = sum(bool(item.get("biometricTemplate")) and not item.get("faceBiometric", {}).get("encryptedTemplates") for item in employees)

        counters: dict[str, Counter[str]] = {name: Counter() for name in ("browser", "device", "office", "employee", "department", "date")}
        for event in events:
            employee = employee_map.get(str(event.get("entityId")), {})
            user_agent = event.get("userAgent") or ""
            metadata = event.get("metadata") or {}
            office_id = (metadata.get("locationEvidence") or {}).get("officeId")
            office = office_map.get(str(office_id), "Not applicable / unknown")
            name = " ".join(filter(None, [employee.get("firstName"), employee.get("lastName")])) or str(event.get("entityId") or "Unknown")
            counters["browser"][browser(user_agent)] += 1
            counters["device"][device(user_agent)] += 1
            counters["office"][str(office)] += 1
            counters["employee"][name] += 1
            department_id = employee.get("department")
            counters["department"][department_map.get(str(department_id), "Unassigned")] += 1
            counters["date"][event["timestamp"].date().isoformat()] += 1

        def rate(value: int, denominator: int) -> float:
            return round(value / denominator * 100, 1) if denominator else 0.0

        return {
            "periodDays": days,
            "generatedAt": datetime.now(UTC),
            "metrics": {
                "biometricSuccessRate": rate(successes, total_attempts),
                "faceMatchFailureRate": rate(face_failures, total_attempts),
                "livenessFailureRate": rate(liveness_failures, total_attempts),
                "cameraFailureRate": rate(camera_failures, total_attempts + manual_fallbacks),
                "manualFallbackRate": rate(manual_fallbacks, successes + manual_fallbacks),
                "employeesRequiringReEnrollment": requiring,
                "employeesUsingOldTemplate": old_templates,
                "employeesMigratedToUniFace": migrated,
            },
            "breakdowns": {key: [{"label": label, "count": count} for label, count in value.most_common(100)] for key, value in counters.items()},
        }
