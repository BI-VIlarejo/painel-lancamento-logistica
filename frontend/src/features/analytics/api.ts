import { apiRequest, isDemoMode } from "../../shared/api/apiClient";
import { demoAnalyticsApi } from "./demoApi";
import type {
  DashboardFilters,
  DashboardGoal,
  DashboardResponse,
  TransportDashboardDetailResponse,
  TransportDashboardFilters,
  TransportDashboardResponse,
  TransportDetailFilters,
} from "./types";

function queryFrom(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.data_de) params.set("data_de", filters.data_de);
  if (filters.data_ate) params.set("data_ate", filters.data_ate);
  if (filters.id_localidade) params.set("id_localidade", String(filters.id_localidade));
  if (filters.tipo_transporte_entrega) params.set("tipo_transporte_entrega", filters.tipo_transporte_entrega);
  return params.toString();
}

function transportQueryFrom(filters: TransportDashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.data_de) params.set("data_de", filters.data_de);
  if (filters.data_ate) params.set("data_ate", filters.data_ate);
  return params.toString();
}

function transportDetailQueryFrom(filters: TransportDetailFilters): string {
  const params = new URLSearchParams();
  params.set("kind", filters.kind);
  params.set("key", filters.key);
  if (filters.data_de) params.set("data_de", filters.data_de);
  if (filters.data_ate) params.set("data_ate", filters.data_ate);
  if (filters.freight_limit !== undefined) params.set("freight_limit", String(filters.freight_limit));
  if (filters.freight_offset !== undefined) params.set("freight_offset", String(filters.freight_offset));
  if (filters.delivery_limit !== undefined) params.set("delivery_limit", String(filters.delivery_limit));
  if (filters.delivery_offset !== undefined) params.set("delivery_offset", String(filters.delivery_offset));
  return params.toString();
}

export const analyticsApi = {
  dashboard(filters: DashboardFilters = {}): Promise<DashboardResponse> {
    if (isDemoMode) return demoAnalyticsApi.dashboard(filters);
    const query = queryFrom(filters);
    return apiRequest<DashboardResponse>(`/analytics/dashboard${query ? `?${query}` : ""}`);
  },
  transport(filters: TransportDashboardFilters = {}, signal?: AbortSignal): Promise<TransportDashboardResponse> {
    if (isDemoMode) return demoAnalyticsApi.transport(filters);
    const query = transportQueryFrom(filters);
    return apiRequest<TransportDashboardResponse>(`/analytics/transport${query ? `?${query}` : ""}`, { signal });
  },
  transportDetails(filters: TransportDetailFilters, signal?: AbortSignal): Promise<TransportDashboardDetailResponse> {
    if (isDemoMode) return demoAnalyticsApi.transportDetails(filters);
    const query = transportDetailQueryFrom(filters);
    return apiRequest<TransportDashboardDetailResponse>(`/analytics/transport/details?${query}`, { signal });
  },
  goal(): Promise<DashboardGoal> {
    if (isDemoMode) return demoAnalyticsApi.goal();
    return apiRequest<DashboardGoal>("/analytics/goal");
  },
  updateGoal(
    value: number,
    periodicidade: DashboardGoal["periodicidade"],
    escopo_operacao: DashboardGoal["escopo_operacao"],
  ): Promise<DashboardGoal> {
    if (isDemoMode) return demoAnalyticsApi.updateGoal(value, periodicidade, escopo_operacao);
    return apiRequest<DashboardGoal>("/analytics/goal", {
      method: "PUT",
      body: { valor_percentual: value, periodicidade, escopo_operacao },
    });
  },
};
