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
PaymentSettlementStatus = Literal["SOLICITADO", "PAGO", "ESTORNADO"]
PaymentResponsibleStatus = Literal[
    "PENDENTE_CONFERENCIA",
    "A_PAGAR",
    "PARCIAL",
    "SOLICITADO",
    "PAGO",
]
PaymentFreightState = Literal["EM_ABERTO", "SOLICITADO", "PAGO"]
PaymentAdjustmentNature = Literal["ACRESCIMO", "DESCONTO"]
PaymentAdjustmentCategory = Literal[
    "VALE",
    "ADIANTAMENTO",
    "BONUS",
    "PEDAGIO",
    "DESCONTO",
    "OUTRO",
]
PaymentInstallmentFrequency = Literal["SEMANAL", "MENSAL"]
type TariffSource = Literal["AGREGADOS_CD", "JUST_IN_TIME", "PAULO_CRUZ"]
type CarrierSource = Literal["JUST_IN_TIME", "PAULO_CRUZ"]
type TruckType = Literal["SAVEIRO", "KIA_BONGO", "CAMINHAO_3_4", "CAMINHAO_TOCO"] | None


class FreightInput(BaseModel):
    """Entrada validada para cotar ou registrar um serviço de frete."""

    model_config = ConfigDict(extra="forbid")

    data_servico: date
    tipo_transporte: FreightInputTransportType
    nome_transportador: str | None = Field(default=None, min_length=2, max_length=160)
    id_motorista_agregado: int | None = Field(default=None, ge=1)
    id_motorista_transportadora: int | None = Field(default=None, ge=1)
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
    valor_frete_bruto: Decimal | None = Field(
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
    nome_cliente: str | None = Field(default=None, max_length=160)
    codigo_cliente: str | None = Field(default=None, max_length=80)
    observacao: str | None = Field(default=None, max_length=1000)
    codigo_zona_jit: str | None = Field(default=None, max_length=60)
    codigos_zonas_jit: list[str] = Field(default_factory=list, max_length=12)
    adicionais_jit: list[str] = Field(default_factory=list, max_length=8)
    tipo_caminhao: TruckType = None
    carro_apoio: Literal["SAVEIRO", "KIA_BONGO"] | None = None

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

    @field_validator("nome_cliente", "codigo_cliente", "observacao")
    @classmethod
    def normalize_optional_client_text(cls, value: str | None) -> str | None:
        """Remove espaços extras e trata texto vazio como nulo."""
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("codigo_zona_jit")
    @classmethod
    def normalize_zone(cls, value: str | None) -> str | None:
        """Retira espaços externos do código de zona JUST IN TIME."""
        normalized = normalize_label(value).replace(" ", "_") if value else ""
        return normalized or None

    @field_validator("codigos_zonas_jit")
    @classmethod
    def require_unique_zones(cls, values: list[str]) -> list[str]:
        """Normaliza as zonas marcadas e impede valores repetidos."""
        normalized = [normalize_label(value).replace(" ", "_") for value in values]
        if any(not value for value in normalized) or len(normalized) != len(set(normalized)):
            raise ValueError("As zonas JUST IN TIME devem ser únicas e válidas.")
        return normalized

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
        if self.codigo_fonte_tarifa == "JUST_IN_TIME":
            selected_zones = self.codigos_zonas_jit or (
                [self.codigo_zona_jit] if self.codigo_zona_jit else []
            )
            if not selected_zones:
                raise ValueError("Selecione pelo menos uma zona JUST IN TIME.")
            self.codigos_zonas_jit = selected_zones
            self.codigo_zona_jit = selected_zones[0]
        elif self.codigos_zonas_jit or self.codigo_zona_jit:
            raise ValueError("As zonas JUST IN TIME só se aplicam à fonte JUST IN TIME.")

        if self.carro_apoio is not None and self.codigo_fonte_tarifa != "PAULO_CRUZ":
            raise ValueError("Carro de apoio só se aplica à transportadora Paulo Cruz.")
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
            if self.id_motorista_transportadora is not None:
                raise ValueError("Motorista de transportadora só se aplica à modalidade Transportadora independente.")
        else:
            if self.id_motorista_agregado is not None:
                raise ValueError("Motorista agregado só se aplica ao tipo Agregado.")
            if self.id_motorista_transportadora is None:
                raise ValueError("Selecione o motorista da transportadora independente.")
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


class HistoricalFreightImportItem(BaseModel):
    """Linha validada de uma planilha com fretes já realizados."""

    model_config = ConfigDict(extra="forbid")

    linha_planilha: int = Field(ge=1)
    data_servico: date
    data_servico_planilha: str | None = Field(default=None, max_length=40)
    data_servico_ano_inferido: bool = False
    nome_transportador: str | None = Field(default=None, max_length=160)
    rota_cidade: str | None = Field(default=None, max_length=160)
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
    km_rodado: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        max_digits=12,
        decimal_places=3,
        allow_inf_nan=False,
    )
    quantidade_entregas: int | None = Field(default=None, ge=0, le=2_147_483_647)
    peso_kg: Decimal | None = Field(
        default=None,
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
    valor_frete_bruto: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        max_digits=14,
        decimal_places=2,
        allow_inf_nan=False,
    )
    valor_frete_pago: Decimal | None = Field(
        default=None,
        max_digits=14,
        decimal_places=2,
        allow_inf_nan=False,
    )
    percentual_frete: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        max_digits=10,
        decimal_places=6,
        allow_inf_nan=False,
    )
    percentual_frete_planilha: str | None = Field(default=None, max_length=60)
    valores_originais_planilha: dict[str, str | None] = Field(
        default_factory=dict,
        max_length=20,
    )
    valor_avaria: Decimal = Field(
        default=Decimal("0"),
        ge=Decimal("0"),
        max_digits=14,
        decimal_places=2,
        allow_inf_nan=False,
    )

    @field_validator("nome_transportador", "rota_cidade")
    @classmethod
    def normalize_import_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("valores_originais_planilha")
    @classmethod
    def bound_original_values(
        cls,
        values: dict[str, str | None],
    ) -> dict[str, str | None]:
        if any(not key or len(key) > 40 for key in values):
            raise ValueError("A planilha contém um nome de campo de origem inválido.")
        if any(value is not None and len(value) > 255 for value in values.values()):
            raise ValueError("Um valor original da planilha ultrapassa 255 caracteres.")
        return values

    @model_validator(mode="after")
    def validate_import_values(self) -> HistoricalFreightImportItem:
        if self.km_inicial is not None and self.km_final is not None:
            if self.km_final < self.km_inicial:
                raise ValueError("KM final deve ser igual ou maior que KM inicial.")
            derived = self.km_final - self.km_inicial
            if self.km_rodado is not None and self.km_rodado != derived:
                raise ValueError("KM rodado diverge da diferença entre KM final e inicial.")
            self.km_rodado = derived
        return self


