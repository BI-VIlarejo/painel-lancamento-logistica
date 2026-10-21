"""Regras de consulta da trilha administrativa."""

from datetime import datetime
from typing import Literal

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ServiceUnavailableError
from app.modules.audit import repository
from app.modules.audit.schemas import AuditEvent, AuditEventPage


def list_events(
    db: Session,
    *,
    origem: Literal["ENTREGAS", "ACESSOS", "FEEDBACK"] | None,
    tipo_evento: str | None,
    ator_usuario_id: int | None,
    ocorrido_de: datetime | None,
    ocorrido_ate: datetime | None,
    limit: int,
    offset: int,
) -> AuditEventPage:
    if ocorrido_de is not None and ocorrido_ate is not None and ocorrido_de > ocorrido_ate:
        raise ConflictError("A data inicial deve ser anterior ou igual à data final.")
    try:
        rows, total = repository.list_events(
            db,
            origem=origem,
            tipo_evento=tipo_evento,
            ator_usuario_id=ator_usuario_id,
            ocorrido_de=ocorrido_de,
            ocorrido_ate=ocorrido_ate,
            limit=limit,
            offset=offset,
        )
        return AuditEventPage(
            items=[AuditEvent.model_validate(row) for row in rows],
            total=total,
            limit=limit,
            offset=offset,
        )
    except SQLAlchemyError as exc:
        db.rollback()
        raise ServiceUnavailableError("Auditoria temporariamente indisponível.") from exc
