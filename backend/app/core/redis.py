import json
from typing import Any

from redis.asyncio import Redis

from app.core.config import Settings


class RedisManager:
    def __init__(self) -> None:
        self.client: Redis | None = None

    async def connect(self, settings: Settings) -> None:
        self.client = Redis.from_url(
            settings.redis_url.get_secret_value(),
            encoding="utf-8",
            decode_responses=True,
            health_check_interval=30,
        )
        await self.client.ping()

    async def close(self) -> None:
        if self.client is not None:
            await self.client.aclose()
        self.client = None

    def get_client(self) -> Redis:
        if self.client is None:
            raise RuntimeError("Redis is not initialized")
        return self.client


redis_manager = RedisManager()


def get_redis() -> Redis:
    return redis_manager.get_client()


async def set_json(client: Redis, key: str, value: dict[str, Any], ttl_seconds: int) -> None:
    await client.set(key, json.dumps(value, separators=(",", ":"), default=str), ex=ttl_seconds)


async def get_json(client: Redis, key: str) -> dict[str, Any] | None:
    raw = await client.get(key)
    return json.loads(raw) if raw else None
