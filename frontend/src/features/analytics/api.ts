import { apiRequest } from "../../shared/api/apiClient";
import type { DashboardFilters, DashboardResponse } from "./types";

function queryFrom(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.data_de) params.set("data_de", filters.data_de);
  if (filters.data_ate) params.set("data_ate", filters.data_ate);
  if (filters.id_localidade) params.set("id_localidade", String(filters.id_localidade));
  return params.toString();
}

export const analyticsApi = {
  dashboard(filters: DashboardFilters = {}): Promise<DashboardResponse> {
    const query = queryFrom(filters);
    return apiRequest<DashboardResponse>(`/analytics/dashboard${query ? `?${query}` : ""}`);
  },
};