class HistoricalFreightEditInput(BaseModel):
    """Correções de histórico e parâmetros necessários para calcular bruto ausente."""

    model_config = ConfigDict(extra="forbid")

    data_servico: date
    id_motorista_selecionado: int | None = Field(default=None, ge=1)
    complementar_com_entregas: bool = False
    nome_transportador: str | None = Field(max_length=160)
    rota_cidade: str | None = Field(max_length=160)
    km_inicial: Decimal | None = Field(
        ge=Decimal("0"), max_digits=12, decimal_places=3, allow_inf_nan=False
    )
    km_final: Decimal | None = Field(
        ge=Decimal("0"), max_digits=12, decimal_places=3, allow_inf_nan=False
    )
    km_rodado: Decimal | None = Field(
        ge=Decimal("0"), max_digits=12, decimal_places=3, allow_inf_nan=False
    )
    quantidade_entregas: int | None = Field(ge=0, le=2_147_483_647)
    peso_kg: Decimal | None = Field(
        ge=Decimal("0"), max_digits=12, decimal_places=3, allow_inf_nan=False
    )
    valor_nota: Decimal | None = Field(
        ge=Decimal("0"), max_digits=14, decimal_places=2, allow_inf_nan=False
    )
    valor_frete_bruto: Decimal | None = Field(
        ge=Decimal("0"), max_digits=14, decimal_places=2, allow_inf_nan=False
    )
    valor_frete_pago: Decimal | None = Field(
        max_digits=14, decimal_places=2, allow_inf_nan=False
    )
    percentual_frete: Decimal | None = Field(
        ge=Decimal("0"), max_digits=10, decimal_places=6, allow_inf_nan=False
    )
    codigo_zona_jit: str | None = Field(default=None, max_length=60)
    adicionais_jit: list[str] = Field(default_factory=list, max_length=8)
    tipo_caminhao: TruckType = None
    carro_apoio: Literal["SAVEIRO", "KIA_BONGO"] | None = None
    nome_cliente: str | None = Field(default=None, max_length=160)
    codigo_cliente: str | None = Field(default=None, max_length=80)
    observacao: str | None = Field(default=None, max_length=1000)
    valor_avaria: Decimal = Field(
        default=Decimal("0"), ge=Decimal("0"), max_digits=14, decimal_places=2, allow_inf_nan=False
    )

    @field_validator("nome_transportador", "rota_cidade", "nome_cliente", "codigo_cliente", "observacao")
    @classmethod
    def normalize_edit_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @field_validator("codigo_zona_jit")
    @classmethod
    def normalize_edit_zone(cls, value: str | None) -> str | None:
        normalized = value.strip().upper() if value else ""
        return normalized or None

    @field_validator("adicionais_jit")
    @classmethod
    def normalize_edit_additions(cls, values: list[str]) -> list[str]:
        normalized = [normalize_label(value).replace(" ", "_") for value in values]
        if any(not value for value in normalized) or len(normalized) != len(set(normalized)):
            raise ValueError("Os adicionais devem ser únicos e válidos.")
        return normalized

    @model_validator(mode="after")
    def validate_edit_odometer(self) -> HistoricalFreightEditInput:
        if self.km_inicial is None or self.km_final is None:
            return self
        if self.km_final < self.km_inicial:
            raise ValueError("KM final deve ser igual ou maior que KM inicial.")
        self.km_rodado = self.km_final - self.km_inicial
        return self


