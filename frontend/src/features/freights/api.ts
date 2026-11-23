import { apiBlob, apiRequest, isDemoMode } from "../../shared/api/apiClient";
import { freightsDemoApi } from "./demoApi";
import type {
  FreightHistoryFilters,
  FreightHistoryFilterOptions,
  FreightAggregateDriverOption,
  FreightCarrierDriverOption,
  FreightDeliverySummary,
  HistoricalFreightEditDriverOption,
  FreightInput,
  FreightPage,
  FreightPaymentAdjustmentCreateInput,
  FreightPaymentAdjustmentItem,
  FreightPaymentFilters,
  FreightPaymentInvoiceUpdateInput,
  FreightPaymentOptions,
  FreightPaymentPendingSummary,
  FreightPaymentReport,
  FreightPaymentSettlementCreateInput,
  FreightPaymentSettlementHistoryFilters,
  FreightPaymentSettlementPage,
  FreightPaymentSettlementStatusInput,
  FreightPaymentSettlementSummary,
  FreightQuoteResponse,
  FreightResponse,
  FreightTariffOptions,
  HistoricalFreightImportRequest,
  HistoricalFreightImportResponse,
  HistoricalFreightEditInput,
  JustInTimeRegionOption,
  JustInTimeZoneOption,
} from "./types";

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type TariffOptionsResponse = Omit<FreightTariffOptions, "zonas_just_in_time"> & {
  zonas_just_in_time: Array<JustInTimeRegionOption | JustInTimeZoneOption>;
};

const jitRegionGroups: Array<[string, string, string[]]> = [
  ["RIO_DE_JANEIRO", "Rio de Janeiro", ["ZONA_OESTE_1", "ZONA_OESTE_2", "ZONA_SUL", "BAIXADA_FLUMINENSE", "ZONA_NORTE_1", "ZONA_NORTE_2"]],
  ["REGIAO_SERRANA", "Região Serrana", ["REGI_O_SERRANA_1", "REGI_O_SERRANA_2"]],
  ["COSTA_VERDE", "Costa Verde", ["COSTA_VERDE_1", "COSTA_VERDE_2"]],
  ["VALE_DO_PARAIBA", "Vale do Paraíba", ["VALE_DO_PARAIBA1", "VALE_DO_PARAIBA_2"]],
];

/** Agrupa zonas planas e restringe respostas agrupadas ao catálogo JIT aprovado. */
function normalizeTariffOptions(options: TariffOptionsResponse): FreightTariffOptions {
  const availableZones = options.zonas_just_in_time.flatMap((item) =>
    "subzonas" in item ? item.subzonas : [item],
  );
  return {
    ...options,
    zonas_just_in_time: jitRegionGroups.map(([codigo, nome, zoneCodes]) => ({
      codigo,
      nome,
      subzonas: zoneCodes.flatMap((zoneCode) => {
        const zone = availableZones.find((item) => item.codigo === zoneCode);
        return zone ? [zone] : [];
      }),
    })),
  };
}

/** Constrói a query string do histórico com os filtros aceitos pela API. */
function historyQuery(filters: FreightHistoryFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.data_de) params.set("data_de", filters.data_de);
  if (filters.data_ate) params.set("data_ate", filters.data_ate);
  if (filters.tipo_transporte && filters.tipo_transporte !== "TODOS") {
    params.set("tipo_transporte", filters.tipo_transporte);
  }
  if (filters.status_calculo && filters.status_calculo !== "TODOS") {
    params.set("status_calculo", filters.status_calculo);
  }
  if (filters.id_motorista !== undefined) {
    params.set("id_motorista", String(filters.id_motorista));
  }
  if (filters.rota_cidade) params.set("rota_cidade", filters.rota_cidade);
  if (filters.codigo_transportadora) {
    params.set("codigo_transportadora", filters.codigo_transportadora);
  }
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  return params.toString();
}

