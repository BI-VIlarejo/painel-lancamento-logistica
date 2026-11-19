"""Contratos do painel gerencial, sem expor detalhes pessoais de feedback."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.fretes.schemas import FreightResponse


class DashboardSummary(BaseModel):
    lancamentos_registrados: int
    itens_planejados: int
    entregas_realizadas: int
    entregas_nao_realizadas: int
    coletas_realizadas: int
    coletas_nao_realizadas: int
    taxa_realizacao: float | None
    otif_percentual: float | None


class TrendPoint(BaseModel):
    data: date
    planejadas: int
    realizadas: int
    nao_realizadas: int
    taxa_realizacao: float | None
    otif_percentual: float | None
    entregas_realizadas: int
    entregas_nao_realizadas: int
    coletas_realizadas: int
    coletas_nao_realizadas: int


class LocalityPerformance(BaseModel):
    id_localidade: int
    nome: str
    lancamentos: int
    itens_planejados: int
    realizadas: int
    nao_realizadas: int
    taxa_realizacao: float | None
    otif_percentual: float | None
    entregas_realizadas: int
    entregas_nao_realizadas: int
    coletas_realizadas: int
    coletas_nao_realizadas: int
    elogios: int | None
    reclamacoes: int | None


class ReasonTeamPerformance(BaseModel):
    chave: str
    equipe: str
    quantidade: int
    id_motorista: int | None = None
    motorista: str | None = None


class ReasonPerformance(BaseModel):
    tipo_operacao: Literal["ENTREGA", "COLETA"]
    id_motivo: int
    motivo: str
    grupo_motivo: str | None
    quantidade: int
    percentual_das_nao_realizadas: float | None
    incidencia_sobre_total: float | None
    equipes: list[ReasonTeamPerformance] = Field(default_factory=list)


class ReasonGroupPerformance(BaseModel):
    tipo_operacao: Literal["ENTREGA", "COLETA"]
    grupo_motivo: str | None
    quantidade: int
    percentual_das_nao_realizadas: float | None
    incidencia_sobre_total: float | None


class DeliveryDriverReason(BaseModel):
    tipo_operacao: Literal["ENTREGA", "COLETA"]
    id_motivo: int
    motivo: str
    grupo_motivo: str | None
    quantidade: int


class DeliveryDriverPerformance(BaseModel):
    id_pessoa: int
    nome: str
    entregas_planejadas: int
    entregas_realizadas: int
    entregas_nao_realizadas: int
    coletas_planejadas: int
    coletas_realizadas: int
    coletas_nao_realizadas: int
    taxa_realizacao: float | None
    motivos: list[DeliveryDriverReason] = Field(default_factory=list)


class DeliveryTypePerformance(BaseModel):
    tipo_transporte_entrega: str | None
    registros_entrega: int
    registros_coleta: int
    itens_planejados: int
    realizadas: int
    nao_realizadas: int
    entregas_planejadas: int
    entregas_realizadas: int
    entregas_nao_realizadas: int
    coletas_planejadas: int
    coletas_realizadas: int
    coletas_nao_realizadas: int
    taxa_realizacao: float | None
    otif_percentual: float | None
    motoristas: list[DeliveryDriverPerformance] = Field(default_factory=list)


class PersonReasonCount(BaseModel):
    tipo_operacao: Literal["ENTREGA", "COLETA"]
    id_motivo: int
    motivo: str
    grupo_motivo: str | None
    quantidade: int


class PersonPerformance(BaseModel):
    id_pessoa: int
    nome: str
    funcao: str
    ativo: bool
    equipes: int
    itens_planejados: int
    realizadas: int
    nao_realizadas: int
    taxa_realizacao: float | None
    otif_percentual: float | None
    entregas_realizadas: int
    entregas_nao_realizadas: int
    coletas_realizadas: int
    coletas_nao_realizadas: int
    elogios: int | None
    reclamacoes: int | None
    score_atendimento: int
    motivos_da_equipe: list[PersonReasonCount]


class TeamReasonPerformance(BaseModel):
    tipo_operacao: Literal["ENTREGA", "COLETA"]
    id_motivo: int
    motivo: str
    grupo_motivo: str | None
    quantidade: int
    percentual_das_nao_realizadas: float | None
    incidencia_sobre_total: float | None


class TeamPerformance(BaseModel):
    chave: str
    equipe: str
    id_motorista: int | None = None
    motorista: str | None = None
    itens_planejados: int
    realizadas: int
    nao_realizadas: int
    taxa_realizacao: float | None
    otif_percentual: float | None
    entregas_realizadas: int
    entregas_nao_realizadas: int
    coletas_realizadas: int
    coletas_nao_realizadas: int
    lancamentos: int
    elogios: int | None
    reclamacoes: int | None
    motivos: list[TeamReasonPerformance] = Field(default_factory=list)


class FeedbackSummary(BaseModel):
    disponivel: bool
    elogios: int | None
    reclamacoes: int | None


class DashboardResponse(BaseModel):
    data_de: date | None
    data_ate: date | None
    id_localidade: int | None
    tipo_transporte_entrega: Literal["PROPRIA", "TERCEIRIZADA"] | None
    resumo: DashboardSummary
    feedback: FeedbackSummary
    evolucao: list[TrendPoint]
    por_localidade: list[LocalityPerformance]
    por_motivo: list[ReasonPerformance]
    por_grupo_motivo: list[ReasonGroupPerformance]
    por_tipo_entrega: list[DeliveryTypePerformance]
    por_pessoa: list[PersonPerformance]
    por_equipe: list[TeamPerformance]


class DashboardGoalResponse(BaseModel):
    indicador: Literal["TAXA_REALIZACAO"] = "TAXA_REALIZACAO"
    valor_percentual: float
    periodicidade: Literal["MENSAL", "TRIMESTRAL", "ANUAL"]
    escopo_operacao: Literal["TODAS", "ENTREGAS", "COLETAS"]
    atualizado_em: datetime | None
    atualizado_por: str | None
    pode_editar: bool


class DashboardGoalUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    valor_percentual: Decimal = Field(
        ge=Decimal("0"),
        le=Decimal("100"),
        max_digits=5,
        decimal_places=2,
    )
    periodicidade: Literal["MENSAL", "TRIMESTRAL", "ANUAL"]
    escopo_operacao: Literal["TODAS", "ENTREGAS", "COLETAS"]


class TransportPaymentItem(BaseModel):
    key: str
    label: str
    total: float
    fretes_count: int
    known_count: int


class TransportRateItem(BaseModel):
    key: str
    label: str
    percentual: float
    known_count: int


class TransportCarrierDeliveryItem(BaseModel):
    key: str
    label: str
    planned: int
    realized: int
    not_realized: int
    occurrences: int
    accuracy: float | None


class TransportKmItem(BaseModel):
    key: str
    label: str
    total_km: float
    known_count: int


class TransportCityDeliveryItem(BaseModel):
    city: str
    planned: int
    realized: int
    not_realized: int
    occurrences: int


class TransportDashboardResponse(BaseModel):
    data_de: date | None
    data_ate: date | None
    total_fretes: int
    total_registros_entrega: int
    pagamentos: list[TransportPaymentItem]
    percentuais_frete: list[TransportRateItem]
    entregas_transportadora: list[TransportCarrierDeliveryItem]
    km_rodado: list[TransportKmItem]
    entregas_cidade: list[TransportCityDeliveryItem]


class TransportDetailParticipant(BaseModel):
    nome_exibicao: str
    papel_participante: str


class TransportDetailReason(BaseModel):
    descricao_motivo: str
    quantidade: int


class TransportDetailDeliveryItem(BaseModel):
    codigo_lancamento: UUID
    codigo_item_lancamento: UUID
    data_entrega: date
    id_localidade: int
    codigo_localidade: str
    nome_localidade: str
    cidade: str | None
    uf: str | None
    carrier_label: str
    driver: str | None
    quantidade_realizada: int
    quantidade_nao_realizada: int
    ocorrencias: int
    quantidade_reclamacoes: int
    quantidade_elogios: int
    observacao: str | None
    participantes: list[TransportDetailParticipant]
    motivos: list[TransportDetailReason]


class TransportDetailFreightPage(BaseModel):
    items: list[FreightResponse]
    total: int
    limit: int
    offset: int


class TransportDetailDeliveryPage(BaseModel):
    items: list[TransportDetailDeliveryItem]
    total: int
    limit: int
    offset: int


class TransportDetailTotals(BaseModel):
    fretes_count: int
    pagamento_total: float
    pagamento_count: int
    percentual_frete: float | None
    percentual_count: int
    km_total: float
    km_count: int
    registros_entrega: int
    entregas_planejadas: int
    entregas_realizadas: int
    entregas_nao_realizadas: int
    ocorrencias: int
    taxa_acerto: float | None


class TransportDashboardDetailResponse(BaseModel):
    kind: Literal["carrier", "city"]
    key: str
    data_de: date | None
    data_ate: date | None
    totals: TransportDetailTotals
    fretes: TransportDetailFreightPage
    entregas: TransportDetailDeliveryPage
