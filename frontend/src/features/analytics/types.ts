import type { FreightResponse } from "../freights/types";

export type DashboardFilters = {
  data_de?: string;
  data_ate?: string;
  id_localidade?: number;
  tipo_transporte_entrega?: "PROPRIA" | "TERCEIRIZADA";
};

export type DashboardTrendPoint = {
  data: string;
  planejadas: number;
  realizadas: number;
  nao_realizadas: number;
  taxa_realizacao: number | null;
  otif_percentual: number | null;
  entregas_realizadas: number;
  entregas_nao_realizadas: number;
  coletas_realizadas: number;
  coletas_nao_realizadas: number;
};

export type DashboardGoal = {
  indicador: "TAXA_REALIZACAO";
  valor_percentual: number;
  periodicidade: "MENSAL" | "TRIMESTRAL" | "ANUAL";
  escopo_operacao: "TODAS" | "ENTREGAS" | "COLETAS";
  atualizado_em: string | null;
  atualizado_por: string | null;
  pode_editar: boolean;
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
  entregas_realizadas: number;
  entregas_nao_realizadas: number;
  coletas_realizadas: number;
  coletas_nao_realizadas: number;
  elogios: number | null;
  reclamacoes: number | null;
};

export type DashboardReason = {
  tipo_operacao: "ENTREGA" | "COLETA";
  id_motivo: number;
  motivo: string;
  grupo_motivo: string | null;
  quantidade: number;
  percentual_das_nao_realizadas: number | null;
  incidencia_sobre_total: number | null;
  equipes: DashboardReasonTeam[];
};
export type DashboardReasonTeam = {
  chave: string;
  equipe: string;
  quantidade: number;
  id_motorista?: number | null;
  motorista?: string | null;
};
export type DashboardTeamReason = {
  tipo_operacao: "ENTREGA" | "COLETA";
  id_motivo: number;
  motivo: string;
  grupo_motivo: string | null;
  quantidade: number;
  percentual_das_nao_realizadas: number | null;
  incidencia_sobre_total: number | null;
};
export type DashboardReasonGroup = {
  tipo_operacao: "ENTREGA" | "COLETA";
  grupo_motivo: string | null;
  quantidade: number;
  percentual_das_nao_realizadas: number | null;
  incidencia_sobre_total: number | null;
};
export type DashboardDeliveryType = {
  tipo_transporte_entrega: string | null;
  registros_entrega: number;
  itens_planejados: number;
  realizadas: number;
  nao_realizadas: number;
  registros_coleta: number;
  entregas_planejadas: number;
  entregas_realizadas: number;
  entregas_nao_realizadas: number;
  coletas_planejadas: number;
  coletas_realizadas: number;
  coletas_nao_realizadas: number;
  taxa_realizacao: number | null;
  otif_percentual: number | null;
  motoristas: DashboardDeliveryDriver[];
};
export type DashboardDeliveryDriver = {
  id_pessoa: number;
  nome: string;
  entregas_planejadas: number;
  entregas_realizadas: number;
  entregas_nao_realizadas: number;
  coletas_planejadas: number;
  coletas_realizadas: number;
  coletas_nao_realizadas: number;
  taxa_realizacao: number | null;
  motivos: DashboardDeliveryDriverReason[];
};
export type DashboardDeliveryDriverReason = {
  tipo_operacao: "ENTREGA" | "COLETA";
  id_motivo: number;
  motivo: string;
  grupo_motivo: string | null;
  quantidade: number;
};
export type DashboardPersonReason = {
  tipo_operacao: "ENTREGA" | "COLETA";
  id_motivo: number;
  motivo: string;
  grupo_motivo: string | null;
  quantidade: number;
};

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
  entregas_realizadas: number;
  entregas_nao_realizadas: number;
  coletas_realizadas: number;
  coletas_nao_realizadas: number;
  elogios: number | null;
  reclamacoes: number | null;
  score_atendimento: number;
  motivos_da_equipe: DashboardPersonReason[];
};

export type DashboardTeam = {
  chave: string;
  equipe: string;
  id_motorista?: number | null;
  motorista?: string | null;
  itens_planejados: number;
  realizadas: number;
  nao_realizadas: number;
  taxa_realizacao: number | null;
  otif_percentual: number | null;
  entregas_realizadas: number;
  entregas_nao_realizadas: number;
  coletas_realizadas: number;
  coletas_nao_realizadas: number;
  lancamentos: number;
  elogios: number | null;
  reclamacoes: number | null;
  motivos: DashboardTeamReason[];
};