class HistoricalFreightImportRequest(BaseModel):
    """Lote de linhas extraídas de uma planilha de histórico de fretes."""

    model_config = ConfigDict(extra="forbid")

    nome_arquivo: str = Field(min_length=1, max_length=255)
    sha256_arquivo: str = Field(pattern=r"^[0-9a-f]{64}$")
    aba_origem: str = Field(min_length=1, max_length=100)
    itens: list[HistoricalFreightImportItem] = Field(min_length=1, max_length=2500)

    @field_validator("nome_arquivo")
    @classmethod
    def strip_path_from_filename(cls, value: str) -> str:
        filename = value.replace("\\", "/").rsplit("/", 1)[-1].strip()
        if not filename:
            raise ValueError("Informe o nome do arquivo.")
        return filename

    @model_validator(mode="after")
    def require_unique_rows(self) -> HistoricalFreightImportRequest:
        lines = [item.linha_planilha for item in self.itens]
        if len(lines) != len(set(lines)):
            raise ValueError("A planilha contém números de linha repetidos.")
        return self


class HistoricalFreightImportResponse(BaseModel):
    """Resumo da importação em lote, incluindo reenvios idempotentes."""

    importados: int
    atualizados: int = 0
    ja_existentes: int
    vinculados_agregados: int = 0
    vinculados_transportadoras: int = 0
    sem_vinculo: int = 0


