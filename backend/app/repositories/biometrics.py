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
        key = configured or base64.urlsafe_b64encode(hashlib.sha256(settings.jwt_secret.get_secret_value().encode()).digest())
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
            raise AppError(503, "The biometric template cannot be read", [{"code": "BIOMETRIC_TEMPLATE_UNAVAILABLE"}]) from exc
        return np.asarray(values, dtype=np.float32)


class BiometricRepository:
    def __init__(self, database: AsyncDatabase[dict[str, Any]], settings: Settings) -> None:
        self.database = database
        self.employees = database.employees
        self.cipher = EmbeddingCipher(settings)

    async def employee(self, employee_id: str, include_legacy_photos: bool = False) -> dict[str, Any] | None:
        if not ObjectId.is_valid(employee_id):
            return None
        projection: dict[str, int] = {"employeeCode": 1, "firstName": 1, "lastName": 1, "department": 1, "faceBiometric": 1, "biometricTemplateVersion": 1}
        if include_legacy_photos:
            projection["biometricSamples"] = 1
        else:
            projection["biometricTemplate"] = 1
            projection["biometricSamples.pose"] = 1
        return await self.employees.find_one({"_id": ObjectId(employee_id)}, projection)

    async def save_template(self, employee_id: str, *, embeddings: list[np.ndarray], metadata: dict[str, Any]) -> None:
        now = datetime.now(UTC)
        document = {
            **metadata,
            "encryptedTemplates": [self.cipher.encrypt(item) for item in embeddings],
            "embeddingDimension": int(embeddings[0].size),
            "templateVersion": 1,
            "enrollmentRequired": False,
            "updatedAt": now,
        }
        document.setdefault("enrolledAt", now)
        result = await self.employees.update_one({"_id": ObjectId(employee_id)}, {"$set": {"faceBiometric": document}})
        if not result.matched_count:
            raise AppError(404, "Employee not found")

    def decrypt_templates(self, employee: dict[str, Any]) -> list[np.ndarray]:
        return [self.cipher.decrypt(item) for item in employee.get("faceBiometric", {}).get("encryptedTemplates", [])]

    async def mark_re_enrollment_required(self, employee_id: str) -> None:
        await self.employees.update_one(
            {"_id": ObjectId(employee_id)},
            {"$set": {"faceBiometric.migrationStatus": "re_enrollment_required", "faceBiometric.enrollmentRequired": True, "faceBiometric.updatedAt": datetime.now(UTC)}},
        )

    async def reset(self, employee_id: str) -> None:
        await self.employees.update_one(
            {"_id": ObjectId(employee_id)},
            {"$set": {"faceBiometric": {"migrationStatus": "re_enrollment_required", "enrollmentRequired": True, "updatedAt": datetime.now(UTC)}}},
        )

    async def safe_status(self, employee: dict[str, Any]) -> dict[str, Any]:
        biometric = employee.get("faceBiometric") or {}
        encrypted = biometric.get("encryptedTemplates") or []
        if encrypted:
            status = biometric.get("migrationStatus", "compatible")
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
        failures = await self.database.auditLogs.count_documents({"entityId": str(employee["_id"]), "action": "BIOMETRIC_VERIFICATION_FAILED", "timestamp": {"$gte": since}})
        manual = await self.database.faceattendancerequests.count_documents({"employee": employee["_id"], "requestedAt": {"$gte": since}})
        return {
            "enrolled": bool(encrypted), "engine": biometric.get("engineName"), "detector": biometric.get("detectorName"),
            "recognizer": biometric.get("recognizerName"), "modelVersion": biometric.get("modelVersion"),
            "templateVersion": biometric.get("templateVersion"), "embeddingDimension": biometric.get("embeddingDimension"),
            "enrollmentRequired": bool(biometric.get("enrollmentRequired", status in {"re_enrollment_required", "not_enrolled"})),
            "migrationStatus": status, "enrolledAt": biometric.get("enrolledAt"), "updatedAt": biometric.get("updatedAt"),
            "recentVerificationFailureCount": failures, "manualAttendanceCount": manual,
        }