export type DashboardResponse = {
  data_de: string | null;
  data_ate: string | null;
  id_localidade: number | null;
  tipo_transporte_entrega: "PROPRIA" | "TERCEIRIZADA" | null;
  resumo: {
    lancamentos_registrados: number;
    itens_planejados: number;
    entregas_realizadas: number;
    entregas_nao_realizadas: number;
    coletas_realizadas: number;
    coletas_nao_realizadas: number;
    taxa_realizacao: number | null;
    otif_percentual: number | null;
  };
  feedback: { disponivel: boolean; elogios: number | null; reclamacoes: number | null };
  evolucao: DashboardTrendPoint[];
  por_localidade: DashboardLocality[];
  por_motivo: DashboardReason[];
  por_grupo_motivo: DashboardReasonGroup[];
  por_tipo_entrega: DashboardDeliveryType[];
  por_pessoa: DashboardPerson[];
  por_equipe: DashboardTeam[];
};

export type TransportDashboardFilters = {
  data_de?: string;
  data_ate?: string;
};

export type TransportPaymentItem = {
  key: string;
  label: string;
  total: number;
  fretes_count: number;
  known_count: number;
};

export type TransportRateItem = {
  key: string;
  label: string;
  percentual: number;
  known_count: number;
};

export type TransportCarrierDeliveryItem = {
  key: string;
  label: string;
  planned: number;
  realized: number;
  not_realized: number;
  occurrences: number;
  accuracy: number | null;
};

export type TransportKmItem = {
  key: string;
  label: string;
  total_km: number;
  known_count: number;
};

export type TransportCityDeliveryItem = {
  city: string;
  planned: number;
  realized: number;
  not_realized: number;
  occurrences: number;
};

export type TransportDashboardResponse = {
  data_de: string | null;
  data_ate: string | null;
  total_fretes: number;
  total_registros_entrega: number;
  pagamentos: TransportPaymentItem[];
  percentuais_frete: TransportRateItem[];
  entregas_transportadora: TransportCarrierDeliveryItem[];
  km_rodado: TransportKmItem[];
  entregas_cidade: TransportCityDeliveryItem[];
};

export type TransportDetailFilters = {
  kind: "carrier" | "city";
  key: string;
  data_de?: string;
  data_ate?: string;
  freight_limit?: number;
  freight_offset?: number;
  delivery_limit?: number;
  delivery_offset?: number;
};

export type TransportDetailParticipant = {
  nome_exibicao: string;
  papel_participante: string;
};

export type TransportDetailReason = {
  descricao_motivo: string;
  quantidade: number;
};

export type TransportDetailDeliveryItem = {
  codigo_lancamento: string;
  codigo_item_lancamento: string;
  data_entrega: string;
  id_localidade: number;
  codigo_localidade: string;
  nome_localidade: string;
  cidade: string | null;
  uf: string | null;
  carrier_label: string;
  driver: string | null;
  quantidade_realizada: number;
  quantidade_nao_realizada: number;
  ocorrencias: number;
  quantidade_reclamacoes: number;
  quantidade_elogios: number;
  observacao: string | null;
  participantes: TransportDetailParticipant[];
  motivos: TransportDetailReason[];
};

export type TransportDetailTotals = {
  fretes_count: number;
  pagamento_total: number;
  pagamento_count: number;
  percentual_frete: number | null;
  percentual_count: number;
  km_total: number;
  km_count: number;
  registros_entrega: number;
  entregas_planejadas: number;
  entregas_realizadas: number;
  entregas_nao_realizadas: number;
  ocorrencias: number;
  taxa_acerto: number | null;
};

export type TransportDashboardDetailResponse = {
  kind: "carrier" | "city";
  key: string;
  data_de: string | null;
  data_ate: string | null;
  totals: TransportDetailTotals;
  fretes: {
    items: FreightResponse[];
    total: number;
    limit: number;
    offset: number;
  };
  entregas: {
    items: TransportDetailDeliveryItem[];
    total: number;
    limit: number;
    offset: number;
  };
};
