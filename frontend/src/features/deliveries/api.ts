import { apiRequest, isDemoMode } from "../../shared/api/apiClient";
import { demoApi } from "./demoApi";
import type {
  DeliveryDraftRequest,
  DeliveryDraftUpdateRequest,
  DeliveryEvent,
  DeliveryHistoryFilters,
  DeliveryLaunchDetail,
  DeliveryLaunchPage,
} from "./types";

function queryFrom(filters: DeliveryHistoryFilters): string {
  const params = new URLSearchParams();
  if (filters.estado && filters.estado !== "TODOS") params.set("estado", filters.estado);
  if (filters.data_de) params.set("data_de", filters.data_de);
  if (filters.data_ate) params.set("data_ate", filters.data_ate);
  if (filters.id_localidade) params.set("id_localidade", String(filters.id_localidade));
  if (filters.criado_por) params.set("criado_por", String(filters.criado_por));
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  return params.toString();
}

export const deliveriesApi = {
  list(filters: DeliveryHistoryFilters = {}): Promise<DeliveryLaunchPage> {
    if (isDemoMode) return demoApi.listDeliveries(filters);
    return apiRequest<DeliveryLaunchPage>(`/deliveries?${queryFrom(filters)}`);
  },
  get(id: string): Promise<DeliveryLaunchDetail> {
    if (isDemoMode) {
      return demoApi.getDelivery(id).then((result) => {
        if (!result) throw new Error("Lançamento não encontrado.");
        return result;
      });
    }
    return apiRequest<DeliveryLaunchDetail>(`/deliveries/${encodeURIComponent(id)}`);
  },
  events(id: string): Promise<DeliveryEvent[]> {
    if (isDemoMode) return demoApi.listDeliveryEvents(id);
    return apiRequest<DeliveryEvent[]>(`/deliveries/${encodeURIComponent(id)}/events`);
  },
  createDraft(payload: DeliveryDraftRequest, idempotencyKey: string): Promise<DeliveryLaunchDetail> {
    if (isDemoMode) return demoApi.createDraft(payload);
    return apiRequest<DeliveryLaunchDetail>("/deliveries", {
      method: "POST",
      body: payload,
      idempotencyKey,
    });
  },
  updateDraft(id: string, payload: DeliveryDraftUpdateRequest, idempotencyKey: string): Promise<DeliveryLaunchDetail> {
    if (isDemoMode) return demoApi.updateDraft(id, payload);
    return apiRequest<DeliveryLaunchDetail>(`/deliveries/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: payload,
      idempotencyKey,
    });
  },
  discardDraft(id: string, idempotencyKey: string): Promise<void> {
    if (isDemoMode) return demoApi.discardDraft(id);
    return apiRequest<void>(`/deliveries/${encodeURIComponent(id)}`, {
      method: "DELETE",
      idempotencyKey,
    });
  },
  confirmDraft(id: string, idempotencyKey: string): Promise<DeliveryLaunchDetail> {
    if (isDemoMode) return demoApi.confirmDraft(id);
    return apiRequest<DeliveryLaunchDetail>(`/deliveries/${encodeURIComponent(id)}/confirm`, {
      method: "POST",
      idempotencyKey,
    });
  },
  startCorrection(id: string, idempotencyKey: string): Promise<DeliveryLaunchDetail> {
    if (isDemoMode) return demoApi.startCorrection(id);
    return apiRequest<DeliveryLaunchDetail>(`/deliveries/${encodeURIComponent(id)}/corrections`, {
      method: "POST",
      body: {},
      idempotencyKey,
    });
  },
  cancel(id: string, justificativa: string, idempotencyKey: string): Promise<void> {
    if (isDemoMode) return demoApi.cancelDelivery(id, justificativa);
    return apiRequest<void>(`/deliveries/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: { justificativa },
      idempotencyKey,
    });
  },
};
