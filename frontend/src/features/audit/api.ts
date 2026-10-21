import { apiRequest, isDemoMode } from "../../shared/api/apiClient";
import { demoAuditApi } from "./demoApi";
import type { AuditEventPage, AuditFilters } from "./types";

function queryFrom(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.origem && filters.origem !== "TODOS") params.set("origem", filters.origem);
  if (filters.tipo_evento) params.set("tipo_evento", filters.tipo_evento.trim());
  if (filters.ator_usuario_id) params.set("ator_usuario_id", String(filters.ator_usuario_id));
  if (filters.ocorrido_de) params.set("ocorrido_de", `${filters.ocorrido_de}T00:00:00`);
  if (filters.ocorrido_ate) params.set("ocorrido_ate", `${filters.ocorrido_ate}T23:59:59`);
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  return params.toString();
}

export const auditApi = {
  list(filters: AuditFilters = {}): Promise<AuditEventPage> {
    if (isDemoMode) return demoAuditApi.list(filters);
    return apiRequest<AuditEventPage>(`/audit/events?${queryFrom(filters)}`);
  },
};
