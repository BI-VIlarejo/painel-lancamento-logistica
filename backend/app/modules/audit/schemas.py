"""Contratos de consulta da trilha administrativa."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class AuditChange(BaseModel):
    campo: str
    anterior: str | None
    novo: str | None


class AuditEvent(BaseModel):
    origem: Literal["ENTREGAS", "ACESSOS", "FEEDBACK"]
    id_evento: int
    tipo_evento: str
    ator_usuario_id: int | None
    ator_nome: str | None
    ator_username: str | None
    ocorrido_em: datetime
    referencia_id: int | None
    alvo: str | None
    alteracoes: list[AuditChange]


class AuditEventPage(BaseModel):
    items: list[AuditEvent]
    total: int
    limit: int
    offset: int
