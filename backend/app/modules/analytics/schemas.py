"""Contratos do painel gerencial, sem expor detalhes pessoais de feedback."""

from datetime import date

from pydantic import BaseModel


class DashboardSummary(BaseModel):
    lancamentos_registrados: int
    itens_planejados: int
    entregas_realizadas: int
    entregas_nao_realizadas: int
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
    id_motivo: int
    motivo: str
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
    resumo: DashboardSummary
    feedback: FeedbackSummary
    evolucao: list[TrendPoint]
    por_localidade: list[LocalityPerformance]
    por_motivo: list[ReasonPerformance]
    por_pessoa: list[PersonPerformance]
    por_equipe: list[TeamPerformance]
