from typing import Any

from pymongo import ASCENDING, DESCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import Settings


class DatabaseManager:
    def __init__(self) -> None:
        self.client: AsyncMongoClient[dict[str, Any]] | None = None
        self.database: AsyncDatabase[dict[str, Any]] | None = None

    async def connect(self, settings: Settings) -> None:
        self.client = AsyncMongoClient(
            settings.mongodb_uri.get_secret_value(),
            serverSelectionTimeoutMS=5_000,
            tz_aware=True,
            appname="at-connect-api",
        )
        await self.client.admin.command("ping")
        self.database = self.client[settings.mongodb_database]

    async def close(self) -> None:
        if self.client is not None:
            await self.client.close()
        self.client = None
        self.database = None

    def get_database(self) -> AsyncDatabase[dict[str, Any]]:
        if self.database is None:
            raise RuntimeError("MongoDB is not initialized")
        return self.database

    async def ensure_indexes(self) -> None:
        database = self.get_database()
        await database.users.create_index([("email", ASCENDING)], unique=True, name="users_email_unique")
        await database.employees.create_index([("employeeCode", ASCENDING)], unique=True, name="employees_code_unique")
        await database.auditLogs.create_index([("timestamp", DESCENDING)], name="audit_timestamp")
        await database.auditLogs.create_index(
            [("entityType", ASCENDING), ("entityId", ASCENDING), ("timestamp", DESCENDING)],
            name="audit_entity_timeline",
        )
        await database.employees.create_index([("faceBiometric.migrationStatus", ASCENDING)], name="employee_biometric_migration")


database_manager = DatabaseManager()


def get_database() -> AsyncDatabase[dict[str, Any]]:
    return database_manager.get_database()
