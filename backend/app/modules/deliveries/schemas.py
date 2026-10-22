"""Contratos de gravação e consulta dos rascunhos de Entregas."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DeliveryParticipantInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_pessoa: int = Field(ge=1)
    papel_participante: Literal["MOTORISTA", "AJUDANTE"]


class DeliveryReasonInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_motivo_nao_entrega: int = Field(ge=1)
    quantidade: int = Field(gt=0, le=2_147_483_647)


class DeliveryItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    codigo_item_lancamento: UUID | None = None
    data_entrega: date
    id_localidade: int = Field(ge=1)
    quantidade_realizada: int = Field(ge=0, le=2_147_483_647)
    quantidade_nao_realizada: int = Field(ge=0, le=2_147_483_647)
    observacao: str | None = Field(default=None, max_length=5000)
    participantes: list[DeliveryParticipantInput] = Field(min_length=1, max_length=3)
    motivos: list[DeliveryReasonInput] = Field(default_factory=list, max_length=30)

    @field_validator("observacao")
    @classmethod
    def normalize_observation(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_item(self) -> "DeliveryItemInput":
        if self.quantidade_realizada + self.quantidade_nao_realizada == 0:
            raise ValueError("Informe ao menos uma entrega realizada ou não realizada.")
        drivers = [
            item for item in self.participantes
            if item.papel_participante == "MOTORISTA"
        ]
        helpers = [
            item for item in self.participantes
            if item.papel_participante == "AJUDANTE"
        ]
        if len(drivers) != 1:
            raise ValueError("Cada item deve ter exatamente um motorista.")
        if len(helpers) > 2:
            raise ValueError("Cada item aceita no máximo dois ajudantes.")
        person_ids = [item.id_pessoa for item in self.participantes]
        if len(person_ids) != len(set(person_ids)):
            raise ValueError("Uma pessoa não pode ocupar dois papéis no mesmo item.")

        reason_ids = [item.id_motivo_nao_entrega for item in self.motivos]
        if len(reason_ids) != len(set(reason_ids)):
            raise ValueError("Cada motivo pode aparecer somente uma vez por item.")
        reason_total = sum(item.quantidade for item in self.motivos)
        if self.quantidade_nao_realizada == 0 and self.motivos:
            raise ValueError("Não informe motivos quando não houver entregas não realizadas.")
        if self.quantidade_nao_realizada > 0 and reason_total != self.quantidade_nao_realizada:
            raise ValueError("A soma dos motivos deve ser igual à quantidade não realizada.")
        return self


class DeliveryDraftCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    itens: list[DeliveryItemInput] = Field(min_length=1, max_length=100)


class DeliveryDraftUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    itens: list[DeliveryItemInput] = Field(min_length=1, max_length=100)


class DeliveryLifecycleReasonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    justificativa: str = Field(min_length=5, max_length=1000)

    @field_validator("justificativa")
    @classmethod
    def normalize_justification(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 5:
            raise ValueError("Informe uma justificativa com ao menos 5 caracteres.")
        return normalized


class DeliveryParticipantResponse(BaseModel):
    id_pessoa: int
    codigo_pessoa: UUID
    nome_exibicao: str
    papel_participante: Literal["MOTORISTA", "AJUDANTE"]
    ordem: int


class DeliveryReasonResponse(BaseModel):
    id_motivo_nao_entrega: int
    codigo_motivo: str
    descricao_motivo: str
    quantidade: int


class DeliveryItemResponse(BaseModel):
    codigo_item_lancamento: UUID
    data_entrega: date
    id_localidade: int
    codigo_localidade: str
    nome_localidade: str
    quantidade_realizada: int
    quantidade_nao_realizada: int
    observacao: str | None
    participantes: list[DeliveryParticipantResponse]
    motivos: list[DeliveryReasonResponse]


class DeliveryLaunchDetail(BaseModel):
    codigo_lancamento: UUID
    id_setor: int
    codigo_setor: str
    nome_setor: str
    codigo_revisao: UUID
    numero_revisao: int
    estado: Literal[
        "RASCUNHO",
        "ENVIADA",
        "EM_REVISAO",
        "DEVOLVIDA",
        "APROVADA",
        "CANCELADA",
    ]
    criado_por: int
    criado_em: datetime
    atualizado_em: datetime
    itens: list[DeliveryItemResponse]


class DeliveryLaunchSummary(BaseModel):
    codigo_lancamento: UUID
    id_setor: int
    codigo_setor: str
    nome_setor: str
    codigo_revisao: UUID
    numero_revisao: int
    estado: str
    criado_por: int
    criado_em: datetime
    atualizado_em: datetime
    data_inicial: date
    data_final: date
    quantidade_itens: int
    quantidade_realizada: int
    quantidade_nao_realizada: int
    itens: list[DeliveryItemResponse]


class DeliveryLaunchPage(BaseModel):
    items: list[DeliveryLaunchSummary]
    total: int
    limit: int
    offset: int


class DeliveryEventResponse(BaseModel):
    id_evento: int
    codigo_revisao: UUID
    numero_revisao: int
    tipo_evento: str
    estado_anterior: str | None
    estado_novo: str | None
    ator_usuario_id: int
    ocorrido_em: datetime
    comentario: str | None