class FreightQuoteResponse(BaseModel):
    """Resultado da simulação, incluindo motivo quando exigir conferência."""

    status_calculo: FreightStatus
    valor_frete_bruto: Decimal | None
    valor_frete_pago: Decimal | None
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
    id_motorista_transportadora: int | None
    nome_motorista_transportadora: str | None
    codigo_fonte_tarifa: TariffSource | None
    data_servico: date
    rota_cidade: str | None
    km_inicial: Decimal | None
    km_final: Decimal | None
    km_rodado: Decimal | None
    quantidade_entregas: int | None
    peso_kg: Decimal | None
    valor_nota: Decimal | None
    tipo_caminhao: TruckType
    carro_apoio: Literal["SAVEIRO", "KIA_BONGO"] | None = None
    nome_cliente: str | None = None
    codigo_cliente: str | None = None
    observacao: str | None = None
    codigo_zona_jit: str | None
    codigos_zonas_jit: list[str] = Field(default_factory=list)
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


class FreightHistoryDriverOption(BaseModel):
    """Motorista relacionado a pelo menos um frete no período filtrado."""

    id_motorista: int
    nome_motorista: str


class FreightHistoryFilterOptions(BaseModel):
    """Opções dinâmicas para os filtros de motorista e rota do histórico."""

    motoristas: list[FreightHistoryDriverOption]
    rotas: list[str]
    possui_sem_motorista: bool


class FreightPaymentPending(BaseModel):
    """Lançamento que impede a exportação e motivo para correção."""

    codigo_frete: UUID
    data_servico: date
    nome_transportador: str | None
    rota_cidade: str | None
    valor_frete_bruto: Decimal | None
    valor_avaria: Decimal
    valor_frete_pago: Decimal | None
    motivo_pendencia: str


class FreightPaymentWarning(BaseModel):
    """Dado histórico ausente que não impede o envio do valor ao financeiro."""

    codigo_frete: UUID
    data_servico: date
    nome_transportador: str | None
    rota_cidade: str | None
    campos_ausentes: list[str]
    motivo_aviso: str


class FreightPaymentAdjustmentItem(BaseModel):
    """Lançamento financeiro extra (vale, adiantamento, bônus, pedágio ou desconto)."""

    codigo_ajuste: UUID
    tipo_transporte: PaymentTransportType
    nome_transportador: str
    id_pessoa_responsavel: int | None = None
    data_referencia: date
    natureza: PaymentAdjustmentNature
    categoria: PaymentAdjustmentCategory
    descricao: str
    valor: Decimal
    observacao: str | None = None
    vinculado_pagamento: bool = False
    codigo_pagamento: UUID | None = None
    status_pagamento: PaymentSettlementStatus | None = None
    criado_em: datetime
    criado_por_nome: str | None = None


class FreightPaymentAdjustmentCreateRequest(BaseModel):
    """Entrada para lançar um vale, adiantamento, bônus ou desconto (à vista ou parcelado)."""

    model_config = ConfigDict(extra="forbid")

    tipo_transporte: PaymentTransportType
    nome_transportador: str = Field(min_length=1, max_length=160)
    data_referencia: date
    natureza: PaymentAdjustmentNature
    categoria: PaymentAdjustmentCategory
    descricao: str = Field(min_length=2, max_length=200)
    valor: Decimal = Field(gt=Decimal("0"))
    parcelas: int = Field(default=1, ge=1, le=12)
    periodicidade: PaymentInstallmentFrequency = "SEMANAL"
    observacao: str | None = Field(default=None, max_length=500)

    @field_validator("nome_transportador", "descricao")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("O campo é obrigatório.")
        return normalized

    @field_validator("observacao")
    @classmethod
    def normalize_optional_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None


class FreightPaymentFreightDetail(BaseModel):
    """Detalhamento de um frete dentro da conferência do responsável."""

    id_frete: int
    codigo_frete: UUID
    data_servico: date
    rota_cidade: str | None
    nome_motorista_transportadora: str | None = None
    quantidade_entregas: int | None = None
    peso_kg: Decimal | None = None
    valor_nota: Decimal | None = None
    valor_frete_bruto: Decimal | None = None
    valor_avaria: Decimal
    valor_frete_pago: Decimal | None = None
    pronto_para_pagamento: bool
    motivo_pendencia: str | None = None
    status_pagamento_frete: PaymentFreightState = "EM_ABERTO"
    codigo_pagamento: UUID | None = None
    data_pagamento: date | None = None
    valor_divergente: bool = False


