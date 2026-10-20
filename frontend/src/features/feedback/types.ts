export type FeedbackType = "RECLAMACAO" | "ELOGIO";
export type FeedbackRole = "MOTORISTA" | "AJUDANTE";

export type FeedbackParticipant = {
  id_pessoa: number;
  nome_exibicao: string;
  papel_participante: FeedbackRole;
};

export type FeedbackItem = {
  id_feedback: string;
  data_feedback: string;
  tipo: FeedbackType;
  id_localidade: number;
  nome_localidade: string;
  nome_cliente: string | null;
  participantes: FeedbackParticipant[];
  relato: string;
  criado_em: string;
};

export type FeedbackCreateInput = {
  data_feedback: string;
  tipo: FeedbackType;
  id_localidade: number;
  nome_cliente: string | null;
  participantes: { id_pessoa: number; papel_participante: FeedbackRole }[];
  relato: string;
};

export type FeedbackPageResponse = {
  items: FeedbackItem[];
  total: number;
  limit: number;
  offset: number;
};
