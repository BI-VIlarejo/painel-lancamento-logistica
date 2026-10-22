export type FeedbackType = "RECLAMACAO" | "ELOGIO";
export type FeedbackRole = "MOTORISTA" | "AJUDANTE";

export type FeedbackParticipant = {
  id_pessoa: number;
  nome_exibicao: string;
  papel_participante: FeedbackRole;
};

export type FeedbackParticipantInput = Pick<FeedbackParticipant, "id_pessoa" | "papel_participante">;

export type FeedbackItem = {
  id_feedback: number;
  codigo_lancamento: string;
  codigo_revisao: string;
  codigo_item_lancamento: string;
  data_feedback: string;
  data_entrega: string;
  tipo: FeedbackType;
  nome_cliente?: string | null;
  id_localidade: number;
  nome_localidade: string;
  participantes: FeedbackParticipant[];
  relato: string;
  criado_em: string;
};

export type FeedbackCreateInput = {
  data_feedback: string;
  tipo: FeedbackType;
  nome_cliente: string;
  codigo_lancamento: string;
  codigo_revisao: string;
  codigo_item_lancamento: string;
  participantes?: FeedbackParticipantInput[];
  relato: string;
};

export type FeedbackImportRowInput = {
  line: number;
  item: FeedbackCreateInput;
};

export type FeedbackImportRequest = { rows: FeedbackImportRowInput[] };
export type FeedbackImportPreviewRequest = {
  rows: { line: number; item: Omit<FeedbackCreateInput, "relato" | "nome_cliente"> }[];
};

export type FeedbackImportPreviewRow = {
  line: number;
  valid: boolean;
  errors: string[];
};

export type FeedbackImportPreviewResponse = { rows: FeedbackImportPreviewRow[] };
export type FeedbackImportResult = { imported: number };

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
