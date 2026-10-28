"""Contratos de gravação e consulta dos rascunhos de Entregas."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_validator, model_validator


class DeliveryParticipantInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_pessoa: int = Field(ge=1)
    papel_participante: Literal["MOTORISTA", "AJUDANTE"]


class DeliveryReasonInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id_motivo_nao_entrega: int = Field(ge=1)
    tipo_operacao: Literal["ENTREGA", "COLETA"] = "ENTREGA"
    observacao: str | None = Field(default=None, max_length=5000)

    @field_validator("observacao")
    @classmethod
    def normalize_observation(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class DeliveryItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Preserves a general observation only when the server copies a legacy
    # record into a correction. This private field is never accepted over HTTP.
    _legacy_observation: str | None = PrivateAttr(default=None)

    codigo_item_lancamento: UUID | None = None
    # Accepted only to translate requests from a previously open form. A
    # collection is stored on the same item as its delivery.
    tipo_operacao: Literal["ENTREGA", "COLETA"] | None = None
    data_entrega: date
    id_localidade: int = Field(ge=1)
    quantidade_realizada: int = Field(ge=0, le=2_147_483_647)
    quantidade_nao_realizada: int = Field(ge=0, le=2_147_483_647)
    quantidade_coleta_realizada: int = Field(default=0, ge=0, le=2_147_483_647)
    quantidade_coleta_nao_realizada: int = Field(default=0, ge=0, le=2_147_483_647)
    # Empty values are tolerated for the currently deployed frontend; a new
    # non-empty delivery-level observation is rejected below.
    observacao: str | None = Field(
        default=None,
        max_length=5000,
        json_schema_extra={"deprecated": True},
    )
    participantes: list[DeliveryParticipantInput] = Field(min_length=1, max_length=3)
    motivos: list[DeliveryReasonInput] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_collection_item(cls, value: Any) -> Any:
        if not isinstance(value, dict) or value.get("tipo_operacao") != "COLETA":
            return value
        normalized = dict(value)
        normalized["quantidade_coleta_realizada"] = normalized.get(
            "quantidade_coleta_realizada", 0
        ) or normalized.get("quantidade_realizada", 0)
        normalized["quantidade_coleta_nao_realizada"] = normalized.get(
            "quantidade_coleta_nao_realizada", 0
        ) or normalized.get("quantidade_nao_realizada", 0)
        normalized["quantidade_realizada"] = 0
        normalized["quantidade_nao_realizada"] = 0
        normalized["tipo_operacao"] = "ENTREGA"
        normalized["motivos"] = [
            (
                {**reason, "tipo_operacao": "COLETA"}
                if isinstance(reason, dict) and not reason.get("tipo_operacao")
                else reason
            )
            for reason in normalized.get("motivos", [])
        ]
        return normalized

    @field_validator("observacao")
    @classmethod
    def normalize_legacy_observation(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_item(self) -> "DeliveryItemInput":
        if self.observacao is not None:
            raise ValueError("Informe cada observação na linha do motivo correspondente.")
        if (
            self.quantidade_realizada
            + self.quantidade_nao_realizada
            + self.quantidade_coleta_realizada
            + self.quantidade_coleta_nao_realizada
            == 0
        ):
            raise ValueError("Informe ao menos uma entrega ou coleta realizada ou não realizada.")
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

        for operation, quantity in (
            ("ENTREGA", self.quantidade_nao_realizada),
            ("COLETA", self.quantidade_coleta_nao_realizada),
        ):
            operation_reasons = [
                reason for reason in self.motivos if reason.tipo_operacao == operation
            ]
            if quantity == 0 and operation_reasons:
                label = "entrega" if operation == "ENTREGA" else "coleta"
                raise ValueError(f"Não informe motivos sem {label} não realizada.")
            if len(operation_reasons) != quantity:
                label = "entrega" if operation == "ENTREGA" else "coleta"
                raise ValueError(
                    f"Informe exatamente um motivo para cada {label} não realizada."
                )
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


class DeliveryCorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    justificativa: str | None = Field(default=None, max_length=1000)

    @field_validator("justificativa")
    @classmethod
    def normalize_optional_justification(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class DeliveryParticipantResponse(BaseModel):
    id_pessoa: int
    codigo_pessoa: UUID
    nome_exibicao: str
    papel_participante: Literal["MOTORISTA", "AJUDANTE"]
    ordem: int
    tipo_transporte_entrega: str | None


class DeliveryReasonResponse(BaseModel):
    id_motivo_nao_entrega: int
    tipo_operacao: Literal["ENTREGA", "COLETA"]
    codigo_motivo: str
    descricao_motivo: str
    grupo_motivo: str | None
    quantidade: int
    observacao: str | None


class DeliveryItemResponse(BaseModel):
    codigo_item_lancamento: UUID
    data_entrega: date
    id_localidade: int
    codigo_localidade: str
    nome_localidade: str
    quantidade_realizada: int
    quantidade_nao_realizada: int
    quantidade_coleta_realizada: int
    quantidade_coleta_nao_realizada: int
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
    entregas_realizadas: int
    entregas_nao_realizadas: int
    coletas_realizadas: int
    coletas_nao_realizadas: int
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
