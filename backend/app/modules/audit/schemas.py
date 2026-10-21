"""Contratos de consulta da trilha administrativa."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class AuditEvent(BaseModel):
    origem: Literal["ENTREGAS", "ACESSOS", "FEEDBACK"]
    id_evento: int
    tipo_evento: str
    ator_usuario_id: int | None
    ocorrido_em: datetime
    referencia_id: int | None


class AuditEventPage(BaseModel):
    items: list[AuditEvent]
    total: int
    limit: int
    offset: int
