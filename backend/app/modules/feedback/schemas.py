"""Contratos públicos para reclamações e elogios."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


FeedbackTypeCode = Literal["RECLAMACAO", "ELOGIO"]
FeedbackRole = Literal["MOTORISTA", "AJUDANTE"]


class FeedbackParticipantResponse(BaseModel):
    id_pessoa: int
    nome_exibicao: str
    papel_participante: FeedbackRole


class FeedbackParticipantInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_pessoa: int = Field(gt=0)
    papel_participante: FeedbackRole


class FeedbackCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data_feedback: date
    tipo: FeedbackTypeCode
    nome_cliente: str = Field(min_length=1, max_length=160)
    codigo_lancamento: UUID
    codigo_revisao: UUID
    codigo_item_lancamento: UUID
    participantes: list[FeedbackParticipantInput] | None = Field(
        default=None,
        min_length=1,
        max_length=3,
    )
    relato: str = Field(min_length=5, max_length=5000)

    @model_validator(mode="after")
    def validate_participants(self) -> "FeedbackCreateRequest":
        if self.participantes is None:
            return self
        drivers = [
            participant
            for participant in self.participantes
            if participant.papel_participante == "MOTORISTA"
        ]
        helpers = [
            participant
            for participant in self.participantes
            if participant.papel_participante == "AJUDANTE"
        ]
        person_ids = [participant.id_pessoa for participant in self.participantes]
        if len(drivers) != 1:
            raise ValueError("Selecione exatamente um motorista.")
        if len(helpers) > 2:
            raise ValueError("Selecione no máximo dois ajudantes.")
        if len(person_ids) != len(set(person_ids)):
            raise ValueError("Uma pessoa não pode ocupar mais de um papel.")
        return self

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


class FeedbackImportRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line: int = Field(ge=2)
    item: FeedbackCreateRequest


class FeedbackImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[FeedbackImportRow] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_unique_lines(self) -> "FeedbackImportRequest":
        lines = [row.line for row in self.rows]
        if len(lines) != len(set(lines)):
            raise ValueError("Cada linha do CSV deve aparecer somente uma vez.")
        return self


class FeedbackImportPreviewItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data_feedback: date
    tipo: FeedbackTypeCode
    codigo_lancamento: UUID
    codigo_revisao: UUID
    codigo_item_lancamento: UUID


class FeedbackImportPreviewRowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    line: int = Field(ge=2)
    item: FeedbackImportPreviewItem


class FeedbackImportPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[FeedbackImportPreviewRowRequest] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_unique_lines(self) -> "FeedbackImportPreviewRequest":
        lines = [row.line for row in self.rows]
        if len(lines) != len(set(lines)):
            raise ValueError("Cada linha do CSV deve aparecer somente uma vez.")
        return self


class FeedbackImportPreviewRow(BaseModel):
    line: int
    valid: bool
    errors: list[str]


class FeedbackImportPreviewResponse(BaseModel):
    rows: list[FeedbackImportPreviewRow]


class FeedbackImportResult(BaseModel):
    imported: int


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
