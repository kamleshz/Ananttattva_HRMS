import logging
import secrets
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from app.core.config import get_settings

logger = logging.getLogger("at_connect.http")


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))[:100]
        request.state.request_id = request_id
        settings = get_settings()
        protected = (
            request.url.path.startswith("/api/biometrics")
            or request.url.path.startswith("/api/admin/biometrics")
            or (request.url.path.startswith("/api/employees/") and "/biometrics" in request.url.path)
        )
        configured_key = settings.biometric_service_key.get_secret_value()
        if (
            protected
            and configured_key
            and not secrets.compare_digest(request.headers.get("x-biometric-service-key", ""), configured_key)
        ):
            return JSONResponse(
                status_code=403,
                content={
                    "success": False,
                    "message": "Biometric service access denied",
                    "details": [{"code": "BIOMETRIC_SERVICE_AUTH_FAILED"}],
                },
            )
        started = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(self), geolocation=(self), microphone=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        if request.url.path.startswith("/api/auth"):
            response.headers["Cache-Control"] = "no-store"
        logger.info(
            "request_complete",
            extra={
                "context": {
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                }
            },
        )
        return response
