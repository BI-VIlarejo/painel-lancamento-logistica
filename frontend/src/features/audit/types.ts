export type AuditOrigin = "ENTREGAS" | "ACESSOS" | "FEEDBACK";

export type AuditEvent = {
  origem: AuditOrigin;
  id_evento: number;
  tipo_evento: string;
  ator_usuario_id: number | null;
  ator_nome: string | null;
  ator_username: string | null;
  ocorrido_em: string;
  referencia_id: number | null;
  alvo: string | null;
  alteracoes: { campo: string; anterior: string | null; novo: string | null }[];
};

export type AuditFilters = {
  origem?: AuditOrigin | "TODOS";
  tipo_evento?: string;
  ator_usuario_id?: number;
  ocorrido_de?: string;
  ocorrido_ate?: string;
  limit?: number;
  offset?: number;
};

export type AuditEventPage = {
  items: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
};