/** Mesmos filtros do histórico, sem paginação, para exportar todas as correspondências. */
function historyExportQuery(filters: FreightHistoryFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.data_de) params.set("data_de", filters.data_de);
  if (filters.data_ate) params.set("data_ate", filters.data_ate);
  if (filters.tipo_transporte && filters.tipo_transporte !== "TODOS") {
    params.set("tipo_transporte", filters.tipo_transporte);
  }
  if (filters.status_calculo && filters.status_calculo !== "TODOS") {
    params.set("status_calculo", filters.status_calculo);
  }
  if (filters.id_motorista !== undefined) params.set("id_motorista", String(filters.id_motorista));
  if (filters.rota_cidade) params.set("rota_cidade", filters.rota_cidade);
  if (filters.codigo_transportadora) params.set("codigo_transportadora", filters.codigo_transportadora);
  return params.toString();
}

/** Constrói os parâmetros comuns ao relatório e à exportação financeira. */
function paymentQuery(filters: FreightPaymentFilters): string {
  const params = new URLSearchParams();
  if (filters.codigo_pagamento) {
    params.set("codigo_pagamento", filters.codigo_pagamento);
    params.set("tipo_transporte", filters.tipo_transporte);
    return params.toString();
  }
  params.set("data_de", filters.data_de);
  params.set("data_ate", filters.data_ate);
  params.set("tipo_transporte", filters.tipo_transporte);
  if (filters.nome_transportador) params.set("nome_transportador", filters.nome_transportador);
  if (filters.sem_identificacao) params.set("sem_identificacao", "true");
  if (filters.apenas_em_aberto) params.set("apenas_em_aberto", "true");
  if (filters.responsaveis?.length) {
    for (const item of filters.responsaveis) {
      params.append("responsaveis", item);
    }
  }
  return params.toString();
}

function settlementsHistoryQuery(filters: FreightPaymentSettlementHistoryFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.data_de) params.set("data_de", filters.data_de);
  if (filters.data_ate) params.set("data_ate", filters.data_ate);
  if (filters.tipo_transporte) params.set("tipo_transporte", filters.tipo_transporte);
  if (filters.status_pagamento) params.set("status_pagamento", filters.status_pagamento);
  if (filters.nome_transportador) params.set("nome_transportador", filters.nome_transportador);
  if (filters.incluir_estornados !== undefined) {
    params.set("incluir_estornados", String(filters.incluir_estornados));
  }
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  return params.toString();
}

function historyOptionsQuery(dataDe: string, dataAte: string, tipoTransporte: string): string {
  const params = new URLSearchParams();
  if (dataDe) params.set("data_de", dataDe);
  if (dataAte) params.set("data_ate", dataAte);
  if (tipoTransporte && tipoTransporte !== "TODOS") {
    params.set("tipo_transporte", tipoTransporte);
  }
  return params.toString();
}

function paymentOptionsQuery(dataDe: string, dataAte: string): string {
  return new URLSearchParams({ data_de: dataDe, data_ate: dataAte }).toString();
}

function aggregateDriversQuery(dataServico: string): string {
  return new URLSearchParams({ data_servico: dataServico }).toString();
}

function carrierDriversQuery(dataServico: string): string {
  return new URLSearchParams({ data_servico: dataServico }).toString();
}

function deliverySummaryQuery(dataServico: string, idMotorista: number): string {
  return new URLSearchParams({
    data_servico: dataServico,
    id_motorista: String(idMotorista),
  }).toString();
}

function historicalEditDriversQuery(dataServico: string): string {
  return new URLSearchParams({ data_servico: dataServico }).toString();
}

