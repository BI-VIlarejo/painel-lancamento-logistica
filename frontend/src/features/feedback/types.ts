export type FeedbackType = "RECLAMACAO" | "ELOGIO";
export type FeedbackRole = "MOTORISTA" | "AJUDANTE";

export type FeedbackParticipant = {
  id_pessoa: number;
  nome_exibicao: string;
  papel_participante: FeedbackRole;
};

export type FeedbackItem = {
  id_feedback: number;
  codigo_lancamento: string;
  codigo_revisao: string;
  codigo_item_lancamento: string;
  data_feedback: string;
  data_entrega: string;
  tipo: FeedbackType;
  id_localidade: number;
  nome_localidade: string;
  participantes: FeedbackParticipant[];
  relato: string;
  criado_em: string;
};

export type FeedbackCreateInput = {
  data_feedback: string;
  tipo: FeedbackType;
  codigo_lancamento: string;
  codigo_revisao: string;
  codigo_item_lancamento: string;
  relato: string;
};

export type FeedbackDeliveryItem = {
  codigo_lancamento: string;
  codigo_revisao: string;
  codigo_item_lancamento: string;
  data_entrega: string;
  id_localidade: number;
  nome_localidade: string;
  quantidade_realizada: number;
  quantidade_nao_realizada: number;
  participantes: FeedbackParticipant[];
};

export type FeedbackListFilters = {
  q?: string;
  tipo?: FeedbackType | "TODOS";
  id_localidade?: number;
  data_de?: string;
  data_ate?: string;
  limit?: number;
  offset?: number;
};

export type FeedbackLocality = {
  id_localidade: number;
  nome_localidade: string;
};

export type FeedbackPageResponse = {
  items: FeedbackItem[];
  total: number;
  limit: number;
  offset: number;
};
