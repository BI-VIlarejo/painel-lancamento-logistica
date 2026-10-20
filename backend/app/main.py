"""Composição da aplicação ASGI do Portal de Lançamento."""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.database import dispose_engine
from app.core.exceptions import register_exception_handlers
from app.core.logging import RequestLoggingMiddleware, configure_logging


# pyrefly: ignore [deprecated]
@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Libera recursos do processo quando a aplicação é encerrada."""
    yield
    dispose_engine()


def create_app() -> FastAPI:
    """Cria a aplicação e registra middlewares e roteadores."""
    configure_logging()
    settings = get_settings()
    application = FastAPI(
        title="Portal de Lançamento de Logística",
        version="1.0.0",
        lifespan=lifespan,
    )
    register_exception_handlers(application)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "Idempotency-Key"],
        expose_headers=["X-Request-ID"],
    )
    application.add_middleware(RequestLoggingMiddleware)
    application.include_router(health_router)
    application.include_router(api_router, prefix=settings.api_prefix)
    return application


app = create_app()
