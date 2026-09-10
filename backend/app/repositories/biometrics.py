import base64
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np
from bson import ObjectId
from cryptography.fernet import Fernet, InvalidToken
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import Settings
from app.core.errors import AppError


class EmbeddingCipher:
    def __init__(self, settings: Settings) -> None:
        configured = settings.face_embedding_key.get_secret_value().encode()
        key = configured or base64.urlsafe_b64encode(
            hashlib.sha256(settings.jwt_secret.get_secret_value().encode()).digest()
        )
        try:
            self.fernet = Fernet(key)
        except ValueError as exc:
            raise RuntimeError("FACE_EMBEDDING_KEY must be a valid Fernet key") from exc

    def encrypt(self, embedding: np.ndarray) -> str:
        raw = json.dumps([round(float(value), 7) for value in embedding], separators=(",", ":")).encode()
        return self.fernet.encrypt(raw).decode()

    def decrypt(self, token: str) -> np.ndarray:
        try:
            values = json.loads(self.fernet.decrypt(token.encode()).decode())
        except (InvalidToken, ValueError, TypeError, json.JSONDecodeError) as exc:
            raise AppError(
                503, "The biometric template cannot be read", [{"code": "BIOMETRIC_TEMPLATE_UNAVAILABLE"}]
            ) from exc
        return np.asarray(values, dtype=np.float32)


