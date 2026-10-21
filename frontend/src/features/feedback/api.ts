import { apiBlob, apiRequest, isDemoMode } from "../../shared/api/apiClient";
import { demoFeedbackApi } from "./demoApi";
import type {
  FeedbackCreateInput,
  FeedbackDeliveryItem,
  FeedbackItem,
  FeedbackLocality,
  FeedbackListFilters,
  FeedbackPageResponse,
} from "./types";

function queryFrom(filters: FeedbackListFilters, includePage = true): string {
  const params = new URLSearchParams();
  const query = filters.q?.trim();
  if (query) params.set("q", query);
  if (filters.tipo && filters.tipo !== "TODOS") params.set("tipo", filters.tipo);
  if (filters.id_localidade) params.set("id_localidade", String(filters.id_localidade));
  if (filters.data_de) params.set("data_de", filters.data_de);
  if (filters.data_ate) params.set("data_ate", filters.data_ate);
  if (includePage) {
    params.set("limit", String(filters.limit ?? 25));
    params.set("offset", String(filters.offset ?? 0));
  }
  return params.toString();
}

export const feedbackApi = {
  localities(): Promise<FeedbackLocality[]> {
    if (isDemoMode) return demoFeedbackApi.localities();
    return apiRequest<FeedbackLocality[]>("/feedbacks/localities");
  },
  list(filters: FeedbackListFilters = {}): Promise<FeedbackPageResponse> {
    return isDemoMode
      ? demoFeedbackApi.list(filters)
      : apiRequest<FeedbackPageResponse>(`/feedbacks?${queryFrom(filters)}`);
  },
  deliveryItems(dataEntrega: string, idLocalidade: number): Promise<FeedbackDeliveryItem[]> {
    if (isDemoMode) return demoFeedbackApi.deliveryItems(dataEntrega, idLocalidade);
    const params = new URLSearchParams({ data_entrega: dataEntrega, id_localidade: String(idLocalidade) });
    return apiRequest<FeedbackDeliveryItem[]>(`/feedbacks/delivery-items?${params}`);
  },
  create(payload: FeedbackCreateInput): Promise<FeedbackItem> {
    return isDemoMode
      ? demoFeedbackApi.create(payload)
      : apiRequest<FeedbackItem>("/feedbacks", { method: "POST", body: payload });
  },
  export(filters: FeedbackListFilters = {}): Promise<Blob> {
    if (isDemoMode) return demoFeedbackApi.export(filters);
    return apiBlob(`/feedbacks/export?${queryFrom(filters, false)}`);
  },
};
