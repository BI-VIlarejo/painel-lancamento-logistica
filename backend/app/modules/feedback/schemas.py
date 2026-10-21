"""Contratos públicos para reclamações e elogios."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


FeedbackTypeCode = Literal["RECLAMACAO", "ELOGIO"]
FeedbackRole = Literal["MOTORISTA", "AJUDANTE"]


class FeedbackParticipantResponse(BaseModel):
    id_pessoa: int
    nome_exibicao: str
    papel_participante: FeedbackRole


class FeedbackCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data_feedback: date
    tipo: FeedbackTypeCode
    nome_cliente: str = Field(min_length=1, max_length=160)
    codigo_lancamento: UUID
    codigo_revisao: UUID
    codigo_item_lancamento: UUID
    relato: str = Field(min_length=5, max_length=5000)

    @field_validator("nome_cliente")
    @classmethod
    def normalize_client_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Informe o nome do cliente.")
        return normalized

    @field_validator("relato")
    @classmethod
    def normalize_report(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 5:
            raise ValueError("Descreva a manifestação com ao menos 5 caracteres.")
        return normalized


class FeedbackDeliveryItem(BaseModel):
    codigo_lancamento: UUID
    codigo_revisao: UUID
    codigo_item_lancamento: UUID
    data_entrega: date
    id_localidade: int
    nome_localidade: str
    quantidade_realizada: int
    quantidade_nao_realizada: int
    participantes: list[FeedbackParticipantResponse]


class FeedbackLocality(BaseModel):
    id_localidade: int
    nome_localidade: str


class FeedbackItem(BaseModel):
    id_feedback: int
    codigo_lancamento: UUID
    codigo_revisao: UUID
    codigo_item_lancamento: UUID
    data_feedback: date
    data_entrega: date
    tipo: FeedbackTypeCode
    nome_cliente: str | None
    id_localidade: int
    nome_localidade: str
    participantes: list[FeedbackParticipantResponse]
    relato: str
    criado_em: datetime


class FeedbackPage(BaseModel):
    items: list[FeedbackItem]
    total: int
    limit: int
    offset: int
