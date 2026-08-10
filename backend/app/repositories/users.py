from datetime import UTC, datetime
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.database import AsyncDatabase


class UserRepository:
    def __init__(self, database: AsyncDatabase[dict[str, Any]]) -> None:
        self.users = database.users
        self.employees = database.employees

    async def find_by_email(self, email: str) -> dict[str, Any] | None:
        return await self.users.find_one({"email": email.lower()})

    async def find_by_id(self, user_id: str) -> dict[str, Any] | None:
        if not ObjectId.is_valid(user_id):
            return None
        return await self.users.find_one({"_id": ObjectId(user_id)})

    async def employee_summary(self, employee_id: ObjectId | str | None) -> dict[str, Any] | None:
        if not employee_id or not ObjectId.is_valid(str(employee_id)):
            return None
        return await self.employees.find_one(
            {"_id": ObjectId(str(employee_id))},
            {
                "employeeCode": 1,
                "firstName": 1,
                "lastName": 1,
                "profilePhoto": 1,
                "department": 1,
                "designation": 1,
            },
        )

    async def update_password(self, user_id: ObjectId, password_hash: str, must_change: bool = False) -> None:
        await self.users.update_one(
            {"_id": user_id},
            {
                "$set": {
                    "passwordHash": password_hash,
                    "mustChangePassword": must_change,
                    "updatedAt": datetime.now(UTC),
                }
            },
        )

    async def record_login(self, user_id: ObjectId) -> None:
        await self.users.update_one(
            {"_id": user_id},
            {"$set": {"lastLogin": datetime.now(UTC), "updatedAt": datetime.now(UTC)}},
        )

    async def create_admin(self, document: dict[str, Any]) -> dict[str, Any]:
        document.setdefault("createdAt", datetime.now(UTC))
        document.setdefault("updatedAt", datetime.now(UTC))
        result = await self.users.insert_one(document)
        return {**document, "_id": result.inserted_id}
