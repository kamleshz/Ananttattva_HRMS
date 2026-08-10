from collections.abc import Callable
from typing import Annotated, Any

from bson import ObjectId
from fastapi import Depends, Request
from pymongo.asynchronous.database import AsyncDatabase

from app.core.database import get_database
from app.core.dependencies import get_current_user
from app.core.errors import AppError

ROLE_PERMISSIONS: dict[str, frozenset[str]] = {
    "super_admin": frozenset({"*"}),
    "admin": frozenset({"employees:read", "employees:write", "attendance:manage", "approvals:manage", "settings:read"}),
    "hr_admin": frozenset(
        {
            "employees:read",
            "employees:write",
            "attendance:manage",
            "leave:manage",
            "approvals:manage",
            "recruitment:manage",
        }
    ),
    "manager": frozenset({"employees:team-read", "attendance:team-read", "approvals:team-manage", "leave:team-read"}),
    "finance_admin": frozenset({"allowances:manage", "reports:finance-read"}),
    "it_admin": frozenset({"users:manage", "employees:read", "settings:technical-manage", "audit:read"}),
    "employee": frozenset({"profile:own-read", "attendance:own-manage", "leave:own-manage", "requests:own-manage"}),
}


def require_role(*roles: str) -> Callable[..., Any]:
    async def dependency(user: Annotated[dict[str, Any], Depends(get_current_user)]) -> dict[str, Any]:
        if user.get("role") not in roles:
            raise AppError(403, "You do not have permission for this action")
        return user

    return dependency


def require_permission(permission: str) -> Callable[..., Any]:
    async def dependency(user: Annotated[dict[str, Any], Depends(get_current_user)]) -> dict[str, Any]:
        permissions = ROLE_PERMISSIONS.get(user.get("role", ""), frozenset())
        if "*" not in permissions and permission not in permissions:
            raise AppError(403, "You do not have permission for this action")
        return user

    return dependency


def require_employee_ownership(employee_parameter: str = "employee_id") -> Callable[..., Any]:
    async def dependency(
        request: Request,
        user: Annotated[dict[str, Any], Depends(get_current_user)],
        database: Annotated[AsyncDatabase[dict[str, Any]], Depends(get_database)],
    ) -> dict[str, Any]:
        employee_id = request.path_params.get(employee_parameter)
        if not employee_id or not ObjectId.is_valid(employee_id):
            raise AppError(404, "Employee not found")
        if str(user.get("employee") or "") != employee_id and user.get("role") not in {
            "super_admin",
            "admin",
            "hr_admin",
        }:
            raise AppError(403, "You can only access your own employee record")
        employee = await database.employees.find_one({"_id": ObjectId(employee_id)})
        if not employee:
            raise AppError(404, "Employee not found")
        return employee

    return dependency


async def require_manager_scope(
    manager: dict[str, Any],
    employee_id: str,
    database: AsyncDatabase[dict[str, Any]],
) -> None:
    if manager.get("role") in {"super_admin", "admin", "hr_admin"}:
        return
    if manager.get("role") != "manager" or not manager.get("employee"):
        raise AppError(403, "You do not have access to this employee")
    if not ObjectId.is_valid(employee_id):
        raise AppError(404, "Employee not found")
    employee = await database.employees.find_one(
        {"_id": ObjectId(employee_id), "manager": manager["employee"]},
        {"_id": 1},
    )
    if not employee:
        raise AppError(403, "This employee is outside your reporting scope")
