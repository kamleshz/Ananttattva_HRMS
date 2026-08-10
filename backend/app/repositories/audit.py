from datetime import UTC, datetime
from typing import Any

from pymongo.asynchronous.database import AsyncDatabase


class AuditRepository:
    def __init__(self, database: AsyncDatabase[dict[str, Any]]) -> None:
        self.collection = database.audit_logs

    async def record(
        self,
        *,
        action: str,
        entity_type: str,
        entity_id: str,
        actor_user_id: str | None = None,
        actor_employee_id: str | None = None,
        role: str | None = None,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        ip: str | None = None,
        user_agent: str | None = None,
        request_id: str | None = None,
    ) -> None:
        await self.collection.insert_one(
            {
                "actorUserId": actor_user_id,
                "actorEmployeeId": actor_employee_id,
                "role": role,
                "action": action,
                "entityType": entity_type,
                "entityId": entity_id,
                "beforeSnapshot": before,
                "afterSnapshot": after,
                "metadata": metadata or {},
                "ip": ip,
                "userAgent": user_agent,
                "requestId": request_id,
                "timestamp": datetime.now(UTC),
            }
        )
