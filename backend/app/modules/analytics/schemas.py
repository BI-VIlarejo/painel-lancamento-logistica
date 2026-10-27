"""Contratos do painel gerencial, sem expor detalhes pessoais de feedback."""

from datetime import date
from typing import Literal

from pydantic import BaseModel


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


class LocalityPerformance(BaseModel):
    id_localidade: int
    nome: str
    lancamentos: int
    itens_planejados: int
    realizadas: int
    nao_realizadas: int
    taxa_realizacao: float | None
    otif_percentual: float | None
    elogios: int | None
    reclamacoes: int | None


class ReasonPerformance(BaseModel):
    tipo_operacao: Literal["ENTREGA", "COLETA"]
    id_motivo: int
    motivo: str
    grupo_motivo: str | None
    quantidade: int
    percentual_das_nao_realizadas: float | None
    incidencia_sobre_total: float | None


class ReasonGroupPerformance(BaseModel):
    tipo_operacao: Literal["ENTREGA", "COLETA"]
    grupo_motivo: str | None
    quantidade: int
    percentual_das_nao_realizadas: float | None
    incidencia_sobre_total: float | None


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
    elogios: int | None
    reclamacoes: int | None
    score_atendimento: int
    motivos_da_equipe: list[PersonReasonCount]


class TeamPerformance(BaseModel):
    chave: str
    equipe: str
    itens_planejados: int
    realizadas: int
    nao_realizadas: int
    taxa_realizacao: float | None
    otif_percentual: float | None
    lancamentos: int
    elogios: int | None
    reclamacoes: int | None


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
