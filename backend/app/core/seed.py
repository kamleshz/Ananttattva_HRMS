import logging

from app.core.config import Settings
from app.core.security import hash_password
from app.repositories.users import UserRepository

logger = logging.getLogger("at_connect.seed")


async def seed_admin(users: UserRepository, settings: Settings) -> None:
    if not settings.seed_admin_enabled:
        return
    email = settings.seed_admin_email.lower().strip()
    if await users.find_by_email(email):
        return
    await users.create_admin(
        {
            "firstName": "System",
            "lastName": "Administrator",
            "email": email,
            "passwordHash": hash_password(settings.seed_admin_password.get_secret_value()),
            "role": "super_admin",
            "employee": None,
            "isActive": True,
            "mustChangePassword": True,
            "lastLogin": None,
        }
    )
    logger.warning("seed_admin_created", extra={"context": {"email": email}})