/** Operações do módulo Fretes sobre a API real ou os dados de demonstração. */
export const freightsApi = {
  tariffOptions(): Promise<FreightTariffOptions> {
    return isDemoMode
      ? freightsDemoApi.tariffOptions()
      : apiRequest<TariffOptionsResponse>("/freights/tariff-options").then(normalizeTariffOptions);
  },

  aggregateDrivers(dataServico: string): Promise<FreightAggregateDriverOption[]> {
    return isDemoMode
      ? freightsDemoApi.aggregateDrivers(dataServico)
      : apiRequest<FreightAggregateDriverOption[]>(
          `/freights/aggregate-drivers?${aggregateDriversQuery(dataServico)}`,
        );
  },

  carrierDrivers(dataServico: string): Promise<FreightCarrierDriverOption[]> {
    return isDemoMode
      ? freightsDemoApi.carrierDrivers(dataServico)
      : apiRequest<FreightCarrierDriverOption[]>(
          `/freights/carrier-drivers?${carrierDriversQuery(dataServico)}`,
        );
  },

  deliverySummary(dataServico: string, idMotorista: number): Promise<FreightDeliverySummary> {
    return isDemoMode
      ? freightsDemoApi.deliverySummary(dataServico, idMotorista)
      : apiRequest<FreightDeliverySummary>(
          `/freights/delivery-summary?${deliverySummaryQuery(dataServico, idMotorista)}`,
        );
  },

  historicalEditDrivers(dataServico: string): Promise<HistoricalFreightEditDriverOption[]> {
    return isDemoMode
      ? freightsDemoApi.historicalEditDrivers(dataServico)
      : apiRequest<HistoricalFreightEditDriverOption[]>(
          `/freights/historical-edit-drivers?${historicalEditDriversQuery(dataServico)}`,
        );
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

  importHistorical(payload: HistoricalFreightImportRequest): Promise<HistoricalFreightImportResponse> {
    return isDemoMode
      ? freightsDemoApi.importHistorical(payload)
      : apiRequest<HistoricalFreightImportResponse>("/freights/import", {
          method: "POST",
          body: payload,
        });
  },

  get(codigoFrete: string): Promise<FreightResponse> {
    return isDemoMode
      ? freightsDemoApi.get(codigoFrete)
      : apiRequest<FreightResponse>(`/freights/${encodeURIComponent(codigoFrete)}`);
  },

  update(codigoFrete: string, payload: FreightInput, idempotencyKey: string): Promise<FreightResponse> {
    return isDemoMode
      ? freightsDemoApi.update(codigoFrete, payload)
      : apiRequest<FreightResponse>(`/freights/${encodeURIComponent(codigoFrete)}`, {
          method: "PUT",
          body: payload,
          idempotencyKey,
        });
  },

  updateHistorical(
    codigoFrete: string,
    payload: HistoricalFreightEditInput,
    idempotencyKey: string,
  ): Promise<FreightResponse> {
    return isDemoMode
      ? freightsDemoApi.updateHistorical(codigoFrete, payload)
      : apiRequest<FreightResponse>(
          `/freights/${encodeURIComponent(codigoFrete)}/historical-edit`,
          { method: "PUT", body: payload, idempotencyKey },
        );
  },

  cancel(codigoFrete: string, justificativa: string, idempotencyKey: string): Promise<void> {
    return isDemoMode
      ? freightsDemoApi.cancel(codigoFrete, justificativa)
      : apiRequest<void>(`/freights/${encodeURIComponent(codigoFrete)}/cancel`, {
          method: "POST",
          body: { justificativa },
          idempotencyKey,
        });
  },

  list(filters: FreightHistoryFilters = {}): Promise<FreightPage> {
    return isDemoMode
      ? freightsDemoApi.list(filters)
      : apiRequest<FreightPage>(`/freights?${historyQuery(filters)}`);
  },

  exportHistory(filters: FreightHistoryFilters = {}): Promise<Blob> {
    return isDemoMode
      ? freightsDemoApi.exportHistory(filters)
      : apiBlob(`/freights/export.xlsx?${historyExportQuery(filters)}`, XLSX_MIME_TYPE);
  },

  historyFilterOptions(
    dataDe: string,
    dataAte: string,
    tipoTransporte: string,
  ): Promise<FreightHistoryFilterOptions> {
    return isDemoMode
      ? freightsDemoApi.historyFilterOptions(dataDe, dataAte, tipoTransporte)
      : apiRequest<FreightHistoryFilterOptions>(
          `/freights/history-filter-options?${historyOptionsQuery(dataDe, dataAte, tipoTransporte)}`,
        );
  },

  paymentReport(filters: FreightPaymentFilters): Promise<FreightPaymentReport> {
    return isDemoMode
      ? freightsDemoApi.paymentReport(filters)
      : apiRequest<FreightPaymentReport>(
          `/freights/payments/report?${paymentQuery(filters)}`,
        );
  },

  paymentOptions(dataDe: string, dataAte: string): Promise<FreightPaymentOptions> {
    return isDemoMode
      ? freightsDemoApi.paymentOptions(dataDe, dataAte)
      : apiRequest<FreightPaymentOptions>(
          `/freights/payments/options?${paymentOptionsQuery(dataDe, dataAte)}`,
        );
  },

  exportPaymentReport(filters: FreightPaymentFilters): Promise<Blob> {
    return isDemoMode
      ? freightsDemoApi.exportPaymentReport(filters)
      : apiBlob(`/freights/payments/export.xlsx?${paymentQuery(filters)}`, XLSX_MIME_TYPE);
  },

  paymentPendingSummary(): Promise<FreightPaymentPendingSummary> {
    return isDemoMode
      ? freightsDemoApi.paymentPendingSummary()
      : apiRequest<FreightPaymentPendingSummary>("/freights/payments/pending-summary");
  },

  createPaymentSettlements(
    payload: FreightPaymentSettlementCreateInput,
  ): Promise<FreightPaymentSettlementSummary[]> {
    return isDemoMode
      ? freightsDemoApi.createPaymentSettlements(payload)
      : apiRequest<FreightPaymentSettlementSummary[]>("/freights/payments/settlements", {
          method: "POST",
          body: payload,
        });
  },

  updatePaymentSettlementStatus(
    codigoPagamento: string,
    payload: FreightPaymentSettlementStatusInput,
  ): Promise<FreightPaymentSettlementSummary> {
    return isDemoMode
      ? freightsDemoApi.updatePaymentSettlementStatus(codigoPagamento, payload)
      : apiRequest<FreightPaymentSettlementSummary>(
          `/freights/payments/settlements/${encodeURIComponent(codigoPagamento)}/status`,
          { method: "PATCH", body: payload },
        );
  },

  updatePaymentSettlementInvoice(
    codigoPagamento: string,
    payload: FreightPaymentInvoiceUpdateInput,
  ): Promise<FreightPaymentSettlementSummary> {
    return isDemoMode
      ? freightsDemoApi.updatePaymentSettlementInvoice(codigoPagamento, payload)
      : apiRequest<FreightPaymentSettlementSummary>(
          `/freights/payments/settlements/${encodeURIComponent(codigoPagamento)}/invoice`,
          { method: "PATCH", body: payload },
        );
  },

  listPaymentSettlements(
    filters: FreightPaymentSettlementHistoryFilters = {},
  ): Promise<FreightPaymentSettlementPage> {
    return isDemoMode
      ? freightsDemoApi.listPaymentSettlements(filters)
      : apiRequest<FreightPaymentSettlementPage>(
          `/freights/payments/settlements?${settlementsHistoryQuery(filters)}`,
        );
  },

  listPaymentAdjustments(
    dataDe?: string,
    dataAte?: string,
    tipoTransporte?: string,
    nomeTransportador?: string,
  ): Promise<FreightPaymentAdjustmentItem[]> {
    if (isDemoMode) {
      return freightsDemoApi.listPaymentAdjustments(dataDe, dataAte, tipoTransporte, nomeTransportador);
    }
    const params = new URLSearchParams();
    if (dataDe) params.set("data_de", dataDe);
    if (dataAte) params.set("data_ate", dataAte);
    if (tipoTransporte) params.set("tipo_transporte", tipoTransporte);
    if (nomeTransportador) params.set("nome_transportador", nomeTransportador);
    return apiRequest<FreightPaymentAdjustmentItem[]>(
      `/freights/payments/adjustments?${params.toString()}`,
    );
  },

  createPaymentAdjustments(
    payload: FreightPaymentAdjustmentCreateInput,
  ): Promise<FreightPaymentAdjustmentItem[]> {
    return isDemoMode
      ? freightsDemoApi.createPaymentAdjustments(payload)
      : apiRequest<FreightPaymentAdjustmentItem[]>("/freights/payments/adjustments", {
          method: "POST",
          body: payload,
        });
  },

  deletePaymentAdjustment(codigoAjuste: string): Promise<void> {
    return isDemoMode
      ? freightsDemoApi.deletePaymentAdjustment(codigoAjuste)
      : apiRequest<void>(
          `/freights/payments/adjustments/${encodeURIComponent(codigoAjuste)}`,
          { method: "DELETE" },
        );
  },
};
