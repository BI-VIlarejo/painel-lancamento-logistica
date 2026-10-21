"""Endpoints de consulta administrativa da trilha de auditoria."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response

from app.api.v1.dependencies import DatabaseSession, require_global_permission
from app.modules.access_control.catalog import PermissionCode
from app.modules.access_control.service import AuthorizationContext
from app.modules.audit import service
from app.modules.audit.schemas import AuditEventPage

router = APIRouter(prefix="/audit", tags=["Auditoria"])
_audit_access = require_global_permission(PermissionCode.AUDIT_VIEW)


@router.get("/events", response_model=AuditEventPage)
def get_audit_events(
    db: DatabaseSession,
    response: Response,
    access: AuthorizationContext = Depends(_audit_access),
    origem: Literal["ENTREGAS", "ACESSOS", "FEEDBACK"] | None = None,
    tipo_evento: str | None = Query(default=None, min_length=1, max_length=40),
    ator_usuario_id: int | None = Query(default=None, ge=1),
    ocorrido_de: datetime | None = None,
    ocorrido_ate: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> AuditEventPage:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return service.list_events(
        db,
        origem=origem,
        tipo_evento=tipo_evento,
        ator_usuario_id=ator_usuario_id,
        ocorrido_de=ocorrido_de,
        ocorrido_ate=ocorrido_ate,
        limit=limit,
        offset=offset,
    )
