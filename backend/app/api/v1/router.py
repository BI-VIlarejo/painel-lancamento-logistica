"""Composição dos endpoints disponíveis na API v1."""

from fastapi import APIRouter

from app.modules.analytics.router import router as analytics_router
from app.modules.access_control.router import router as access_control_router
from app.modules.auth.router import router as auth_router
from app.modules.catalogs.router import router as catalogs_router
from app.modules.deliveries.router import router as deliveries_router

api_router = APIRouter()
api_router.include_router(auth_router)
api_router.include_router(access_control_router)
api_router.include_router(analytics_router)
api_router.include_router(catalogs_router)
api_router.include_router(deliveries_router)
