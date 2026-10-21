export type AuditOrigin = "ENTREGAS" | "ACESSOS" | "FEEDBACK";

export type AuditEvent = {
  origem: AuditOrigin;
  id_evento: number;
  tipo_evento: string;
  ator_usuario_id: number | null;
  ocorrido_em: string;
  referencia_id: number | null;
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
