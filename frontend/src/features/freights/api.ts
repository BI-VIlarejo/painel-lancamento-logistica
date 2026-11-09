import { apiBlob, apiRequest, isDemoMode } from "../../shared/api/apiClient";
import { freightsDemoApi } from "./demoApi";
import type {
  FreightHistoryFilters,
  FreightAggregateDriverOption,
  FreightCarrierDriverOption,
  FreightDeliverySummary,
  FreightInput,
  FreightPage,
  FreightPaymentFilters,
  FreightPaymentOptions,
  FreightPaymentReport,
  FreightQuoteResponse,
  FreightResponse,
  FreightTariffOptions,
  JustInTimeRegionOption,
  JustInTimeZoneOption,
} from "./types";

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
type TariffOptionsResponse = Omit<FreightTariffOptions, "zonas_just_in_time"> & {
  zonas_just_in_time: Array<JustInTimeRegionOption | JustInTimeZoneOption>;
};

const jitRegionGroups: Array<[string, string, string[]]> = [
  ["RIO_DE_JANEIRO", "Rio de Janeiro", ["ZONA_OESTE_1", "ZONA_OESTE_2", "ZONA_SUL", "ZONA_NORTE_1", "ZONA_NORTE_2"]],
  ["REGIAO_SERRANA", "Região Serrana", ["REGI_O_SERRANA_1", "REGI_O_SERRANA_2"]],
];

/** Agrupa a resposta antiga da API enquanto o backend de staging é atualizado. */
function normalizeTariffOptions(options: TariffOptionsResponse): FreightTariffOptions {
  const firstZone = options.zonas_just_in_time[0];
  if (!firstZone || "subzonas" in firstZone) {
    return options as FreightTariffOptions;
  }

  const flatZones = options.zonas_just_in_time as JustInTimeZoneOption[];
  return {
    ...options,
    zonas_just_in_time: jitRegionGroups.map(([codigo, nome, zoneCodes]) => ({
      codigo,
      nome,
      subzonas: zoneCodes.flatMap((zoneCode) => {
        const zone = flatZones.find((item) => item.codigo === zoneCode);
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
  params.set("limit", String(filters.limit ?? 50));
  params.set("offset", String(filters.offset ?? 0));
  return params.toString();
}

/** Constrói os parâmetros comuns ao relatório e à exportação financeira. */
function paymentQuery(filters: FreightPaymentFilters): string {
  const params = new URLSearchParams({
    data_de: filters.data_de,
    data_ate: filters.data_ate,
    tipo_transporte: filters.tipo_transporte,
  });
  if (filters.nome_transportador) params.set("nome_transportador", filters.nome_transportador);
  if (filters.sem_identificacao) params.set("sem_identificacao", "true");
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
};