class BiometricRepository:
    def __init__(self, database: AsyncDatabase[dict[str, Any]], settings: Settings) -> None:
        self.database = database
        self.employees = database.employees
        self.cipher = EmbeddingCipher(settings)
        self.settings = settings

    async def employee(self, employee_id: str, include_legacy_photos: bool = False) -> dict[str, Any] | None:
        if not ObjectId.is_valid(employee_id):
            return None
        projection: dict[str, int] = {
            "employeeCode": 1,
            "firstName": 1,
            "lastName": 1,
            "department": 1,
            "faceBiometric": 1,
            "biometricTemplateVersion": 1,
        }
        if include_legacy_photos:
            projection["biometricSamples"] = 1
        else:
            projection["biometricTemplate"] = 1
            projection["biometricSamples.pose"] = 1
        return await self.employees.find_one({"_id": ObjectId(employee_id)}, projection)

    async def save_template(self, employee_id: str, *, embeddings: list[np.ndarray], metadata: dict[str, Any]) -> None:
        now = datetime.now(UTC)
        current = await self.employees.find_one({"_id": ObjectId(employee_id)}, {"faceBiometric": 1})
        document = {
            **metadata,
            "encryptedTemplates": [self.cipher.encrypt(item) for item in embeddings],
            "embeddingDimension": int(embeddings[0].size),
            "templateVersion": 2,
            "enrollmentStatus": "active",
            "active": True,
            "enrollmentRequired": False,
            "updatedAt": now,
        }
        document.setdefault("enrolledAt", now)
        update: dict[str, Any] = {"$set": {"faceBiometric": document}}
        if current and current.get("faceBiometric"):
            legacy = {
                **current["faceBiometric"],
                "active": False,
                "archivedAt": now,
                "migrationStatus": "legacy_inactive",
            }
            update["$push"] = {"faceBiometricLegacyHistory": legacy}
        result = await self.employees.update_one({"_id": ObjectId(employee_id)}, update)
        if not result.matched_count:
            raise AppError(404, "Employee not found")

    def decrypt_templates(self, employee: dict[str, Any]) -> list[np.ndarray]:
        biometric = employee.get("faceBiometric", {})
        if (
            biometric.get("engineName") != self.settings.face_engine
            or biometric.get("modelVersion") != self.settings.face_model_version
            or biometric.get("active") is False
        ):
            return []
        return [self.cipher.decrypt(item) for item in biometric.get("encryptedTemplates", [])]

    async def mark_re_enrollment_required(self, employee_id: str) -> None:
        await self.employees.update_one(
            {"_id": ObjectId(employee_id)},
            {
                "$set": {
                    "faceBiometric.migrationStatus": "re_enrollment_required",
                    "faceBiometric.enrollmentRequired": True,
                    "faceBiometric.updatedAt": datetime.now(UTC),
                }
            },
        )

    async def reset(self, employee_id: str) -> None:
        current = await self.employees.find_one({"_id": ObjectId(employee_id)}, {"faceBiometric": 1})
        now = datetime.now(UTC)
        update: dict[str, Any] = {
            "$set": {
                "faceBiometric": {
                    "migrationStatus": "re_enrollment_required",
                    "enrollmentStatus": "disabled",
                    "active": False,
                    "enrollmentRequired": True,
                    "updatedAt": now,
                }
            }
        }
        if current and current.get("faceBiometric"):
            update["$push"] = {
                "faceBiometricLegacyHistory": {
                    **current["faceBiometric"],
                    "active": False,
                    "archivedAt": now,
                    "migrationStatus": "legacy_inactive",
                }
            }
        await self.employees.update_one({"_id": ObjectId(employee_id)}, update)

    async def safe_status(self, employee: dict[str, Any]) -> dict[str, Any]:
        biometric = employee.get("faceBiometric") or {}
        encrypted = biometric.get("encryptedTemplates") or []
        compatible = (
            biometric.get("engineName") == self.settings.face_engine
            and biometric.get("modelVersion") == self.settings.face_model_version
            and biometric.get("active") is not False
        )
        if encrypted and compatible:
            status = biometric.get("migrationStatus", "compatible")
        elif encrypted:
            status = "re_enrollment_required"
        else:
            legacy_dimension = len(employee.get("biometricTemplate") or [])
            legacy_samples = employee.get("biometricSamples") or []
            if legacy_dimension and len(legacy_samples) >= 3:
                status = "migration_required"
            elif legacy_dimension:
                status = "re_enrollment_required"
            else:
                status = "not_enrolled"
        since = datetime.now(UTC) - timedelta(days=30)
        failures = await self.database.auditLogs.count_documents(
            {"entityId": str(employee["_id"]), "action": "BIOMETRIC_VERIFICATION_FAILED", "timestamp": {"$gte": since}}
        )
        manual = await self.database.faceattendancerequests.count_documents(
            {"employee": employee["_id"], "requestedAt": {"$gte": since}}
        )
        last_event = await self.database.auditLogs.find_one(
            {
                "entityId": str(employee["_id"]),
                "action": {
                    "$in": [
                        "BIOMETRIC_VERIFICATION_SUCCESS",
                        "BIOMETRIC_VERIFICATION_FAILED",
                        "FACE_MATCH_FAILED",
                        "FACE_MATCH_LOW_CONFIDENCE",
                    ]
                },
            },
            sort=[("timestamp", -1)],
        )
        return {
            "enrolled": bool(encrypted and compatible),
            "engine": biometric.get("engineName"),
            "detector": biometric.get("detectorName"),
            "recognizer": biometric.get("recognizerName"),
            "modelVersion": biometric.get("modelVersion"),
            "templateVersion": biometric.get("templateVersion"),
            "embeddingDimension": biometric.get("embeddingDimension"),
            "enrollmentRequired": bool(
                biometric.get("enrollmentRequired", status in {"re_enrollment_required", "not_enrolled"})
            ),
            "migrationStatus": status,
            "enrolledAt": biometric.get("enrolledAt"),
            "updatedAt": biometric.get("updatedAt"),
            "recentVerificationFailureCount": failures,
            "manualAttendanceCount": manual,
            "lastVerificationAt": last_event.get("timestamp") if last_event else None,
            "lastVerificationResult": last_event.get("action") if last_event else None,
            "lastSimilarityScore": (last_event.get("metadata") or {}).get("similarity") if last_event else None,
            "lastLivenessScore": (last_event.get("metadata") or {}).get("livenessScore") if last_event else None,
            "lastFailureReason": (last_event.get("metadata") or {}).get("errorCode") if last_event else None,
        }
