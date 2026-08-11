from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.biometrics import admin_router as biometric_admin_router
from app.api.biometrics import router as biometric_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(biometric_router)
api_router.include_router(biometric_admin_router)
