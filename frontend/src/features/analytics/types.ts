export type DashboardFilters = {
  data_de?: string;
  data_ate?: string;
  id_localidade?: number;
};

export type DashboardTrendPoint = {
  data: string;
  planejadas: number;
  realizadas: number;
  nao_realizadas: number;
  taxa_realizacao: number | null;
  otif_percentual: number | null;
};

export type DashboardLocality = {
  id_localidade: number;
  nome: string;
  lancamentos: number;
  itens_planejados: number;
  realizadas: number;
  nao_realizadas: number;
  taxa_realizacao: number | null;
  otif_percentual: number | null;
  elogios: number | null;
  reclamacoes: number | null;
};

export type DashboardReason = { id_motivo: number; motivo: string; quantidade: number };

export type DashboardPerson = {
  id_pessoa: number;
  nome: string;
  funcao: string;
  ativo: boolean;
  equipes: number;
  itens_planejados: number;
  realizadas: number;
  nao_realizadas: number;
  taxa_realizacao: number | null;
  otif_percentual: number | null;
  elogios: number | null;
  reclamacoes: number | null;
  score_atendimento: number;
};

export type DashboardTeam = {
  chave: string;
  equipe: string;
  itens_planejados: number;
  realizadas: number;
  nao_realizadas: number;
  taxa_realizacao: number | null;
  otif_percentual: number | null;
  lancamentos: number;
  elogios: number | null;
  reclamacoes: number | null;
};

export type DashboardResponse = {
  data_de: string | null;
  data_ate: string | null;
  id_localidade: number | null;
  resumo: {
    lancamentos_registrados: number;
    itens_planejados: number;
    entregas_realizadas: number;
    entregas_nao_realizadas: number;
    taxa_realizacao: number | null;
    otif_percentual: number | null;
  };
  feedback: { disponivel: boolean; elogios: number | null; reclamacoes: number | null };
  evolucao: DashboardTrendPoint[];
  por_localidade: DashboardLocality[];
  por_motivo: DashboardReason[];
  por_pessoa: DashboardPerson[];
  por_equipe: DashboardTeam[];
};
