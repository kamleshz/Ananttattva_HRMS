import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import api_router
from app.core.config import get_settings
from app.core.database import database_manager
from app.core.errors import AppError
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.core.redis import redis_manager
from app.core.seed import seed_admin
from app.ml.face_engine import face_engine_manager
from app.repositories.users import UserRepository

logger = logging.getLogger("at_connect.api")


def create_app(enable_lifespan: bool = True) -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if not enable_lifespan:
            yield
            return
        await database_manager.connect(settings)
        await redis_manager.connect(settings)
        await database_manager.ensure_indexes()
        await seed_admin(UserRepository(database_manager.get_database()), settings)
        await asyncio.to_thread(face_engine_manager.initialize, settings)
        logger.info("application_started", extra={"context": {"environment": settings.app_env}})
        try:
            yield
        finally:
            await redis_manager.close()
            await database_manager.close()
            face_engine_manager.close()

    app = FastAPI(
        title="AT Connect API",
        version="2.0.0-alpha.1",
        description="Secure HRMS API migration from Express to FastAPI.",
        docs_url=None if settings.is_production else "/api/docs",
        redoc_url=None if settings.is_production else "/api/redoc",
        openapi_url=None if settings.is_production else "/api/openapi.json",
        lifespan=lifespan,
    )
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.client_urls,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "X-CSRF-Token"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )

    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"success": False, "message": exc.message, "details": exc.details},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {
                "field": ".".join(str(part) for part in error["loc"] if part != "body"),
                "message": error["msg"],
                "type": error["type"],
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={"success": False, "message": "Validation failed", "details": details},
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else "Request failed"
        return JSONResponse(status_code=exc.status_code, content={"success": False, "message": message, "details": []})

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "unhandled_request_error",
            extra={"context": {"request_id": getattr(request.state, "request_id", None), "path": request.url.path}},
        )
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": "An unexpected error occurred", "details": []},
        )

    @app.get("/api/health", tags=["System"])
    async def health() -> dict[str, Any]:
        face_health = face_engine_manager.health()
        return {"success": True, "message": "AT Connect API is healthy", "timestamp": datetime.now(UTC).isoformat(), "services": {"faceEngine": "healthy" if face_health["healthy"] else "degraded"}}

    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
