import { apiBlob, apiRequest, isDemoMode } from "../../shared/api/apiClient";
import { freightsDemoApi } from "./demoApi";
import type {
  AggregateCreateRequest,
  AggregatePaymentFilters,
  AggregateResponse,
  FreightHistoryFilters,
  FreightInput,
  FreightPage,
  FreightPaymentReport,
  FreightQuoteResponse,
  FreightResponse,
  FreightTariffOptions,
} from "./types";

/** Constrói a query string do histórico com os filtros aceitos pela API. */
function historyQuery(filters: FreightHistoryFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.data_de) params.set("data_de", filters.data_de);
  if (filters.data_ate) params.set("data_ate", filters.data_ate);
  if (filters.status_calculo && filters.status_calculo !== "TODOS") {
    params.set("status_calculo", filters.status_calculo);
  }
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  return params.toString();
}

/** Constrói os parâmetros comuns ao relatório e à exportação financeira. */
function paymentQuery(filters: AggregatePaymentFilters): string {
  const params = new URLSearchParams({
    data_de: filters.data_de,
    data_ate: filters.data_ate,
  });
  return params.toString();
}

/** Operações do módulo Fretes sobre a API real ou os dados de demonstração. */
export const freightsApi = {
  tariffOptions(): Promise<FreightTariffOptions> {
    return isDemoMode
      ? freightsDemoApi.tariffOptions()
      : apiRequest<FreightTariffOptions>("/freights/tariff-options");
  },

  listAggregates(): Promise<AggregateResponse[]> {
    return isDemoMode
      ? freightsDemoApi.listAggregates()
      : apiRequest<AggregateResponse[]>("/freights/aggregates");
  },

  createAggregate(payload: AggregateCreateRequest): Promise<AggregateResponse> {
    return isDemoMode
      ? freightsDemoApi.createAggregate(payload)
      : apiRequest<AggregateResponse>("/freights/aggregates", {
          method: "POST",
          body: payload,
        });
  },

  quote(payload: FreightInput): Promise<FreightQuoteResponse> {
    return isDemoMode
      ? freightsDemoApi.quote(payload)
      : apiRequest<FreightQuoteResponse>("/freights/quote", {
          method: "POST",
          body: payload,
        });
  },

  create(payload: FreightInput, idempotencyKey: string): Promise<FreightResponse> {
    return isDemoMode
      ? freightsDemoApi.create(payload)
      : apiRequest<FreightResponse>("/freights", {
          method: "POST",
          body: payload,
          idempotencyKey,
        });
  },

  list(filters: FreightHistoryFilters = {}): Promise<FreightPage> {
    return isDemoMode
      ? freightsDemoApi.list(filters)
      : apiRequest<FreightPage>(`/freights?${historyQuery(filters)}`);
  },

  paymentReport(filters: AggregatePaymentFilters): Promise<FreightPaymentReport> {
    return isDemoMode
      ? freightsDemoApi.paymentReport(filters)
      : apiRequest<FreightPaymentReport>(
          `/freights/payments/report?${paymentQuery(filters)}`,
        );
  },

  exportPaymentReport(filters: AggregatePaymentFilters): Promise<Blob> {
    return isDemoMode
      ? freightsDemoApi.exportPaymentReport(filters)
      : apiBlob(`/freights/payments/export.csv?${paymentQuery(filters)}`);
  },
};
