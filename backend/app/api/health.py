"""Endpoint de disponibilidade da aplicação."""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health", include_in_schema=False)
def health_check() -> dict[str, str]:
    """Indica que o processo HTTP está respondendo."""
    return {"status": "ok"}