class FreightPaymentSettlementSummary(BaseModel):
    """Registro de um fechamento/lote de pagamento solicitado, pago ou estornado."""

    codigo_pagamento: UUID
    tipo_transporte: PaymentTransportType
    nome_transportador: str
    sem_identificacao: bool = False
    id_pessoa_responsavel: int | None = None
    documento_fiscal: str | None = None
    chave_pix: str | None = None
    exige_nota_fiscal: bool = False
    data_de: date
    data_ate: date
    status_pagamento: PaymentSettlementStatus
    quantidade_fretes: int
    quantidade_dias: int
    valor_frete_bruto: Decimal
    valor_avarias: Decimal
    valor_ajustes: Decimal
    valor_liquido_registrado: Decimal
    data_pagamento: date | None = None
    nf_numero: str | None = None
    nf_data: date | None = None
    nf_recebida: bool = False
    observacao: str | None = None
    criado_em: datetime
    criado_por_nome: str | None = None
    pago_em: datetime | None = None
    pago_por_nome: str | None = None
    estornado_em: datetime | None = None
    estornado_por_nome: str | None = None
    motivo_estorno: str | None = None
    possui_alteracao: bool = False
    motivo_alteracao: str | None = None


class FreightPaymentSettlementPage(BaseModel):
    """Página do histórico de fechamentos de pagamento."""

    items: list[FreightPaymentSettlementSummary]
    total: int
    limit: int
    offset: int


class FreightPaymentResponsibleSummary(BaseModel):
    """Consolidação individual de um agregado ou transportadora no período."""

    chave_responsavel: str
    nome_transportador: str
    sem_identificacao: bool = False
    id_pessoa_responsavel: int | None = None
    documento_fiscal: str | None = None
    chave_pix: str | None = None
    exige_nota_fiscal: bool = False
    quantidade_fretes: int
    quantidade_fretes_prontos: int
    quantidade_fretes_pendentes: int
    quantidade_fretes_pagos: int
    quantidade_fretes_solicitados: int
    quantidade_fretes_em_aberto: int
    quantidade_dias: int
    valor_frete_bruto: Decimal
    valor_avarias: Decimal
    valor_ajustes_acrescimos: Decimal
    valor_ajustes_descontos: Decimal
    valor_ajustes_liquido: Decimal
    valor_liquido_total: Decimal
    valor_pago: Decimal
    valor_solicitado: Decimal
    valor_em_aberto: Decimal
    status_pagamento: PaymentResponsibleStatus
    possui_alteracao: bool = False
    motivo_alteracao: str | None = None
    data_pagamento_mais_recente: date | None = None
    nf_pendente: bool = False
    ultimo_pagamento: FreightPaymentSettlementSummary | None = None
    pagamentos: list[FreightPaymentSettlementSummary] = Field(default_factory=list)
    fretes: list[FreightPaymentFreightDetail] = Field(default_factory=list)
    ajustes: list[FreightPaymentAdjustmentItem] = Field(default_factory=list)


class FreightPaymentExecutionSummary(BaseModel):
    """Indicadores de acompanhamento do pagamento no período."""

    total_responsaveis: int = 0
    responsaveis_pagos: int = 0
    responsaveis_solicitados: int = 0
    responsaveis_parciais: int = 0
    responsaveis_em_aberto: int = 0
    responsaveis_com_pendencia: int = 0
    responsaveis_com_alteracao: int = 0
    nf_pendentes: int = 0
    valor_pago: Decimal = Decimal("0.00")
    valor_solicitado: Decimal = Decimal("0.00")
    valor_em_aberto: Decimal = Decimal("0.00")
    valor_ajustes: Decimal = Decimal("0.00")


