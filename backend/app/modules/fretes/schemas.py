"""Contratos da API de Fretes e do relatório de pagamento."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .tariff_catalog import normalize_label

type FreightStatus = Literal["CALCULADO", "PENDENTE_CONFERENCIA"]
type FreightInputTransportType = Literal["AGREGADO", "TRANSPORTADORA"]
type TransportType = Literal["PROPRIO", "AGREGADO", "TRANSPORTADORA"]
type PaymentTransportType = Literal["AGREGADO", "TRANSPORTADORA"]
type TariffSource = Literal["AGREGADOS_CD", "JUST_IN_TIME", "PAULO_CRUZ"]
type TruckType = Literal["SAVEIRO", "KIA_BONGO", "CAMINHAO_3_4", "CAMINHAO_TOCO"] | None


class FreightInput(BaseModel):
    """Entrada validada para cotar ou registrar um serviço de frete."""

    model_config = ConfigDict(extra="forbid")

    data_servico: date
    tipo_transporte: FreightInputTransportType
    nome_transportador: str | None = Field(default=None, min_length=2, max_length=160)
    id_motorista_agregado: int | None = Field(default=None, ge=1)
    codigo_fonte_tarifa: TariffSource | None = None
    rota_cidade: str = Field(min_length=2, max_length=160)
    km_inicial: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        max_digits=12,
        decimal_places=3,
        allow_inf_nan=False,
    )
    km_final: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        max_digits=12,
        decimal_places=3,
        allow_inf_nan=False,
    )
    quantidade_entregas: int = Field(ge=0, le=2_147_483_647)
    peso_kg: Decimal = Field(
        ge=Decimal("0"),
        max_digits=12,
        decimal_places=3,
        allow_inf_nan=False,
    )
    valor_nota: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        max_digits=14,
        decimal_places=2,
        allow_inf_nan=False,
    )
    valor_avaria: Decimal = Field(
        default=Decimal("0"),
        ge=Decimal("0"),
        max_digits=14,
        decimal_places=2,
        allow_inf_nan=False,
    )
    quantidade_avarias: int = Field(default=0, ge=0, le=2_147_483_647)
    codigo_zona_jit: str | None = Field(default=None, max_length=60)
    adicionais_jit: list[str] = Field(default_factory=list, max_length=8)
    tipo_caminhao: TruckType = None

    @field_validator("rota_cidade")
    @classmethod
    def normalize_route(cls, value: str) -> str:
        """Padroniza espaços da rota antes de comparar com as tarifas."""
        normalized = " ".join(value.split())
        if len(normalized) < 2:
            raise ValueError("Informe a rota ou cidade do frete.")
        return normalized

    @field_validator("nome_transportador")
    @classmethod
    def normalize_transporter_name(cls, value: str | None) -> str | None:
        """Normaliza o nome da transportadora independente."""
        normalized = " ".join(value.split()) if value else ""
        return normalized or None

    @field_validator("codigo_zona_jit")
    @classmethod
    def normalize_zone(cls, value: str | None) -> str | None:
        """Retira espaços externos do código de zona JUST IN TIME."""
        normalized = value.strip().upper() if value else ""
        return normalized or None

    @field_validator("adicionais_jit")
    @classmethod
    def require_unique_additions(cls, values: list[str]) -> list[str]:
        """Padroniza códigos dos adicionais e rejeita entradas vazias ou repetidas."""
        normalized = [normalize_label(value).replace(" ", "_") for value in values]
        if any(not value for value in normalized) or len(normalized) != len(set(normalized)):
            raise ValueError("Os adicionais devem ser únicos e válidos.")
        return normalized

    @model_validator(mode="after")
    def validate_odometer_values(self) -> FreightInput:
        """Valida modalidade, fonte tarifária e leituras do hodômetro."""
        odometer_values = (self.km_inicial, self.km_final)
        if self.tipo_transporte == "TRANSPORTADORA":
            if any(value is not None for value in odometer_values) and any(
                value is None for value in odometer_values
            ):
                raise ValueError("Informe as duas leituras do hodômetro ou deixe ambas vazias.")
        elif any(value is None for value in odometer_values):
            raise ValueError("Informe as duas leituras do hodômetro.")

        if self.km_inicial is not None and self.km_final is not None and self.km_final < self.km_inicial:
            raise ValueError("KM final deve ser igual ou maior que KM inicial.")

        if self.tipo_transporte == "AGREGADO":
            if self.codigo_fonte_tarifa != "AGREGADOS_CD":
                raise ValueError("Frete de agregado deve usar a tabela Agregados CD.")
            if self.id_motorista_agregado is None:
                raise ValueError("Selecione o motorista agregado no cadastro de equipes.")
        else:
            if self.id_motorista_agregado is not None:
                raise ValueError("Motorista agregado só se aplica ao tipo Agregado.")
            if not self.nome_transportador:
                raise ValueError("Informe o nome da transportadora.")
            if self.codigo_fonte_tarifa not in {"JUST_IN_TIME", "PAULO_CRUZ"}:
                raise ValueError("Selecione a tabela da transportadora independente.")
        return self

    @property
    def km_rodado(self) -> Decimal | None:
        """Deriva a distância quando a modalidade fornece hodômetro."""
        if self.km_inicial is None or self.km_final is None:
            return None
        return self.km_final - self.km_inicial


class FreightQuoteResponse(BaseModel):
    """Resultado da simulação, incluindo motivo quando exigir conferência."""

    status_calculo: FreightStatus
    valor_frete_bruto: Decimal | None
    percentual_frete: Decimal | None
    motivo_pendencia: str | None
    detalhe_calculo: dict[str, object]


class FreightResponse(BaseModel):
    """Lançamento com responsável, modalidade, tarifa e memória do cálculo."""

    id_frete: int
    codigo_frete: UUID
    tipo_transporte: TransportType
    nome_transportador: str | None
    id_motorista_agregado: int | None
    codigo_fonte_tarifa: TariffSource | None
    data_servico: date
    rota_cidade: str
    km_inicial: Decimal | None
    km_final: Decimal | None
    km_rodado: Decimal | None
    quantidade_entregas: int
    peso_kg: Decimal
    valor_nota: Decimal | None
    tipo_caminhao: TruckType
    codigo_zona_jit: str | None
    adicionais_jit: list[str]
    valor_frete_bruto: Decimal | None
    valor_avaria: Decimal
    quantidade_avarias: int
    valor_frete_pago: Decimal | None
    percentual_frete: Decimal | None
    status_calculo: FreightStatus
    motivo_pendencia: str | None
    detalhe_calculo: dict[str, object]
    criado_por: int
    criado_em: datetime
    cancelado: bool = False
    cancelado_em: datetime | None = None
    cancelado_por: int | None = None
    justificativa_cancelamento: str | None = None


class FreightCancelRequest(BaseModel):
    """Justificativa obrigatória para cancelar um lançamento de frete."""

    justificativa: str = Field(min_length=5, max_length=1000)

    @field_validator("justificativa")
    @classmethod
    def normalize_justification(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if len(normalized) < 5:
            raise ValueError("Informe uma justificativa com pelo menos 5 caracteres.")
        return normalized


class FreightPage(BaseModel):
    """Página de lançamentos e metadados para paginação da consulta."""

    items: list[FreightResponse]
    total: int
    limit: int
    offset: int


class FreightPaymentReport(BaseModel):
    """Resumo de pagamento filtrado por modalidade e responsável."""

    data_de: date
    data_ate: date
    tipo_transporte: PaymentTransportType
    nome_transportador: str | None
    sem_identificacao: bool
    quantidade_fretes: int
    quantidade_pendentes: int
    valor_frete_bruto: Decimal
    valor_avarias: Decimal
    valor_a_pagar: Decimal


class FreightPaymentOptions(BaseModel):
    """Nomes disponíveis para filtrar o relatório no período escolhido."""

    agregados: list[str]
    transportadoras: list[str]
    agregados_sem_identificacao: bool


class FreightAggregateDriverOption(BaseModel):
    """Motorista terceirizado elegível para selecionar em um frete."""

    id_motorista: int
    nome_motorista: str


class FreightDeliverySummary(BaseModel):
    """Valores derivados das entregas confirmadas de um motorista e data."""

    id_motorista: int
    data_servico: date
    rota_cidade: str
    cidades: list[str]
    quantidade_entregas: int
    quantidade_avarias: int
    quantidade_registros: int