class FreightPaymentReport(BaseModel):
    """Resumo de pagamento filtrado por modalidade e responsável."""

    data_de: date
    data_ate: date
    tipo_transporte: PaymentTransportType
    nome_transportador: str | None
    sem_identificacao: bool
    quantidade_fretes: int
    quantidade_pendentes: int
    pendencias: list[FreightPaymentPending]
    avisos: list[FreightPaymentWarning] = Field(default_factory=list)
    valor_frete_bruto: Decimal
    valor_avarias: Decimal
    valor_a_pagar: Decimal
    resumo_execucao: FreightPaymentExecutionSummary = Field(
        default_factory=FreightPaymentExecutionSummary
    )
    responsaveis: list[FreightPaymentResponsibleSummary] = Field(default_factory=list)
    ajustes: list[FreightPaymentAdjustmentItem] = Field(default_factory=list)


class FreightPaymentSettlementCreateRequest(BaseModel):
    """Cria ou atualiza fechamentos de pagamento para responsáveis selecionados."""

    model_config = ConfigDict(extra="forbid")

    data_de: date
    data_ate: date
    tipo_transporte: PaymentTransportType
    acao: Literal["SOLICITAR", "MARCAR_PAGO"]
    responsaveis: list[str] | None = None
    sem_identificacao: bool = False
    data_pagamento: date | None = None
    observacao: str | None = Field(default=None, max_length=500)
    incluir_solicitados: bool = True
    nf_numero: str | None = Field(default=None, max_length=60)
    nf_data: date | None = None
    nf_recebida: bool = False

    @field_validator("observacao", "nf_numero")
    @classmethod
    def normalize_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None


class FreightPaymentSettlementStatusRequest(BaseModel):
    """Atualiza a situação de um fechamento específico (pago, desfazer pago ou estornar)."""

    model_config = ConfigDict(extra="forbid")

    acao: Literal["MARCAR_PAGO", "DESFAZER_PAGO", "ESTORNAR"]
    data_pagamento: date | None = None
    observacao: str | None = Field(default=None, max_length=500)
    motivo_estorno: str | None = Field(default=None, max_length=500)

    @field_validator("observacao", "motivo_estorno")
    @classmethod
    def normalize_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None


class FreightPaymentInvoiceUpdateRequest(BaseModel):
    """Registra ou atualiza o controle de nota fiscal de um pagamento."""

    model_config = ConfigDict(extra="forbid")

    nf_numero: str | None = Field(default=None, max_length=60)
    nf_data: date | None = None
    nf_recebida: bool

    @field_validator("nf_numero")
    @classmethod
    def normalize_nf(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None


class FreightPaymentPendingSummary(BaseModel):
    """Contagem rápida da semana atual para badge de pendências no menu."""

    semana_de: date
    semana_ate: date
    responsaveis_em_aberto: int
    responsaveis_com_pendencia: int
    nf_pendentes: int
    valor_em_aberto: Decimal


class FreightPaymentOptions(BaseModel):
    """Nomes disponíveis para filtrar o relatório no período escolhido."""

    agregados: list[str]
    transportadoras: list[str]
    agregados_sem_identificacao: bool


class FreightAggregateDriverOption(BaseModel):
    """Motorista terceirizado elegível para selecionar em um frete."""

    id_motorista: int
    nome_motorista: str


class FreightCarrierDriverOption(BaseModel):
    """Motorista independente e transportadora que determinam a tarifa."""

    id_motorista: int
    nome_motorista: str
    codigo_transportadora: CarrierSource
    nome_transportadora: str


class HistoricalFreightEditDriverOption(BaseModel):
    """Motorista cadastrado e válido na data de um frete importado."""

    id_motorista: int
    nome_motorista: str
    tipo_transporte: FreightInputTransportType
    codigo_transportadora: CarrierSource | None
    nome_transportadora: str | None


class FreightDeliverySummary(BaseModel):
    """Valores derivados das entregas confirmadas de um motorista e data."""

    id_motorista: int
    data_servico: date
    rota_cidade: str
    cidades: list[str]
    quantidade_entregas: int
    quantidade_avarias: int
    quantidade_registros: int
    peso_total_kg: Decimal | None
