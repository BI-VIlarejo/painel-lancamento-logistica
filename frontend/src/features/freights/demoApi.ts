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
  FreightPaymentResponsibleSummary,
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
import type { PaymentRequestWorkbookRow } from "./paymentRequestWorkbook";

const FREIGHTS_KEY = "lancamento-logistica:demo-freights";
const PAYMENT_SETTLEMENTS_KEY = "lancamento-logistica:demo-payment-settlements";
const PAYMENT_ADJUSTMENTS_KEY = "lancamento-logistica:demo-payment-adjustments";
const UNIDENTIFIED_KEY = "__SEM_IDENTIFICACAO__";

type DemoSettlementRecord = FreightPaymentSettlementSummary & {
  freight_snapshots: Array<{
    id_frete: number;
    valor_frete_pago_snapshot: number;
    valor_avaria_snapshot: number;
  }>;
  adjustment_codes: string[];
};

function readDemoSettlements(): DemoSettlementRecord[] {
  try {
    const raw = window.localStorage.getItem(PAYMENT_SETTLEMENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DemoSettlementRecord[]) : [];
  } catch {
    return [];
  }
}

function saveDemoSettlements(items: DemoSettlementRecord[]): void {
  window.localStorage.setItem(PAYMENT_SETTLEMENTS_KEY, JSON.stringify(items));
}

function readDemoAdjustments(): FreightPaymentAdjustmentItem[] {
  try {
    const raw = window.localStorage.getItem(PAYMENT_ADJUSTMENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FreightPaymentAdjustmentItem[]) : [];
  } catch {
    return [];
  }
}

function saveDemoAdjustments(items: FreightPaymentAdjustmentItem[]): void {
  window.localStorage.setItem(PAYMENT_ADJUSTMENTS_KEY, JSON.stringify(items));
}

function demoTodayIso(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function demoAddDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() + days);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function demoAddMonths(iso: string, months: number): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) - 1 + months;
  const day = Number(iso.slice(8, 10));
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const clamped = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

function demoProfileMeta(name: string, type: "AGREGADO" | "TRANSPORTADORA") {
  if (type === "TRANSPORTADORA") {
    return {
      documento_fiscal: name.toUpperCase().includes("PAULO") ? "12.345.678/0001-90" : "98.765.432/0001-10",
      chave_pix: name.toUpperCase().includes("PAULO") ? "financeiro@paulocruz.demo" : "financeiro@justintime.demo",
      exige_nota_fiscal: true,
    };
  }
  return {
    documento_fiscal: "123.456.789-01",
    chave_pix: `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@pix.demo`,
    exige_nota_fiscal: false,
  };
}
const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 120));
const carrierDriverExamples: FreightCarrierDriverOption[] = [
  {
    id_motorista: 601,
    nome_motorista: "Motorista Just In Time",
    codigo_transportadora: "JUST_IN_TIME",
    nome_transportadora: "JUST IN TIME",
  },
  {
    id_motorista: 701,
    nome_motorista: "Motorista Paulo Cruz",
    codigo_transportadora: "PAULO_CRUZ",
    nome_transportadora: "Paulo Cruz",
  },
];

function carrierDriverName(id: number | null): string | null {
  if (id === null) return null;
  return carrierDriverExamples
    .find((driver) => driver.id_motorista === id)?.nome_motorista ?? null;
}

const tariffSources = [
  { codigo: "AGREGADOS_CD", nome: "Agregados CD" },
  { codigo: "JUST_IN_TIME", nome: "JUST IN TIME" },
  { codigo: "PAULO_CRUZ", nome: "Paulo Cruz" },
];

const aggregateRoutes = [
  { codigo: "RIO DAS OSTRAS", nome: "Rio das Ostras" },
  { codigo: "MACAE", nome: "Macaé" },
  { codigo: "MACAE SERRA", nome: "Macaé Serra" },
  { codigo: "CABO FRIO", nome: "Cabo Frio" },
  { codigo: "ARMACAO DOS BUZIOS", nome: "Armação dos Búzios" },
  { codigo: "SAO PEDRO DA ALDEIA", nome: "São Pedro da Aldeia" },
  { codigo: "ARRAIAL DO CABO", nome: "Arraial do Cabo" },
  { codigo: "ARARUAMA", nome: "Araruama" },
  { codigo: "CAMPOS DOS GOYTACAZES", nome: "Campos dos Goytacazes" },
];

const jitZones: JustInTimeZoneOption[] = [
  { codigo: "ZONA_OESTE_1", nome: "ZONA OESTE 1", areas: "Recreio dos Bandeirantes, Garnenia, Azul, Anil, Barra da Tijuca, Joá, Itanhangá, Jacarépagua, Freguesia, Taquara, Tanque, Praça Seca, Camorim, Jardim Sulacap, Vila Valqueire" },
  { codigo: "ZONA_OESTE_2", nome: "ZONA OESTE 2", areas: "Guaratiba, Pedra de Guaratiba, Campo Grande, Santa Cruz, Barra de Guarariba, Vargem Grande" },
  { codigo: "ZONA_SUL", nome: "ZONA SUL", areas: "Flamengo, Botafogo, Cosme Velho, Glória, Humaitá, Santa Teresa, Catete, Copacabana, Ipanema, Leblon, Jardim Botânico, Lagoa, São Conrado, Leme, Gávea" },
  { codigo: "BAIXADA_FLUMINENSE", nome: "BAIXADA FLUMINENSE", areas: "Caxias, Nova Iguaçu, Belford Roxo, Mesquita, Queimados, Eng Pedreira, Japeri, Nilopólis" },
  { codigo: "ZONA_NORTE_1", nome: "ZONA NORTE 1", areas: "Cachambi, Pilares, Piedade, Cascadura, Madureira, Todos os Santos, Bonsucesso, Ramos, Penha, Engenho de Dentro, Ilha do Governador" },
  { codigo: "ZONA_NORTE_2", nome: "ZONA NORTE 2", areas: "Macaranã, Tijuca, Vila Isabel, Grajaú, Andaraí, Alto da Boa Vista, Caju, Centro" },
  { codigo: "REGI_O_SERRANA_1", nome: "REGIÃO SERRANA 1", areas: "Petropólis, Itaipava, Três Rios, Areal" },
  { codigo: "REGI_O_SERRANA_2", nome: "REGIÃO SERRANA 2", areas: "Teresopólis, Cachoeira de Macacu, Friburgo, Bom Jardim, Nova Friburgo" },
  { codigo: "COSTA_VERDE_1", nome: "COSTA VERDE 1", areas: "Iataguai, Itacuruça, Coroa Grande, Muriqui, Conceição de Jacarei, Mangaratiba" },
  { codigo: "COSTA_VERDE_2", nome: "COSTA VERDE 2", areas: "Angra dos Reis, Paraty, Rio Claro, Lídice" },
  { codigo: "VALE_DO_PARAIBA1", nome: "VALE DO PARAÍBA 1", areas: "Parai, Barra do Parai, Volta Redonda, Rio das Flore, Itatiaia, Porto Real, Quatis, Barra Mansa, Resende, Valença, Pinheiral" },
  { codigo: "VALE_DO_PARAIBA_2", nome: "VALE DO PARAÍBA 2", areas: "Miguel Pereira, Paty Alferes, Mendes, Paraiba do Sul, Vassouras, Avelar" },
];

const jitRegionGroups: Array<[string, string, string[]]> = [
  ["RIO_DE_JANEIRO", "Rio de Janeiro", ["ZONA_OESTE_1", "ZONA_OESTE_2", "ZONA_SUL", "BAIXADA_FLUMINENSE", "ZONA_NORTE_1", "ZONA_NORTE_2"]],
  ["REGIAO_SERRANA", "Região Serrana", ["REGI_O_SERRANA_1", "REGI_O_SERRANA_2"]],
  ["COSTA_VERDE", "Costa Verde", ["COSTA_VERDE_1", "COSTA_VERDE_2"]],
  ["VALE_DO_PARAIBA", "Vale do Paraíba", ["VALE_DO_PARAIBA1", "VALE_DO_PARAIBA_2"]],
];
const jitRegions: JustInTimeRegionOption[] = jitRegionGroups.map(([codigo, nome, zoneCodes]) => ({
  codigo,
  nome,
  subzonas: jitZones.filter((zone) => zoneCodes.includes(zone.codigo)),
}));
const jitAllowedZoneCodes = new Set(jitRegions.flatMap((region) => region.subzonas.map((zone) => zone.codigo)));

const additionalNames = [
  "DISTANCIA",
  "MATERIAL GRANDE",
  "ESCADA",
  "RAMPA",
  "SUB SOLO  E DÍCIL ACESSO",
  "SÁBADO",
  "NOTURNO",
  "CAMINHÃO NÃO PARA",
];

const truckOptions = [
  { codigo: "SAVEIRO", nome: "Saveiro" },
  { codigo: "KIA_BONGO", nome: "Kia Bongo" },
  { codigo: "CAMINHAO_3_4", nome: "Caminhão 3/4" },
  { codigo: "CAMINHAO_TOCO", nome: "Caminhão toco" },
];

/** Normaliza os rótulos como o catálogo do backend para comparar cidades e adicionais. */
function normalizeLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** Converte os decimais recebidos do formulário em número finito. */
function numeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Calcula a distância pelas duas leituras, como a validação da API real. */
function odometerDistance(payload: FreightInput): number | null {
  const initial = numeric(payload.km_inicial);
  const final = numeric(payload.km_final);
  if (initial === null || final === null) {
    if (payload.tipo_transporte === "TRANSPORTADORA" && initial === null && final === null) {
      return null;
    }
    throw new Error("Informe as leituras inicial e final do hodômetro.");
  }
  if (final < initial) {
    throw new Error("KM final deve ser igual ou maior que KM inicial.");
  }
  return final - initial;
}

/** Arredonda valores não negativos para centavos, como a calculadora de fretes. */
function money(value: number): number {
  return Math.floor((value + Number.EPSILON) * 100 + 0.5) / 100;
}

/** Serializa os decimais de saída com escala monetária estável. */
function moneyText(value: number): string {
  return money(value).toFixed(2);
}

/** Lê registros locais; dados inválidos são descartados sem chamar a API real. */
function readArray<T>(key: string, isItem: (value: unknown) => value is T): T[] {
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return [];
  }
}

/** Confere a estrutura mínima antes de reutilizar um frete salvo localmente. */
function isFreight(value: unknown): value is FreightResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FreightResponse>;
  return typeof item.id_frete === "number"
    && typeof item.codigo_frete === "string"
    && typeof item.data_servico === "string"
    && typeof item.status_calculo === "string";
}

function readFreights(): FreightResponse[] {
  return readArray(FREIGHTS_KEY, isFreight).map((item) => {
    const reason = (item.motivo_pendencia ?? "")
      .replace("R$ AVARIA maior que R$ FRETE; confira o valor líquido histórico.", " ")
      .replace(/\s+/g, " ")
      .trim();
    const legacyAvariaOnly = item.status_calculo === "PENDENTE_CONFERENCIA"
      && Boolean(item.motivo_pendencia)
      && !reason;
    const status = legacyAvariaOnly ? "CALCULADO" : item.status_calculo;
    return {
      ...item,
      tipo_transporte: item.tipo_transporte ?? "AGREGADO",
      id_motorista_agregado: item.id_motorista_agregado ?? null,
      id_motorista_transportadora: item.id_motorista_transportadora ?? null,
      nome_motorista_transportadora: item.nome_motorista_transportadora ?? null,
      rota_cidade: item.rota_cidade ?? null,
      quantidade_entregas: item.quantidade_entregas ?? null,
      peso_kg: item.peso_kg ?? null,
      quantidade_avarias: item.quantidade_avarias ?? 0,
      cancelado: item.cancelado ?? false,
      cancelado_em: item.cancelado_em ?? null,
      cancelado_por: item.cancelado_por ?? null,
      justificativa_cancelamento: item.justificativa_cancelamento ?? null,
      nome_transportador: item.nome_transportador === "Agregados" && item.tipo_transporte === "AGREGADO"
        ? null
        : item.nome_transportador ?? null,
      codigo_fonte_tarifa: item.tipo_transporte === "PROPRIO" ? null : item.codigo_fonte_tarifa ?? "AGREGADOS_CD",
      status_calculo: status,
      motivo_pendencia: reason || null,
      detalhe_calculo: legacyAvariaOnly
        ? { ...item.detalhe_calculo, status, motivo: null }
        : item.detalhe_calculo,
    };
  });
}

function saveFreights(items: FreightResponse[]): void {
  window.localStorage.setItem(FREIGHTS_KEY, JSON.stringify(items));
}

/** Cria uma resposta pendente sem inventar preço quando a regra não resolve a tarifa. */
type FreightTariffQuote = Omit<FreightQuoteResponse, "valor_frete_pago">;

function pendingQuote(reason: string, detail: Record<string, unknown>): FreightTariffQuote {
  return {
    status_calculo: "PENDENTE_CONFERENCIA",
    valor_frete_bruto: null,
    percentual_frete: null,
    motivo_pendencia: reason,
    detalhe_calculo: { ...detail, status: "PENDENTE_CONFERENCIA", motivo: reason },
  };
}

/** Descrições das faixas comuns às zonas JUST IN TIME. */
const jitTierPatterns: Record<string, Array<[number, number]>> = {
  metroA: [[1, 50], [51, 100], [100, 250], [251, 500], [500, 1000], [1001, 2000], [2001, 3500], [3500, 5000], [5001, 7000], [7001, 12000]],
  metroB: [[1, 50], [51, 100], [100, 250], [250, 500], [500, 1000], [1001, 2000], [2001, 3500], [3500, 5000], [5001, 7000], [7001, 12000]],
  regional: [[1, 100], [100, 250], [250, 500], [500, 1000], [1001, 2000], [2001, 3500], [3500, 5000], [5001, 7000], [7001, 12000]],
};

/** Tarifas por faixa lidas do retrato JSON que acompanha as planilhas. */
const jitPrices: Record<string, number[]> = {
  ZONA_OESTE_1: [90, 120, 170, 243.23, 395.25, 532.08, 653.7, 881.73, 1079.36, 1520.21],
  ZONA_OESTE_2: [90, 120, 170, 285.87, 435.93, 604.44, 808.97, 1078.07, 1296.94, 1676.64],
  ZONA_SUL: [90, 120, 170, 250.84, 398, 602.01, 819.4, 1070.23, 1337.79, 1672.23],
  BAIXADA_FLUMINENSE: [90, 120, 170, 250.84, 401.34, 635.46, 819.4, 1086.95, 1321.08, 1839.46],
  ZONA_NORTE_1: [90, 120, 170, 267.55, 384.63, 585.29, 819.4, 1086.95, 1220.74, 1655.52],
  ZONA_NORTE_2: [90, 120, 170, 267.55, 418.07, 585.29, 836.12, 1107.8, 1237.46, 1672.23],
  NORTE_FLUMINENSE: [930.11, 987.49, 1009.26, 1208.14, 1302.14, 1602.94, 1884.93, 2354.94, 2918.93],
  NOROESTE_FLUMINENSE: [930.11, 987.49, 1009.26, 1208.14, 1302.14, 1602.94, 1884.93, 2354.94, 2918.93],
  REGI_O_SERRANA_1: [632.86, 704.23, 780.36, 886.01, 1247.64, 1446.53, 1735.84, 1988.99, 2706.76],
  REGI_O_SERRANA_2: [632.86, 704.23, 761.33, 886.01, 1066.82, 1410.37, 1772, 2169.79, 2712.25],
  NITEROI_1: [250.47, 306.13, 375.71, 425.67, 577.68, 836.12, 1048.95, 1216.17, 1520.22],
  NITEROI_2: [264.39, 333.96, 389.62, 456.06, 608.09, 760.11, 988.15, 1216.17, 1976.28],
  REGI_O_DOS_LAGOS_1: [756.61, 799.4, 837.46, 890.76, 1107.74, 1523.62, 1704.44, 1903.33, 2445.78],
  REGI_O_DOS_LAGOS_2: [806.1, 828.95, 844.92, 904.59, 1127.62, 1534.27, 1716.35, 1916.64, 2462.88],
  COSTA_VERDE_1: [658.63, 678.23, 705.67, 839.49, 1182.13, 1370.57, 1678.95, 1884.53, 2484.17],
  COSTA_VERDE_2: [696.89, 758.99, 834.89, 942.1, 1140.38, 1446.84, 1663.15, 1825.36, 2546.41],
  VALE_DO_PARAIBA1: [720.34, 763.33, 790.61, 705.7, 1122.67, 1339.67, 1556.63, 1712.54, 2224.26],
  VALE_DO_PARAIBA_2: [755.48, 776.56, 790.61, 922.38, 1039.23, 1423.1, 1690.15, 1923.82, 2574.77],
};

/** Formata os limites iguais aos rótulos que aparecem nas planilhas. */
function jitWeightLabel(min: number, max: number): string {
  const format = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
  return `${format(min)} até ${format(max)}`;
}

/** Retorna as faixas e preços de uma zona para conferir o peso do lançamento. */
function jitTiers(code: string): Array<{ min: number; max: number; label: string; price: number }> {
  const pattern = code === "ZONA_OESTE_1"
    ? jitTierPatterns.metroA
    : ["ZONA_OESTE_2", "ZONA_SUL", "BAIXADA_FLUMINENSE", "ZONA_NORTE_1", "ZONA_NORTE_2"].includes(code)
      ? jitTierPatterns.metroB
      : jitTierPatterns.regional;
  return (jitPrices[code] ?? []).map((price, index) => {
    const [min, max] = pattern[index];
    return { min, max, label: jitWeightLabel(min, max), price };
  });
}

const additionWeightBands: Array<[number, number]> = [
  [0, 500], [500, 1000], [1500, 2000], [2000, 2500], [3000, 3500], [4000, 4500], [5000, 5500],
  [6000, 6500], [7000, 7500], [8000, 8500], [9000, 9500], [10000, 10500], [11000, 11500], [12000, 12000],
];

/** Calcula a tarifa JIT para uma zona e sinaliza conferência quando há várias. */
function quoteJustInTime(payload: FreightInput): FreightTariffQuote {
  const zoneCodes = payload.codigos_zonas_jit?.length
    ? payload.codigos_zonas_jit
    : payload.codigo_zona_jit ? [payload.codigo_zona_jit] : [];
  const selectedZones = zoneCodes.map((code) => jitZones.find((item) =>
    item.codigo === code && jitAllowedZoneCodes.has(item.codigo),
  ));
  if (!zoneCodes.length || selectedZones.some((zone) => !zone)) {
    return pendingQuote("Selecione pelo menos uma zona válida da tabela JUST IN TIME.", {});
  }

  const zones = selectedZones.filter((zone): zone is JustInTimeZoneOption => Boolean(zone));
  const zoneDetails = zones.map((zone) => ({ codigo: zone.codigo, nome: zone.nome, areas: zone.areas }));
  const detail: Record<string, unknown> = {
    zona: zones.length === 1 ? zones[0].nome : zones.map((zone) => zone.nome),
    codigos_zonas_jit: zones.map((zone) => zone.codigo),
    zonas_jit: zoneDetails,
    peso_kg: String(payload.peso_kg),
    fonte_tarifa: "JUST_IN_TIME",
    ...(zones.length === 1 ? { areas_da_zona: zones[0].areas } : {}),
  };
  if (zones.length > 1) {
    return pendingQuote(
      "A tabela JUST IN TIME não define uma tarifa única para múltiplas zonas; confira o valor do frete.",
      detail,
    );
  }

  const weight = numeric(payload.peso_kg) ?? 0;
  const zone = zones[0];
  const tiers = jitTiers(zone.codigo);
  const matches = tiers.filter((tier) => tier.min <= weight && weight <= tier.max);
  if (matches.length !== 1) {
    return pendingQuote(
      "A faixa de peso não tem um único valor aplicável na tabela JUST IN TIME.",
      { ...detail, faixas_correspondentes: matches.map((item) => item.label) },
    );
  }

  const selectedAdditions = payload.adicionais_jit ?? [];
  if (selectedAdditions.length > 1) {
    return pendingQuote(
      "A tabela JUST IN TIME pede negociação quando mais de um adicional ocorre no mesmo local.",
      { ...detail, adicionais: selectedAdditions },
    );
  }

  let additionValue = 0;
  let additionName: string | null = null;
  if (selectedAdditions.length === 1) {
    const bandMatches = additionWeightBands
      .map(([min, max], index) => ({ min, max, index, label: jitWeightLabel(min, max) }))
      .filter((band) => band.min <= weight && weight <= band.max);
    if (bandMatches.length !== 1) {
      return pendingQuote(
        "O adicional selecionado não tem uma única faixa de peso aplicável.",
        { ...detail, faixas_adicional: bandMatches.map((item) => item.label) },
      );
    }
    const code = selectedAdditions[0];
    const label = additionalNames.find((item) => normalizeLabel(item).replace(/ /g, "_") === code);
    if (!label) return pendingQuote("O adicional selecionado não tem uma tarifa preenchida.", detail);
    additionName = label;
    const base = 120 + bandMatches[0].index * 50;
    const normalized = normalizeLabel(label);
    additionValue = normalized === "MATERIAL GRANDE"
      ? base + 30
      : normalized === "SABADO" || normalized === "NOTURNO"
        ? base + 100
        : base;
  }

  const gross = money(matches[0].price + additionValue);
  return {
    status_calculo: "CALCULADO",
    valor_frete_bruto: moneyText(gross),
    percentual_frete: null,
    motivo_pendencia: null,
    detalhe_calculo: {
      ...detail,
      status: "CALCULADO",
      formula: "frete_base_da_zona_e_faixa + um_adicional_selecionado",
      faixa_peso: matches[0].label,
      frete_base: moneyText(matches[0].price),
      adicional: { nome: additionName, valor: moneyText(additionValue) },
      armazenamento: "fora do cálculo do controle de fretes; valores variáveis não preenchidos",
    },
  };
}

/** Calcula a fórmula percentual, por quilo e por quilômetro dos Agregados CD. */
function quoteAggregates(payload: FreightInput): FreightTariffQuote {
  const route = normalizeLabel(payload.rota_cidade);
  const routeSheets: Record<string, string> = {
    "RIO DAS OSTRAS": "RO",
    MACAE: "MC",
    "MACAE SERRA": "MC S",
    "CABO FRIO": "CF",
    BUZIOS: "CF",
    "ARMACAO DOS BUZIOS": "CF",
    "ARMACAO DE BUZIOS": "CF",
    "SAO PEDRO DA ALDEIA": "CF",
    "ARRAIAL DO CABO": "CF",
    ARARUAMA: "AR",
    CAMPOS: "CP",
    "CAMPOS DOS GOYTACAZES": "CP",
  };
  const sheet = routeSheets[route];
  if (!sheet) {
    return pendingQuote("A rota ainda não está associada a uma aba de tarifa Agregados CD.", {
      rota_cidade: payload.rota_cidade,
      fonte_tarifa: "AGREGADOS_CD",
    });
  }

  const km = odometerDistance(payload);
  if (km === null) {
    return pendingQuote("Informe o hodômetro para calcular a tarifa Agregados CD.", {
      fonte_tarifa: "AGREGADOS_CD",
    });
  }
  const invoice = numeric(payload.valor_nota);
  const weight = numeric(payload.peso_kg) ?? 0;
  if (invoice === null) {
    return pendingQuote("Informe o valor da nota para calcular a tarifa Agregados CD.", {
      aba_tarifa: sheet,
      fonte_tarifa: "AGREGADOS_CD",
    });
  }

  // RO e MC seguem os 1,17% usados pelas fórmulas do simulador.
  const rates: Record<string, { percent: number; perKm: number; perKg: number }> = {
    RO: { percent: 0.0117, perKm: 6.32, perKg: 0.06 },
    MC: { percent: 0.0117, perKm: 3.56, perKg: 0.06 },
    "MC S": { percent: 0.012, perKm: 3.75, perKg: 0.07 },
    CF: { percent: 0.012, perKm: 3.75, perKg: 0.07 },
    AR: { percent: 0.012, perKm: 3.85, perKg: 0.08 },
    CP: { percent: 0.012, perKm: 3.95, perKg: 0.08 },
  };
  const selected = rates[sheet];
  const invoiceComponent = invoice * selected.percent;
  const weightComponent = weight * selected.perKg;
  const distanceComponent = km * selected.perKm;
  const gross = money(invoiceComponent + weightComponent + distanceComponent);
  const ratio = invoice === 0 ? null : (Math.floor((gross / invoice + Number.EPSILON) * 1_000_000 + 0.5) / 1_000_000).toFixed(6);

  return {
    status_calculo: "CALCULADO",
    valor_frete_bruto: moneyText(gross),
    percentual_frete: ratio,
    motivo_pendencia: null,
    detalhe_calculo: {
      fonte_tarifa: "AGREGADOS_CD",
      status: "CALCULADO",
      aba_tarifa: sheet,
      formula: "(valor_nota × percentual) + (peso_kg × valor_por_kg) + (km_rodado × valor_por_km)",
      parametros: {
        percentual_nota: String(selected.percent),
        valor_por_km: String(selected.perKm),
        valor_por_kg: String(selected.perKg),
        frete_minimo: null,
      },
      componentes: {
        nota: moneyText(invoiceComponent),
        peso: moneyText(weightComponent),
        distancia: moneyText(distanceComponent),
      },
    },
  };
}

/** Seleciona o valor fixo por veículo Paulo Cruz e o eventual carro de apoio. */
function quotePauloCruz(payload: FreightInput): FreightTariffQuote {
  const vehicles: Record<string, { name: string; price: number; bounds: [number, number] | null; label: string }> = {
    SAVEIRO: { name: "Saveiro", price: 300, bounds: null, label: "Carro de apoio" },
    KIA_BONGO: { name: "Kia Bongo", price: 500, bounds: null, label: "Carro de apoio" },
    CAMINHAO_3_4: { name: "Caminhão 3/4", price: 950, bounds: [1500, 4000], label: "1.500 a 4.000 kg" },
    CAMINHAO_TOCO: { name: "Caminhão toco", price: 1100, bounds: [4001, 9000], label: "4.001 a 9.000 kg" },
  };
  const vehicle = payload.tipo_caminhao ? vehicles[payload.tipo_caminhao] : undefined;
  if (!vehicle) return pendingQuote("Selecione um tipo de caminhão da tabela Paulo Cruz.", {});

  const supportPrice = payload.carro_apoio === "SAVEIRO" ? 300 : payload.carro_apoio === "KIA_BONGO" ? 500 : 0;
  return {
    status_calculo: "CALCULADO",
    valor_frete_bruto: moneyText(vehicle.price + supportPrice),
    percentual_frete: null,
    motivo_pendencia: null,
    detalhe_calculo: {
      fonte_tarifa: "PAULO_CRUZ",
      status: "CALCULADO",
      tipo_caminhao: payload.tipo_caminhao,
      carro_apoio: payload.carro_apoio ?? null,
      valor_carro_apoio: moneyText(supportPrice),
      formula: "frete_fixo_por_tipo_de_caminhao + carro_de_apoio",
      faixa_de_peso: vehicle.label,
      valor_fixo: moneyText(vehicle.price),
    },
  };
}

/** Executa a cotação conforme a fonte tarifária escolhida. */
function calculateQuote(payload: FreightInput): FreightQuoteResponse {
  // Somente transporte independente dispensa leituras do hodômetro.
  if (payload.tipo_transporte !== "TRANSPORTADORA") odometerDistance(payload);
  if (!payload.codigo_fonte_tarifa) {
    return { ...pendingQuote("Selecione uma fonte tarifária para este transporte terceirizado.", {
      tipo_transporte: payload.tipo_transporte,
    }), valor_frete_pago: null };
  }
  let quote = payload.codigo_fonte_tarifa === "AGREGADOS_CD"
    ? quoteAggregates(payload)
    : payload.codigo_fonte_tarifa === "JUST_IN_TIME"
      ? quoteJustInTime(payload)
      : quotePauloCruz(payload);

  const manualGross = numeric(payload.valor_frete_bruto);
  if (manualGross !== null) {
    const tariffGross = numeric(quote.valor_frete_bruto);
    if (quote.status_calculo !== "CALCULADO" || tariffGross === null || money(tariffGross) !== money(manualGross)) {
      quote = {
        status_calculo: "CALCULADO",
        valor_frete_bruto: moneyText(manualGross),
        percentual_frete: null,
        motivo_pendencia: null,
        detalhe_calculo: {
          ...quote.detalhe_calculo,
          status: "CALCULADO",
          motivo: null,
          formula: "valor_bruto_conferido_e_informado_pelo_gestor",
          valor_frete_bruto_informado_manualmente: true,
          valor_frete_bruto_tarifado: tariffGross === null ? null : moneyText(tariffGross),
          motivo_calculo_tarifario: quote.motivo_pendencia,
        },
      };
    }
  }

  const invoice = numeric(payload.valor_nota);
  const gross = numeric(quote.valor_frete_bruto);
  if (quote.status_calculo === "CALCULADO" && quote.percentual_frete === null && invoice && gross !== null) {
    const ratio = (Math.floor((gross / invoice + Number.EPSILON) * 1_000_000 + 0.5) / 1_000_000).toFixed(6);
    quote = {
      ...quote,
      percentual_frete: ratio,
      detalhe_calculo: { ...quote.detalhe_calculo, percentual_frete: ratio },
    };
  }
  quote = { ...quote, detalhe_calculo: { ...quote.detalhe_calculo, nome_cliente: payload.nome_cliente ?? null, codigo_cliente: payload.codigo_cliente ?? null, observacao: payload.observacao ?? null } };
  const finalGross = numeric(quote.valor_frete_bruto);
  const damage = numeric(payload.valor_avaria) ?? 0;
  const net = finalGross === null ? null : money(finalGross - damage);
  return {
    ...quote,
    valor_frete_pago: net === null ? null : moneyText(net),
  };
}

/** Cria valores coerentes com as datas textuais enviadas pela API. */
function dateInRange(value: string, from?: string, to?: string): boolean {
  return (!from || value >= from) && (!to || value <= to);
}

/** Gera as opções para os formulários de demonstração. */
function options(): FreightTariffOptions {
  return {
    fontes: tariffSources,
    rotas_agregados_cd: aggregateRoutes,
    zonas_just_in_time: jitRegions,
    adicionais_just_in_time: additionalNames.map((nome) => ({
      codigo: normalizeLabel(nome).replace(/ /g, "_"),
      nome,
    })),
    tipos_caminhao_paulo_cruz: truckOptions,
    retrato_tarifas_em: "2026-10-29",
    hash_retrato_tarifas: "DEMO",
  };
}

/** Valida as datas antes de filtrar ou consolidar lançamentos. */
function ensureValidPeriod(filters: FreightPaymentFilters): void {
  if (filters.data_de > filters.data_ate) {
    throw new Error("A data inicial deve ser anterior à data final.");
  }
  if (filters.sem_identificacao && filters.tipo_transporte !== "AGREGADO") {
    throw new Error("A opção sem identificação só se aplica aos agregados.");
  }
  if (filters.sem_identificacao && filters.nome_transportador) {
    throw new Error("Escolha um nome ou a opção sem identificação, não ambos.");
  }
}

function paymentRecords(filters: FreightPaymentFilters): FreightResponse[] {
  return readFreights()
    .filter((item) => !item.cancelado)
    .filter((item) => item.tipo_transporte === filters.tipo_transporte)
    .filter((item) => dateInRange(item.data_servico, filters.data_de, filters.data_ate))
    .filter((item) => filters.sem_identificacao
      ? item.nome_transportador === null
      : !filters.nome_transportador || item.nome_transportador === filters.nome_transportador);
}

function demoPaymentAmount(item: FreightResponse): number | null {
  const importedNet = numeric(item.valor_frete_pago);
  if (importedNet !== null) return importedNet;
  const gross = numeric(item.valor_frete_bruto);
  const damage = numeric(item.valor_avaria) ?? 0;
  return gross === null ? null : gross - damage;
}

function demoPaymentReady(item: FreightResponse): boolean {
  if (demoPaymentAmount(item) === null) return false;
  if (item.status_calculo === "CALCULADO") return true;
  const source = item.detalhe_calculo.importacao_planilha;
  if (typeof source !== "object" || source === null) return false;
  const imported = source as Record<string, unknown>;
  return Boolean(item.nome_transportador?.trim())
    && imported.tipo_transporte_identificado !== false
    && !(item.tipo_transporte === "AGREGADO" && imported.vinculo_responsavel_status === "AMBIGUO");
}

function demoPaymentWarning(item: FreightResponse) {
  const source = item.detalhe_calculo.importacao_planilha;
  if (!demoPaymentReady(item) || typeof source !== "object" || source === null) return null;
  const missing: string[] = [];
  if (item.valor_frete_bruto === null) missing.push("frete bruto");
  if (item.codigo_fonte_tarifa === "AGREGADOS_CD") {
    if (!item.rota_cidade) missing.push("rota/cidade");
    if (item.peso_kg === null) missing.push("peso");
    if (item.valor_nota === null) missing.push("valor da nota");
    if (item.km_rodado === null) missing.push("KM rodado");
  } else if (item.codigo_fonte_tarifa === "JUST_IN_TIME") {
    if (!item.codigo_zona_jit && !item.codigos_zonas_jit?.length) missing.push("zona JUST IN TIME");
    if (item.peso_kg === null) missing.push("peso");
  } else if (item.codigo_fonte_tarifa === "PAULO_CRUZ" && !item.tipo_caminhao) {
    missing.push("tipo de caminhão");
  }
  if (!missing.length) return null;
  return {
    codigo_frete: item.codigo_frete,
    data_servico: item.data_servico,
    nome_transportador: item.nome_transportador,
    rota_cidade: item.rota_cidade,
    campos_ausentes: missing,
    motivo_aviso: "Os valores históricos foram preservados. Estes campos só são necessários para auditar ou recalcular a tarifa; o aviso não bloqueia a exportação.",
  };
}

/** Operações locais usadas somente quando VITE_DEMO_MODE estiver ativo. */
export const freightsDemoApi = {
  async tariffOptions(): Promise<FreightTariffOptions> {
    await pause();
    return options();
  },

  async aggregateDrivers(_dataServico: string): Promise<FreightAggregateDriverOption[]> {
    await pause();
    return [{ id_motorista: 501, nome_motorista: "João da Silva" }];
  },

  async carrierDrivers(_dataServico: string): Promise<FreightCarrierDriverOption[]> {
    await pause();
    return carrierDriverExamples;
  },

  async historicalEditDrivers(_dataServico: string): Promise<HistoricalFreightEditDriverOption[]> {
    await pause();
    return [
      {
        id_motorista: 501,
        nome_motorista: "João da Silva",
        tipo_transporte: "AGREGADO",
        codigo_transportadora: null,
        nome_transportadora: null,
      },
      ...carrierDriverExamples.map((driver) => ({
        ...driver,
        tipo_transporte: "TRANSPORTADORA" as const,
      })),
    ];
  },

  async deliverySummary(
    dataServico: string,
    idMotorista: number,
  ): Promise<FreightDeliverySummary> {
    await pause();
    const registered = idMotorista === 501 || carrierDriverExamples.some((driver) => driver.id_motorista === idMotorista);
    if (!registered) throw new Error("Motorista não encontrado no cadastro.");
    return {
      id_motorista: idMotorista,
      data_servico: dataServico,
      rota_cidade: "Macaé",
      cidades: ["Macaé"],
      quantidade_entregas: 18,
      quantidade_avarias: 2,
      quantidade_registros: 1,
      peso_total_kg: "2250.000",
    };
  },

  async quote(payload: FreightInput): Promise<FreightQuoteResponse> {
    await pause();
    return calculateQuote(payload);
  },

  async create(payload: FreightInput): Promise<FreightResponse> {
    await pause();
    const quote = calculateQuote(payload);
    const gross = numeric(quote.valor_frete_bruto);
    const damage = numeric(payload.valor_avaria) ?? 0;
    const kmInitial = numeric(payload.km_inicial);
    const kmFinal = numeric(payload.km_final);
    const kmRun = odometerDistance(payload);
    const current = readFreights();
    const record: FreightResponse = {
      id_frete: Math.max(0, ...current.map((item) => item.id_frete)) + 1,
      codigo_frete: crypto.randomUUID(),
      tipo_transporte: payload.tipo_transporte,
      nome_transportador: payload.nome_transportador,
      id_motorista_agregado: payload.id_motorista_agregado,
      id_motorista_transportadora: payload.id_motorista_transportadora,
      nome_motorista_transportadora: carrierDriverName(payload.id_motorista_transportadora),
      codigo_fonte_tarifa: payload.codigo_fonte_tarifa,
      data_servico: payload.data_servico,
      rota_cidade: payload.rota_cidade,
      km_inicial: kmInitial === null ? null : String(kmInitial),
      km_final: kmFinal === null ? null : String(kmFinal),
      km_rodado: kmRun === null ? null : String(kmRun),
      quantidade_entregas: payload.quantidade_entregas,
      peso_kg: String(numeric(payload.peso_kg) ?? 0),
      valor_nota: numeric(payload.valor_nota) === null ? null : String(numeric(payload.valor_nota)),
      tipo_caminhao: payload.tipo_caminhao ?? null,
      carro_apoio: payload.carro_apoio ?? null,
      nome_cliente: payload.nome_cliente ?? null,
      codigo_cliente: payload.codigo_cliente ?? null,
      observacao: payload.observacao ?? null,
      codigo_zona_jit: payload.codigo_zona_jit ?? payload.codigos_zonas_jit?.[0] ?? null,
      codigos_zonas_jit: payload.codigos_zonas_jit ?? (payload.codigo_zona_jit ? [payload.codigo_zona_jit] : []),
      adicionais_jit: payload.adicionais_jit ?? [],
      valor_frete_bruto: gross === null ? null : moneyText(gross),
      valor_avaria: moneyText(damage),
      quantidade_avarias: payload.quantidade_avarias,
      valor_frete_pago: gross === null ? null : moneyText(gross - damage),
      percentual_frete: quote.percentual_frete,
      status_calculo: quote.status_calculo,
      motivo_pendencia: quote.motivo_pendencia,
      detalhe_calculo: quote.detalhe_calculo,
      criado_por: 7,
      criado_em: new Date().toISOString(),
      cancelado: false,
      cancelado_em: null,
      cancelado_por: null,
      justificativa_cancelamento: null,
    };
    saveFreights([record, ...current]);
    return record;
  },

  async importHistorical(payload: HistoricalFreightImportRequest): Promise<HistoricalFreightImportResponse> {
    await pause();
    const current = readFreights();
    const additions: FreightResponse[] = [];
    let alreadyExists = 0;
    let updatedCount = 0;
    let matchedAggregates = 0;
    let matchedCarriers = 0;
    let unmatched = 0;
    for (const imported of payload.itens) {
      const fingerprint = JSON.stringify(imported);
      const previousIndex = current.findIndex((item) => {
        const source = item.detalhe_calculo.importacao_planilha;
        return typeof source === "object" && source !== null &&
          "arquivo" in source && source.arquivo === payload.nome_arquivo &&
          "aba" in source && source.aba === payload.aba_origem &&
          "linha" in source && source.linha === imported.linha_planilha;
      });
      const previous = previousIndex >= 0 ? current[previousIndex] : undefined;
      const previousSource = previous?.detalhe_calculo.importacao_planilha;
      if (previous && typeof previousSource === "object" && previousSource !== null &&
        "fingerprint" in previousSource && previousSource.fingerprint === fingerprint) {
        alreadyExists += 1;
        continue;
      }

      const gross = numeric(imported.valor_frete_bruto);
      const normalizedName = imported.nome_transportador ? normalizeLabel(imported.nome_transportador) : "";
      const aggregateDriver = normalizedName === normalizeLabel("João da Silva")
        ? { id: 501, name: "João da Silva" }
        : null;
      const directCarrierDriver = carrierDriverExamples.find((driver) => normalizeLabel(driver.nome_motorista) === normalizedName);
      const carrierAlias = ({
        [normalizeLabel("JUST IN TIME")]: "JUST_IN_TIME",
        [normalizeLabel("JUST IN TIME 1")]: "JUST_IN_TIME",
        [normalizeLabel("JUSTI IN TIME")]: "JUST_IN_TIME",
        [normalizeLabel("PAULO CRUZ")]: "PAULO_CRUZ",
      } as Record<string, string>)[normalizedName];
      const carrierMatches = carrierAlias
        ? carrierDriverExamples.filter((driver) => driver.codigo_transportadora === carrierAlias)
        : [];
      const carrierDriver = directCarrierDriver ?? (carrierMatches.length === 1 ? carrierMatches[0] : undefined);
      const isLinked = Boolean(aggregateDriver || carrierDriver);
      if (aggregateDriver) matchedAggregates += 1;
      else if (carrierDriver) matchedCarriers += 1;
      else unmatched += 1;
      const resolutionImproved = Boolean(isLinked && previous?.detalhe_calculo.importacao_planilha &&
        typeof previous.detalhe_calculo.importacao_planilha === "object" &&
        "responsavel_vinculado_ao_cadastro" in previous.detalhe_calculo.importacao_planilha &&
        previous.detalhe_calculo.importacao_planilha.responsavel_vinculado_ao_cadastro === false);
      if (previous && (previous.cancelado || previous.status_calculo !== "PENDENTE_CONFERENCIA" ||
        (previous.valor_frete_bruto !== null && !resolutionImproved) || (gross === null && !resolutionImproved))) {
        throw new Error("A linha já foi importada com outros dados.");
      }
      const damage = numeric(imported.valor_avaria) ?? 0;
      const invoice = numeric(imported.valor_nota);
      const ratio = imported.percentual_frete ?? (gross !== null && invoice !== null && invoice > 0
        ? String(gross / invoice)
        : null);
      const paid = numeric(imported.valor_frete_pago) ?? (gross !== null ? gross - damage : null);
      const pendingReasons = [
        ...(gross === null ? ["Valor do frete bruto ausente na planilha importada."] : []),
        ...(!isLinked ? ["Responsável não encontrado no cadastro de demonstração."] : []),
      ];
      const source: Record<string, unknown> = {
        arquivo: payload.nome_arquivo,
        sha256_arquivo: payload.sha256_arquivo,
        aba: payload.aba_origem,
        linha: imported.linha_planilha,
        fingerprint,
        transportador_planilha: imported.nome_transportador,
        vinculo_responsavel_status: isLinked ? "VINCULADO" : "NAO_ENCONTRADO",
        responsavel_vinculado_ao_cadastro: isLinked,
        tipo_transporte_identificado: isLinked,
        quantidade_avarias_informada: false,
        valor_frete_pago_planilha: imported.valor_frete_pago,
        percentual_frete_planilha: imported.percentual_frete_planilha,
        percentual_frete_importado: ratio,
        km_inicial_planilha: imported.km_inicial,
        km_final_planilha: imported.km_final,
        km_rodado_planilha: imported.km_rodado,
      };
      const transportType = carrierDriver ? "TRANSPORTADORA" : "AGREGADO";
      const transportName = carrierDriver?.nome_transportadora ?? aggregateDriver?.name ?? imported.nome_transportador;
      const operationalKm = carrierDriver ? [null, null, null] : [imported.km_inicial, imported.km_final, imported.km_rodado];
      const freight: FreightResponse = {
        id_frete: previous?.id_frete ?? Math.max(0, ...current.map((item) => item.id_frete), ...additions.map((item) => item.id_frete)) + 1,
        codigo_frete: previous?.codigo_frete ?? crypto.randomUUID(),
        tipo_transporte: transportType,
        nome_transportador: transportName,
        id_motorista_agregado: aggregateDriver?.id ?? null,
        id_motorista_transportadora: carrierDriver?.id_motorista ?? null,
        nome_motorista_transportadora: carrierDriver?.nome_motorista ?? null,
        codigo_fonte_tarifa: carrierDriver?.codigo_transportadora ?? "AGREGADOS_CD",
        data_servico: imported.data_servico,
        rota_cidade: imported.rota_cidade,
        km_inicial: operationalKm[0],
        km_final: operationalKm[1],
        km_rodado: operationalKm[2],
        quantidade_entregas: imported.quantidade_entregas,
        peso_kg: imported.peso_kg === null ? null : String(imported.peso_kg),
        valor_nota: imported.valor_nota,
        tipo_caminhao: null,
        codigo_zona_jit: null,
        codigos_zonas_jit: [],
        adicionais_jit: [],
        valor_frete_bruto: gross === null ? null : moneyText(gross),
        valor_avaria: moneyText(damage),
        quantidade_avarias: 0,
        valor_frete_pago: paid === null ? null : moneyText(paid),
        percentual_frete: ratio,
        status_calculo: pendingReasons.length ? "PENDENTE_CONFERENCIA" : "CALCULADO",
        motivo_pendencia: pendingReasons.length ? pendingReasons.join(" ") : null,
        detalhe_calculo: {
          metodo_calculo: "VALOR_HISTORICO_IMPORTADO",
          importacao_planilha: source,
        },
        criado_por: previous?.criado_por ?? 7,
        criado_em: previous?.criado_em ?? new Date().toISOString(),
        cancelado: previous?.cancelado ?? false,
        cancelado_em: previous?.cancelado_em ?? null,
        cancelado_por: previous?.cancelado_por ?? null,
        justificativa_cancelamento: previous?.justificativa_cancelamento ?? null,
      };
      if (previousIndex >= 0) {
        current[previousIndex] = freight;
        updatedCount += 1;
      } else {
        additions.push(freight);
      }
    }
    if (additions.length || updatedCount) saveFreights([...additions, ...current]);
    return {
      importados: additions.length,
      atualizados: updatedCount,
      ja_existentes: alreadyExists,
      vinculados_agregados: matchedAggregates,
      vinculados_transportadoras: matchedCarriers,
      sem_vinculo: unmatched,
    };
  },

  async get(codigoFrete: string): Promise<FreightResponse> {
    await pause();
    const freight = readFreights().find((item) => item.codigo_frete === codigoFrete);
    if (!freight) throw new Error("Lançamento de frete não encontrado.");
    return freight;
  },

  async update(codigoFrete: string, payload: FreightInput): Promise<FreightResponse> {
    await pause();
    const current = readFreights();
    const existing = current.find((item) => item.codigo_frete === codigoFrete);
    if (!existing) throw new Error("Lançamento de frete não encontrado.");
    if (existing.cancelado) throw new Error("Um frete cancelado não pode ser editado.");

    const effectivePayload = (
      payload.codigo_fonte_tarifa === "PAULO_CRUZ"
      && payload.valor_frete_bruto != null
      && existing.valor_frete_bruto != null
      && numeric(payload.valor_frete_bruto) === numeric(existing.valor_frete_bruto)
      && (
        (payload.carro_apoio ?? null) !== (existing.carro_apoio ?? null)
        || (payload.tipo_caminhao ?? null) !== (existing.tipo_caminhao ?? null)
      )
    )
      ? { ...payload, valor_frete_bruto: null }
      : payload;
    const quote = calculateQuote(effectivePayload);
    const gross = numeric(quote.valor_frete_bruto);
    const damage = numeric(payload.valor_avaria) ?? 0;
    const kmRun = odometerDistance(payload);
    const updated: FreightResponse = {
      ...existing,
      tipo_transporte: payload.tipo_transporte,
      nome_transportador: payload.nome_transportador,
      id_motorista_agregado: payload.id_motorista_agregado,
      id_motorista_transportadora: payload.id_motorista_transportadora,
      nome_motorista_transportadora: carrierDriverName(payload.id_motorista_transportadora),
      codigo_fonte_tarifa: payload.codigo_fonte_tarifa,
      data_servico: payload.data_servico,
      rota_cidade: payload.rota_cidade,
      km_inicial: numeric(payload.km_inicial) === null ? null : String(numeric(payload.km_inicial)),
      km_final: numeric(payload.km_final) === null ? null : String(numeric(payload.km_final)),
      km_rodado: kmRun === null ? null : String(kmRun),
      quantidade_entregas: payload.quantidade_entregas,
      peso_kg: String(numeric(payload.peso_kg) ?? 0),
      valor_nota: numeric(payload.valor_nota) === null ? null : String(numeric(payload.valor_nota)),
      tipo_caminhao: payload.tipo_caminhao ?? null,
      carro_apoio: payload.carro_apoio ?? null,
      nome_cliente: payload.nome_cliente ?? null,
      codigo_cliente: payload.codigo_cliente ?? null,
      observacao: payload.observacao ?? null,
      codigo_zona_jit: payload.codigo_zona_jit ?? payload.codigos_zonas_jit?.[0] ?? null,
      codigos_zonas_jit: payload.codigos_zonas_jit ?? (payload.codigo_zona_jit ? [payload.codigo_zona_jit] : []),
      adicionais_jit: payload.adicionais_jit ?? [],
      valor_frete_bruto: gross === null ? null : moneyText(gross),
      valor_avaria: moneyText(damage),
      quantidade_avarias: payload.quantidade_avarias,
      valor_frete_pago: gross === null ? null : moneyText(gross - damage),
      percentual_frete: quote.percentual_frete,
      status_calculo: quote.status_calculo,
      motivo_pendencia: quote.motivo_pendencia,
      detalhe_calculo: quote.detalhe_calculo,
      cancelado: false,
      cancelado_em: null,
      cancelado_por: null,
      justificativa_cancelamento: null,
    };
    saveFreights(current.map((item) => item.codigo_frete === codigoFrete ? updated : item));
    return updated;
  },

  async updateHistorical(
    codigoFrete: string,
    payload: HistoricalFreightEditInput,
  ): Promise<FreightResponse> {
    await pause();
    const current = readFreights();
    const existing = current.find((item) => item.codigo_frete === codigoFrete);
    if (!existing) throw new Error("Lançamento de frete não encontrado.");
    if (existing.cancelado) throw new Error("Um frete cancelado não pode ser editado.");
    const source = existing.detalhe_calculo.importacao_planilha;
    if (!source || typeof source !== "object") {
      throw new Error("A edição histórica só está disponível para fretes importados.");
    }
    const savedPayload = { ...payload };

    const name = normalizeLabel(savedPayload.nome_transportador ?? "");
    const aggregateDriver = savedPayload.id_motorista_selecionado === 501
      || name === normalizeLabel("João da Silva")
      ? { id: 501, name: "João da Silva" }
      : null;
    const directCarrier = carrierDriverExamples.find((driver) =>
      driver.id_motorista === savedPayload.id_motorista_selecionado
      || normalizeLabel(driver.nome_motorista) === name,
    );
    const carrierCode = ({
      [normalizeLabel("JUST IN TIME")]: "JUST_IN_TIME",
      [normalizeLabel("JUST IN TIME 1")]: "JUST_IN_TIME",
      [normalizeLabel("JUSTI IN TIME")]: "JUST_IN_TIME",
      [normalizeLabel("PAULO CRUZ")]: "PAULO_CRUZ",
    } as Record<string, "JUST_IN_TIME" | "PAULO_CRUZ">)[name];
    const carrierMatches = carrierCode
      ? carrierDriverExamples.filter((driver) => driver.codigo_transportadora === carrierCode)
      : [];
    const carrierDriver = directCarrier ?? (carrierMatches.length === 1 ? carrierMatches[0] : null);
    const linked = Boolean(aggregateDriver || carrierDriver);
    const isCarrier = Boolean(carrierDriver || carrierCode);
    const type = isCarrier ? "TRANSPORTADORA" : "AGREGADO";
    const transporterName = carrierDriver?.nome_transportadora
      ?? (carrierCode === "JUST_IN_TIME" ? "JUST IN TIME" : carrierCode === "PAULO_CRUZ" ? "Paulo Cruz" : null)
      ?? aggregateDriver?.name
      ?? savedPayload.nome_transportador;
    const tariffCode = carrierDriver?.codigo_transportadora ?? carrierCode;
    let gross = numeric(savedPayload.valor_frete_bruto);
    const damage = numeric(savedPayload.valor_avaria) ?? 0;
    const invoice = numeric(savedPayload.valor_nota);
    const supportPrice = (code: string | null | undefined) => (code === "SAVEIRO" ? 300 : code === "KIA_BONGO" ? 500 : 0);
    const appliedSupport = numeric(existing.detalhe_calculo.valor_carro_apoio as string | number | null | undefined) ?? 0;
    const targetSupport = tariffCode === "PAULO_CRUZ" ? supportPrice(savedPayload.carro_apoio) : 0;
    if (
      tariffCode === "PAULO_CRUZ"
      && gross !== null
      && numeric(existing.valor_frete_bruto) !== null
      && targetSupport !== appliedSupport
      && gross === numeric(existing.valor_frete_bruto)
    ) {
      gross = Math.max(0, money(gross + (targetSupport - appliedSupport)));
      savedPayload.valor_frete_pago = null;
      savedPayload.percentual_frete = null;
    }
    let historicalCalculation: FreightQuoteResponse | null = null;
    if (gross === null && linked) {
      if (
        type === "AGREGADO"
        && aggregateDriver
        && savedPayload.rota_cidade
        && savedPayload.km_rodado !== null
        && numeric(savedPayload.peso_kg) !== null
        && invoice !== null
      ) {
        historicalCalculation = calculateQuote({
          data_servico: savedPayload.data_servico,
          tipo_transporte: "AGREGADO",
          nome_transportador: transporterName,
          id_motorista_agregado: aggregateDriver.id,
          id_motorista_transportadora: null,
          codigo_fonte_tarifa: "AGREGADOS_CD",
          rota_cidade: savedPayload.rota_cidade,
          km_inicial: "0",
          km_final: savedPayload.km_rodado,
          quantidade_entregas: savedPayload.quantidade_entregas ?? 0,
          peso_kg: savedPayload.peso_kg ?? "0",
          valor_nota: savedPayload.valor_nota,
          valor_avaria: moneyText(damage),
          quantidade_avarias: existing.quantidade_avarias,
        });
      } else if (
        type === "TRANSPORTADORA"
        && carrierDriver?.codigo_transportadora === "JUST_IN_TIME"
        && savedPayload.codigo_zona_jit
        && numeric(savedPayload.peso_kg) !== null
      ) {
        historicalCalculation = calculateQuote({
          data_servico: savedPayload.data_servico,
          tipo_transporte: "TRANSPORTADORA",
          nome_transportador: transporterName,
          id_motorista_agregado: null,
          id_motorista_transportadora: carrierDriver.id_motorista,
          codigo_fonte_tarifa: "JUST_IN_TIME",
          rota_cidade: savedPayload.rota_cidade || "JUST IN TIME",
          km_inicial: null,
          km_final: null,
          quantidade_entregas: savedPayload.quantidade_entregas ?? 0,
          peso_kg: savedPayload.peso_kg ?? "0",
          valor_nota: savedPayload.valor_nota,
          valor_avaria: moneyText(damage),
          quantidade_avarias: existing.quantidade_avarias,
          codigo_zona_jit: savedPayload.codigo_zona_jit,
          codigos_zonas_jit: (savedPayload.codigo_zona_jit ? [savedPayload.codigo_zona_jit] : []),
          adicionais_jit: savedPayload.adicionais_jit,
        });
      } else if (
        type === "TRANSPORTADORA"
        && carrierDriver?.codigo_transportadora === "PAULO_CRUZ"
        && savedPayload.tipo_caminhao
      ) {
        historicalCalculation = calculateQuote({
          data_servico: savedPayload.data_servico,
          tipo_transporte: "TRANSPORTADORA",
          nome_transportador: transporterName,
          id_motorista_agregado: null,
          id_motorista_transportadora: carrierDriver.id_motorista,
          codigo_fonte_tarifa: "PAULO_CRUZ",
          rota_cidade: savedPayload.rota_cidade || "Paulo Cruz",
          km_inicial: null,
          km_final: null,
          quantidade_entregas: savedPayload.quantidade_entregas ?? 0,
          peso_kg: savedPayload.peso_kg ?? "0",
          valor_nota: savedPayload.valor_nota,
          valor_avaria: moneyText(damage),
          quantidade_avarias: existing.quantidade_avarias,
          tipo_caminhao: savedPayload.tipo_caminhao,
          carro_apoio: savedPayload.carro_apoio,
        });
      }
      if (historicalCalculation?.status_calculo === "CALCULADO") {
        gross = numeric(historicalCalculation.valor_frete_bruto);
      }
    }
    const paid = numeric(savedPayload.valor_frete_pago)
      ?? (gross === null ? null : gross - damage);
    const ratio = numeric(savedPayload.percentual_frete)
      ?? (gross !== null && invoice !== null && invoice > 0 ? gross / invoice : null);
    const deliveryMatch = savedPayload.complementar_com_entregas
      && savedPayload.id_motorista_selecionado !== null
      ? await freightsDemoApi.deliverySummary(
        savedPayload.data_servico,
        savedPayload.id_motorista_selecionado,
      )
      : null;
    const reasons = [
      ...(gross === null ? ["Valor do frete bruto ausente."] : []),
      ...(!linked ? ["Motorista sem vínculo único no cadastro de demonstração."] : []),
    ];
    const nextSource = {
      ...source,
      nome_transportador_editado: savedPayload.nome_transportador,
      vinculo_responsavel_status: linked ? "VINCULADO" : "NAO_ENCONTRADO",
      responsavel_vinculado_ao_cadastro: linked,
      tipo_transporte_identificado: linked || carrierCode !== undefined,
      vinculo_responsavel_id_pessoa: aggregateDriver?.id ?? carrierDriver?.id_motorista ?? null,
      vinculo_responsavel_nome_cadastrado: aggregateDriver?.name ?? carrierDriver?.nome_motorista ?? null,
      vinculo_responsavel_transportadora: carrierDriver?.codigo_transportadora ?? carrierCode ?? null,
      rota_cidade_editada: savedPayload.rota_cidade,
      km_inicial_editado: savedPayload.km_inicial,
      km_final_editado: savedPayload.km_final,
      km_rodado_editado: savedPayload.km_rodado,
      motorista_selecionado_id: savedPayload.id_motorista_selecionado,
      complemento_entregas: deliveryMatch,
      ultima_edicao_manual: { em: new Date().toISOString() },
    };
    const updated: FreightResponse = {
      ...existing,
      tipo_transporte: type,
      nome_transportador: transporterName,
      id_motorista_agregado: aggregateDriver?.id ?? null,
      id_motorista_transportadora: carrierDriver?.id_motorista ?? null,
      nome_motorista_transportadora: carrierDriver?.nome_motorista ?? null,
      codigo_fonte_tarifa: carrierDriver?.codigo_transportadora
        ?? (carrierCode as FreightResponse["codigo_fonte_tarifa"] | undefined)
        ?? "AGREGADOS_CD",
      data_servico: savedPayload.data_servico,
      rota_cidade: savedPayload.rota_cidade,
      km_inicial: isCarrier ? null : savedPayload.km_inicial,
      km_final: isCarrier ? null : savedPayload.km_final,
      km_rodado: isCarrier ? null : savedPayload.km_rodado,
      quantidade_entregas: savedPayload.quantidade_entregas,
      peso_kg: savedPayload.peso_kg,
      valor_nota: savedPayload.valor_nota,
      tipo_caminhao: type === "TRANSPORTADORA" && tariffCode === "PAULO_CRUZ" ? savedPayload.tipo_caminhao : null,
      carro_apoio: type === "TRANSPORTADORA" && tariffCode === "PAULO_CRUZ" ? savedPayload.carro_apoio : null,
      nome_cliente: savedPayload.nome_cliente ?? null,
      codigo_cliente: savedPayload.codigo_cliente ?? null,
      observacao: savedPayload.observacao ?? null,
      codigo_zona_jit: type === "TRANSPORTADORA" && tariffCode === "JUST_IN_TIME" ? savedPayload.codigo_zona_jit : null,
      codigos_zonas_jit: type === "TRANSPORTADORA" && tariffCode === "JUST_IN_TIME"
        ? (savedPayload.codigo_zona_jit ? [savedPayload.codigo_zona_jit] : [])
        : [],
      adicionais_jit: type === "TRANSPORTADORA" && tariffCode === "JUST_IN_TIME" ? savedPayload.adicionais_jit : [],
      valor_frete_bruto: gross === null ? null : moneyText(gross),
      valor_avaria: moneyText(damage),
      quantidade_avarias: deliveryMatch && deliveryMatch.quantidade_registros > 0 && existing.quantidade_avarias === 0
        ? deliveryMatch.quantidade_avarias
        : existing.quantidade_avarias,
      valor_frete_pago: paid === null ? null : moneyText(paid),
      percentual_frete: ratio === null ? null : String(ratio),
      status_calculo: reasons.length ? "PENDENTE_CONFERENCIA" : "CALCULADO",
      motivo_pendencia: reasons.length ? reasons.join(" ") : null,
      detalhe_calculo: {
        ...existing.detalhe_calculo,
        status: reasons.length ? "PENDENTE_CONFERENCIA" : "CALCULADO",
        motivo: reasons.length ? reasons.join(" ") : null,
        fonte_tarifa: tariffCode ?? "AGREGADOS_CD",
        percentual_frete: ratio === null ? null : String(ratio),
        carro_apoio: type === "TRANSPORTADORA" && tariffCode === "PAULO_CRUZ" ? savedPayload.carro_apoio : null,
        valor_carro_apoio: type === "TRANSPORTADORA" && tariffCode === "PAULO_CRUZ" ? moneyText(targetSupport) : null,
        nome_cliente: savedPayload.nome_cliente ?? null,
        codigo_cliente: savedPayload.codigo_cliente ?? null,
        observacao: savedPayload.observacao ?? null,
        ...(historicalCalculation ? { calculo_tarifa_atual: historicalCalculation.detalhe_calculo } : {}),
        importacao_planilha: nextSource,
      },
    };
    saveFreights(current.map((item) => item.codigo_frete === codigoFrete ? updated : item));
    return updated;
  },

  async cancel(codigoFrete: string, justificativa: string): Promise<void> {
    await pause();
    const current = readFreights();
    const existing = current.find((item) => item.codigo_frete === codigoFrete);
    if (!existing) throw new Error("Lançamento de frete não encontrado.");
    if (existing.cancelado) throw new Error("Este frete já está cancelado.");
    const normalized = justificativa.trim().replace(/\s+/g, " ");
    if (normalized.length < 5) throw new Error("Informe uma justificativa com pelo menos 5 caracteres.");
    const canceled: FreightResponse = {
      ...existing,
      cancelado: true,
      cancelado_em: new Date().toISOString(),
      cancelado_por: 7,
      justificativa_cancelamento: normalized,
    };
    saveFreights(current.map((item) => item.codigo_frete === codigoFrete ? canceled : item));
  },

  async list(filters: FreightHistoryFilters = {}): Promise<FreightPage> {
    await pause();
    const filtered = readFreights()
      .filter((item) => dateInRange(item.data_servico, filters.data_de, filters.data_ate))
      .filter((item) => !filters.tipo_transporte || filters.tipo_transporte === "TODOS" || item.tipo_transporte === filters.tipo_transporte)
      .filter((item) => !filters.status_calculo || filters.status_calculo === "TODOS" || item.status_calculo === filters.status_calculo)
      .filter((item) => filters.id_motorista === undefined || (filters.id_motorista === 0
        ? item.id_motorista_agregado === null && item.id_motorista_transportadora === null
        : item.id_motorista_agregado === filters.id_motorista || item.id_motorista_transportadora === filters.id_motorista))
      .filter((item) => !filters.rota_cidade || item.rota_cidade === filters.rota_cidade)
      .filter((item) => !filters.codigo_transportadora || item.codigo_fonte_tarifa === filters.codigo_transportadora)
      .sort((a, b) => b.data_servico.localeCompare(a.data_servico) || b.id_frete - a.id_frete);
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  },

  async exportHistory(filters: FreightHistoryFilters = {}): Promise<Blob> {
    await pause();
    const records = readFreights()
      .filter((item) => dateInRange(item.data_servico, filters.data_de, filters.data_ate))
      .filter((item) => !filters.tipo_transporte || filters.tipo_transporte === "TODOS" || item.tipo_transporte === filters.tipo_transporte)
      .filter((item) => !filters.status_calculo || filters.status_calculo === "TODOS" || item.status_calculo === filters.status_calculo)
      .filter((item) => filters.id_motorista === undefined || (filters.id_motorista === 0
        ? item.id_motorista_agregado === null && item.id_motorista_transportadora === null
        : item.id_motorista_agregado === filters.id_motorista || item.id_motorista_transportadora === filters.id_motorista))
      .filter((item) => !filters.rota_cidade || item.rota_cidade === filters.rota_cidade)
      .filter((item) => !filters.codigo_transportadora || item.codigo_fonte_tarifa === filters.codigo_transportadora)
      .sort((a, b) => b.data_servico.localeCompare(a.data_servico) || b.id_frete - a.id_frete);
    const { createFreightHistoryWorkbook } = await import("./historyWorkbook");
    return createFreightHistoryWorkbook(records, filters);
  },

  async historyFilterOptions(
    dataDe: string,
    dataAte: string,
    tipoTransporte: string,
  ): Promise<FreightHistoryFilterOptions> {
    await pause();
    const rows = readFreights()
      .filter((item) => dateInRange(item.data_servico, dataDe, dataAte))
      .filter((item) => !tipoTransporte || tipoTransporte === "TODOS" || item.tipo_transporte === tipoTransporte);
    const names = new Map<number, string>();
    const routes = new Set<string>();
    let hasUnlinked = false;
    for (const item of rows) {
      if (item.tipo_transporte === "PROPRIO") continue;
      const id = item.id_motorista_agregado ?? item.id_motorista_transportadora;
      const name = item.id_motorista_agregado !== null
        ? item.nome_transportador
        : item.nome_motorista_transportadora;
      if (id === null) hasUnlinked = true;
      else names.set(id, names.get(id) ?? name ?? `Motorista #${id}`);
      if (item.rota_cidade) routes.add(item.rota_cidade);
    }
    const motoristas = [...names.entries()]
      .map(([id_motorista, nome_motorista]) => ({ id_motorista, nome_motorista }))
      .sort((left, right) => left.nome_motorista.localeCompare(right.nome_motorista, "pt-BR"));
    if (hasUnlinked) motoristas.push({ id_motorista: 0, nome_motorista: "Sem motorista cadastrado" });
    return {
      motoristas,
      rotas: [...routes].sort((left, right) => left.localeCompare(right, "pt-BR")),
      possui_sem_motorista: hasUnlinked,
    };
  },

  async paymentReport(filters: FreightPaymentFilters): Promise<FreightPaymentReport> {
    await pause();
    ensureValidPeriod(filters);
    const records = paymentRecords(filters);
    const settlements = readDemoSettlements().filter((item) => item.status_pagamento !== "ESTORNADO");
    const adjustments = filters.sem_identificacao
      ? []
      : readDemoAdjustments().filter(
          (adj) =>
            adj.tipo_transporte === filters.tipo_transporte
            && dateInRange(adj.data_referencia, filters.data_de, filters.data_ate)
            && (!filters.nome_transportador || adj.nome_transportador === filters.nome_transportador),
        );

    const settlementByFreight = new Map<number, { settlement: DemoSettlementRecord; snapshotNet: number; snapshotDamage: number }>();
    for (const st of settlements) {
      for (const snap of st.freight_snapshots) {
        settlementByFreight.set(snap.id_frete, {
          settlement: st,
          snapshotNet: snap.valor_frete_pago_snapshot,
          snapshotDamage: snap.valor_avaria_snapshot,
        });
      }
    }

    let grossTotal = 0;
    let damageTotal = 0;
    let netTotal = 0;
    let pendingTotal = 0;

    type Group = {
      key: string;
      name: string;
      unidentified: boolean;
      days: Set<string>;
      freights: FreightPaymentResponsibleSummary["fretes"];
      adjustments: FreightPaymentAdjustmentItem[];
      payments: Map<string, DemoSettlementRecord>;
      ready: number;
      pending: number;
      paid: number;
      requested: number;
      open: number;
      gross: number;
      damage: number;
      freightsNet: number;
      paidVal: number;
      reqVal: number;
      openVal: number;
      divergent: boolean;
    };

    const groups = new Map<string, Group>();
    const getGroup = (key: string, name: string, unidentified: boolean): Group => {
      const existing = groups.get(key);
      if (existing) return existing;
      const created: Group = {
        key,
        name,
        unidentified,
        days: new Set(),
        freights: [],
        adjustments: [],
        payments: new Map(),
        ready: 0,
        pending: 0,
        paid: 0,
        requested: 0,
        open: 0,
        gross: 0,
        damage: 0,
        freightsNet: 0,
        paidVal: 0,
        reqVal: 0,
        openVal: 0,
        divergent: false,
      };
      groups.set(key, created);
      return created;
    };

    for (const freight of records) {
      const isUnid = !freight.nome_transportador?.trim();
      const key = isUnid ? UNIDENTIFIED_KEY : (freight.nome_transportador as string);
      const name = isUnid ? "Sem identificação" : (freight.nome_transportador as string);
      const group = getGroup(key, name, isUnid);
      group.days.add(freight.data_servico);
      const ready = demoPaymentReady(freight);
      const netVal = demoPaymentAmount(freight);
      const link = settlementByFreight.get(freight.id_frete);
      const state = link
        ? (link.settlement.status_pagamento === "PAGO" ? "PAGO" : "SOLICITADO")
        : "EM_ABERTO";
      const divergent = Boolean(
        link && (
          !ready
          || netVal === null
          || Math.abs(netVal - link.snapshotNet) > 0.005
          || Math.abs((numeric(freight.valor_avaria) ?? 0) - link.snapshotDamage) > 0.005
        ),
      );
      if (divergent) group.divergent = true;
      if (link) group.payments.set(link.settlement.codigo_pagamento, link.settlement);

      if (!ready) {
        pendingTotal += 1;
        group.pending += 1;
      } else {
        const gross = numeric(freight.valor_frete_bruto) ?? 0;
        const damage = numeric(freight.valor_avaria) ?? 0;
        const net = netVal ?? 0;
        grossTotal += gross;
        damageTotal += damage;
        netTotal += net;
        group.ready += 1;
        group.gross += gross;
        group.damage += damage;
        group.freightsNet += net;
        if (state === "PAGO") {
          group.paid += 1;
          group.paidVal += net;
        } else if (state === "SOLICITADO") {
          group.requested += 1;
          group.reqVal += net;
        } else {
          group.open += 1;
          group.openVal += net;
        }
      }

      group.freights.push({
        id_frete: freight.id_frete,
        codigo_frete: freight.codigo_frete,
        data_servico: freight.data_servico,
        rota_cidade: freight.rota_cidade,
        nome_motorista_transportadora: freight.nome_motorista_transportadora,
        quantidade_entregas: freight.quantidade_entregas,
        peso_kg: freight.peso_kg,
        valor_nota: freight.valor_nota,
        valor_frete_bruto: freight.valor_frete_bruto,
        valor_avaria: freight.valor_avaria,
        valor_frete_pago: netVal === null ? null : moneyText(netVal),
        pronto_para_pagamento: ready,
        motivo_pendencia: ready ? null : (freight.motivo_pendencia || "Frete aguardando conferência."),
        status_pagamento_frete: state,
        codigo_pagamento: link?.settlement.codigo_pagamento ?? null,
        data_pagamento: link?.settlement.data_pagamento ?? null,
        valor_divergente: divergent,
      });
    }

    for (const adj of adjustments) {
      const group = getGroup(adj.nome_transportador, adj.nome_transportador, false);
      group.adjustments.push(adj);
    }

    const responsaveis: FreightPaymentResponsibleSummary[] = [];
    let execPagos = 0;
    let execSolicitados = 0;
    let execParciais = 0;
    let execAbertos = 0;
    let execPend = 0;
    let execAlt = 0;
    let execNfPend = 0;
    let execValPago = 0;
    let execValSol = 0;
    let execValAberto = 0;
    let execValAdj = 0;

    for (const g of groups.values()) {
      const meta = g.unidentified
        ? { documento_fiscal: null, chave_pix: null, exige_nota_fiscal: false }
        : demoProfileMeta(g.name, filters.tipo_transporte);
      let adjAdd = 0;
      let adjSub = 0;
      let adjPaid = 0;
      let adjReq = 0;
      let adjOpen = 0;
      for (const adj of g.adjustments) {
        const val = numeric(adj.valor) ?? 0;
        const signed = adj.natureza === "ACRESCIMO" ? val : -val;
        if (adj.natureza === "ACRESCIMO") adjAdd += val;
        else adjSub += val;
        if (adj.status_pagamento === "PAGO") {
          g.paidVal += signed;
          adjPaid += 1;
        } else if (adj.status_pagamento === "SOLICITADO") {
          g.reqVal += signed;
          adjReq += 1;
        } else {
          g.openVal += signed;
          adjOpen += 1;
        }
      }
      const adjNet = adjAdd - adjSub;
      const totalNet = g.freightsNet + adjNet;
      const totPaidUnits = g.paid + adjPaid;
      const totReqUnits = g.requested + adjReq;
      const totOpenUnits = g.open + adjOpen;
      const status = g.pending > 0
        ? "PENDENTE_CONFERENCIA"
        : totPaidUnits > 0 && totReqUnits === 0 && totOpenUnits === 0
          ? "PAGO"
          : totReqUnits > 0 && totPaidUnits === 0 && totOpenUnits === 0
            ? "SOLICITADO"
            : totPaidUnits > 0 || totReqUnits > 0
              ? "PARCIAL"
              : "A_PAGAR";

      const paymentList = [...g.payments.values()]
        .sort((a, b) => b.criado_em.localeCompare(a.criado_em))
        .map(({ freight_snapshots: _fs, adjustment_codes: _ac, ...rest }) => ({
          ...rest,
          possui_alteracao: g.divergent,
          motivo_alteracao: g.divergent ? "Valores alterados após fechamento." : null,
        }));
      const ultimo = paymentList[0] ?? null;
      const latestDate = paymentList
        .map((p) => p.data_pagamento)
        .filter((d): d is string => Boolean(d))
        .sort()
        .at(-1) ?? null;
      const nfPendente = meta.exige_nota_fiscal && status !== "PAGO" && (!ultimo || !ultimo.nf_recebida);

      responsaveis.push({
        chave_responsavel: g.key,
        nome_transportador: g.name,
        sem_identificacao: g.unidentified,
        id_pessoa_responsavel: null,
        documento_fiscal: meta.documento_fiscal,
        chave_pix: meta.chave_pix,
        exige_nota_fiscal: meta.exige_nota_fiscal,
        quantidade_fretes: g.freights.length,
        quantidade_fretes_prontos: g.ready,
        quantidade_fretes_pendentes: g.pending,
        quantidade_fretes_pagos: g.paid,
        quantidade_fretes_solicitados: g.requested,
        quantidade_fretes_em_aberto: g.open,
        quantidade_dias: g.days.size,
        valor_frete_bruto: moneyText(g.gross),
        valor_avarias: moneyText(g.damage),
        valor_ajustes_acrescimos: moneyText(adjAdd),
        valor_ajustes_descontos: moneyText(adjSub),
        valor_ajustes_liquido: moneyText(adjNet),
        valor_liquido_total: moneyText(totalNet),
        valor_pago: moneyText(g.paidVal),
        valor_solicitado: moneyText(g.reqVal),
        valor_em_aberto: moneyText(g.openVal),
        status_pagamento: status,
        possui_alteracao: g.divergent,
        motivo_alteracao: g.divergent ? "Valores de frete mudaram após o fechamento." : null,
        data_pagamento_mais_recente: latestDate,
        nf_pendente: nfPendente,
        ultimo_pagamento: ultimo,
        pagamentos: paymentList,
        fretes: g.freights,
        ajustes: g.adjustments,
      });

      if (status === "PAGO") execPagos += 1;
      else if (status === "SOLICITADO") execSolicitados += 1;
      else if (status === "PARCIAL") execParciais += 1;
      else if (status === "A_PAGAR") execAbertos += 1;
      else execPend += 1;
      if (g.divergent) execAlt += 1;
      if (nfPendente) execNfPend += 1;
      execValPago += g.paidVal;
      execValSol += g.reqVal;
      execValAberto += g.openVal;
      execValAdj += adjNet;
    }

    const orderWeight = (item: FreightPaymentResponsibleSummary) =>
      item.possui_alteracao ? 0
        : item.status_pagamento === "PENDENTE_CONFERENCIA" ? 1
          : item.status_pagamento === "PARCIAL" ? 2
            : item.status_pagamento === "A_PAGAR" ? 3
              : item.status_pagamento === "SOLICITADO" ? 4
                : 5;
    responsaveis.sort(
      (a, b) => orderWeight(a) - orderWeight(b) || a.nome_transportador.localeCompare(b.nome_transportador, "pt-BR"),
    );

    return {
      data_de: filters.data_de,
      data_ate: filters.data_ate,
      tipo_transporte: filters.tipo_transporte,
      nome_transportador: filters.nome_transportador ?? null,
      sem_identificacao: Boolean(filters.sem_identificacao),
      quantidade_fretes: records.length,
      quantidade_pendentes: pendingTotal,
      pendencias: records.filter((item) => !demoPaymentReady(item)).map((item) => ({
        codigo_frete: item.codigo_frete, data_servico: item.data_servico,
        nome_transportador: item.nome_transportador, rota_cidade: item.rota_cidade,
        valor_frete_bruto: item.valor_frete_bruto, valor_avaria: item.valor_avaria,
        valor_frete_pago: demoPaymentAmount(item) === null ? null : moneyText(demoPaymentAmount(item) as number),
        motivo_pendencia: item.motivo_pendencia || (item.valor_frete_pago === null ? "Valor líquido do frete não informado." : "Frete aguardando conferência."),
      })),
      avisos: records.flatMap((item) => {
        const warning = demoPaymentWarning(item);
        return warning ? [warning] : [];
      }),
      valor_frete_bruto: moneyText(grossTotal),
      valor_avarias: moneyText(damageTotal),
      valor_a_pagar: moneyText(netTotal + execValAdj),
      resumo_execucao: {
        total_responsaveis: responsaveis.length,
        responsaveis_pagos: execPagos,
        responsaveis_solicitados: execSolicitados,
        responsaveis_parciais: execParciais,
        responsaveis_em_aberto: execAbertos,
        responsaveis_com_pendencia: execPend,
        responsaveis_com_alteracao: execAlt,
        nf_pendentes: execNfPend,
        valor_pago: moneyText(execValPago),
        valor_solicitado: moneyText(execValSol),
        valor_em_aberto: moneyText(execValAberto),
        valor_ajustes: moneyText(execValAdj),
      },
      responsaveis,
      ajustes: adjustments,
    };
  },

  async paymentOptions(dataDe: string, dataAte: string): Promise<FreightPaymentOptions> {
    await pause();
    if (dataDe > dataAte) throw new Error("A data inicial deve ser anterior à data final.");
    const records = readFreights().filter((item) =>
      !item.cancelado
      && (item.tipo_transporte === "AGREGADO" || item.tipo_transporte === "TRANSPORTADORA")
      && dateInRange(item.data_servico, dataDe, dataAte));
    const adjustments = readDemoAdjustments().filter((adj) =>
      dateInRange(adj.data_referencia, dataDe, dataAte));
    return {
      agregados: [...new Set([
        ...records
          .filter((item) => item.tipo_transporte === "AGREGADO" && item.nome_transportador)
          .map((item) => item.nome_transportador as string),
        ...adjustments
          .filter((adj) => adj.tipo_transporte === "AGREGADO")
          .map((adj) => adj.nome_transportador),
      ])].sort((a, b) => a.localeCompare(b, "pt-BR")),
      transportadoras: [...new Set([
        ...records
          .filter((item) => item.tipo_transporte === "TRANSPORTADORA" && item.nome_transportador)
          .map((item) => item.nome_transportador as string),
        ...adjustments
          .filter((adj) => adj.tipo_transporte === "TRANSPORTADORA")
          .map((adj) => adj.nome_transportador),
      ])].sort((a, b) => a.localeCompare(b, "pt-BR")),
      agregados_sem_identificacao: records.some((item) =>
        item.tipo_transporte === "AGREGADO" && item.nome_transportador === null),
    };
  },

  async exportPaymentReport(filters: FreightPaymentFilters): Promise<Blob> {
    const { createPaymentRequestWorkbook } = await import("./paymentRequestWorkbook");
    if (filters.codigo_pagamento) {
      const found = readDemoSettlements().find((s) => s.codigo_pagamento === filters.codigo_pagamento);
      if (!found) throw new Error("Fechamento de pagamento não encontrado.");
      const prefix = found.tipo_transporte === "AGREGADO" ? "AGREGADO" : "TRANSPORTADORA";
      return createPaymentRequestWorkbook([{
        name: found.nome_transportador,
        cpf: found.documento_fiscal,
        reason: `${prefix} TOTAL DE ${found.quantidade_dias} ${found.quantidade_dias === 1 ? "DIA" : "DIAS"}`,
        total: Number(found.valor_liquido_registrado),
        observations: found.observacao ?? "",
      }]);
    }
    const report = await this.paymentReport(filters);
    const selectedSet = filters.responsaveis?.length ? new Set(filters.responsaveis) : null;
    const targets = (report.responsaveis ?? []).filter(
      (resp) => !selectedSet || selectedSet.has(resp.chave_responsavel),
    );
    if ((!selectedSet && report.quantidade_pendentes) || targets.some((t) => t.quantidade_fretes_pendentes > 0)) {
      throw new Error("Resolva os fretes pendentes de conferência antes de exportar o pagamento.");
    }
    const reasonPrefix = filters.tipo_transporte === "AGREGADO" ? "AGREGADO" : "TRANSPORTADORA";
    const rows: PaymentRequestWorkbookRow[] = targets
      .sort((a, b) => a.nome_transportador.localeCompare(b.nome_transportador, "pt-BR"))
      .map((resp) => ({
        name: resp.nome_transportador,
        cpf: resp.documento_fiscal,
        reason: `${reasonPrefix} TOTAL DE ${resp.quantidade_dias} ${resp.quantidade_dias === 1 ? "DIA" : "DIAS"}`,
        total: Number(filters.apenas_em_aberto ? resp.valor_em_aberto : resp.valor_liquido_total),
        observations: Number(resp.valor_ajustes_liquido) !== 0 ? `Ajustes: R$ ${resp.valor_ajustes_liquido}` : "",
      }));
    return createPaymentRequestWorkbook(rows);
  },

  async paymentPendingSummary(): Promise<FreightPaymentPendingSummary> {
    const today = demoTodayIso();
    const dateObj = new Date(`${today}T12:00:00`);
    const day = dateObj.getDay();
    const weekStart = demoAddDays(today, day === 0 ? -6 : 1 - day);
    const weekEnd = demoAddDays(weekStart, 6);
    const [agg, car] = await Promise.all([
      this.paymentReport({ data_de: weekStart, data_ate: weekEnd, tipo_transporte: "AGREGADO" }),
      this.paymentReport({ data_de: weekStart, data_ate: weekEnd, tipo_transporte: "TRANSPORTADORA" }),
    ]);
    const a = agg.resumo_execucao;
    const c = car.resumo_execucao;
    return {
      semana_de: weekStart,
      semana_ate: weekEnd,
      responsaveis_em_aberto: (a?.responsaveis_em_aberto ?? 0) + (a?.responsaveis_parciais ?? 0) + (c?.responsaveis_em_aberto ?? 0) + (c?.responsaveis_parciais ?? 0),
      responsaveis_com_pendencia: (a?.responsaveis_com_pendencia ?? 0) + (c?.responsaveis_com_pendencia ?? 0),
      nf_pendentes: (a?.nf_pendentes ?? 0) + (c?.nf_pendentes ?? 0),
      valor_em_aberto: moneyText(Number(a?.valor_em_aberto ?? 0) + Number(c?.valor_em_aberto ?? 0)),
    };
  },

  async createPaymentSettlements(
    payload: FreightPaymentSettlementCreateInput,
  ): Promise<FreightPaymentSettlementSummary[]> {
    const report = await this.paymentReport({
      data_de: payload.data_de,
      data_ate: payload.data_ate,
      tipo_transporte: payload.tipo_transporte,
      sem_identificacao: payload.sem_identificacao,
    });
    const selected = payload.sem_identificacao
      ? new Set([UNIDENTIFIED_KEY])
      : payload.responsaveis?.length
        ? new Set(payload.responsaveis)
        : null;
    const targets = (report.responsaveis ?? []).filter(
      (item) => !selected || selected.has(item.chave_responsavel),
    );
    const allSettlements = readDemoSettlements();
    const allAdjustments = readDemoAdjustments();
    const nowIso = new Date().toISOString();
    const payDate = payload.acao === "MARCAR_PAGO" ? (payload.data_pagamento || demoTodayIso()) : null;
    const touched: FreightPaymentSettlementSummary[] = [];

    for (const target of targets) {
      if (target.quantidade_fretes_pendentes > 0) {
        throw new Error(`Resolva os fretes pendentes de conferência de ${target.nome_transportador} antes de fechar.`);
      }
      if (payload.acao === "MARCAR_PAGO" && payload.incluir_solicitados !== false) {
        for (const existing of allSettlements) {
          if (
            existing.status_pagamento === "SOLICITADO"
            && target.pagamentos.some((p) => p.codigo_pagamento === existing.codigo_pagamento)
          ) {
            existing.status_pagamento = "PAGO";
            existing.data_pagamento = payDate;
            existing.pago_em = nowIso;
            existing.pago_por_nome = "Usuário Demo";
            if (payload.observacao) existing.observacao = payload.observacao;
            if (payload.nf_numero || payload.nf_recebida) {
              existing.nf_numero = payload.nf_numero ?? null;
              existing.nf_data = payload.nf_data ?? null;
              existing.nf_recebida = Boolean(payload.nf_recebida);
            }
            for (const adj of allAdjustments) {
              if (adj.codigo_pagamento === existing.codigo_pagamento) adj.status_pagamento = "PAGO";
            }
            touched.push(existing);
          }
        }
      }
      const openFreights = target.fretes.filter(
        (f) => f.pronto_para_pagamento && f.status_pagamento_frete === "EM_ABERTO",
      );
      const openAdjustments = target.ajustes.filter((a) => !a.vinculado_pagamento);
      if (!openFreights.length && !openAdjustments.length) continue;

      const grossSum = openFreights.reduce((s, f) => s + (numeric(f.valor_frete_bruto) ?? 0), 0);
      const damageSum = openFreights.reduce((s, f) => s + (numeric(f.valor_avaria) ?? 0), 0);
      const freightNet = openFreights.reduce((s, f) => s + (numeric(f.valor_frete_pago) ?? 0), 0);
      const adjNet = openAdjustments.reduce(
        (s, a) => s + ((a.natureza === "ACRESCIMO" ? 1 : -1) * (numeric(a.valor) ?? 0)),
        0,
      );
      const code = crypto.randomUUID();
      const status = payload.acao === "MARCAR_PAGO" ? "PAGO" : "SOLICITADO";
      const record: DemoSettlementRecord = {
        codigo_pagamento: code,
        tipo_transporte: payload.tipo_transporte,
        nome_transportador: target.nome_transportador,
        sem_identificacao: target.sem_identificacao,
        id_pessoa_responsavel: target.id_pessoa_responsavel,
        documento_fiscal: target.documento_fiscal,
        chave_pix: target.chave_pix,
        exige_nota_fiscal: target.exige_nota_fiscal,
        data_de: payload.data_de,
        data_ate: payload.data_ate,
        status_pagamento: status,
        quantidade_fretes: openFreights.length,
        quantidade_dias: new Set(openFreights.map((f) => f.data_servico)).size,
        valor_frete_bruto: moneyText(grossSum),
        valor_avarias: moneyText(damageSum),
        valor_ajustes: moneyText(adjNet),
        valor_liquido_registrado: moneyText(freightNet + adjNet),
        data_pagamento: payDate,
        nf_numero: payload.nf_numero ?? null,
        nf_data: payload.nf_data ?? null,
        nf_recebida: Boolean(payload.nf_recebida),
        observacao: payload.observacao ?? null,
        criado_em: nowIso,
        criado_por_nome: "Usuário Demo",
        pago_em: status === "PAGO" ? nowIso : null,
        pago_por_nome: status === "PAGO" ? "Usuário Demo" : null,
        estornado_em: null,
        estornado_por_nome: null,
        motivo_estorno: null,
        possui_alteracao: false,
        motivo_alteracao: null,
        freight_snapshots: openFreights.map((f) => ({
          id_frete: f.id_frete,
          valor_frete_pago_snapshot: numeric(f.valor_frete_pago) ?? 0,
          valor_avaria_snapshot: numeric(f.valor_avaria) ?? 0,
        })),
        adjustment_codes: openAdjustments.map((a) => a.codigo_ajuste),
      };
      allSettlements.unshift(record);
      for (const adj of allAdjustments) {
        if (record.adjustment_codes.includes(adj.codigo_ajuste)) {
          adj.vinculado_pagamento = true;
          adj.codigo_pagamento = code;
          adj.status_pagamento = status;
        }
      }
      touched.push(record);
    }

    if (!touched.length) {
      throw new Error("Não há fretes ou ajustes pendentes de fechamento para os responsáveis selecionados.");
    }
    saveDemoSettlements(allSettlements);
    saveDemoAdjustments(allAdjustments);
    return touched;
  },

  async updatePaymentSettlementStatus(
    codigoPagamento: string,
    payload: FreightPaymentSettlementStatusInput,
  ): Promise<FreightPaymentSettlementSummary> {
    await pause();
    const allSettlements = readDemoSettlements();
    const allAdjustments = readDemoAdjustments();
    const target = allSettlements.find((s) => s.codigo_pagamento === codigoPagamento);
    if (!target) throw new Error("Fechamento de pagamento não encontrado.");
    const nowIso = new Date().toISOString();
    if (payload.acao === "MARCAR_PAGO") {
      target.status_pagamento = "PAGO";
      target.data_pagamento = payload.data_pagamento || demoTodayIso();
      target.pago_em = nowIso;
      target.pago_por_nome = "Usuário Demo";
      for (const adj of allAdjustments) {
        if (adj.codigo_pagamento === codigoPagamento) adj.status_pagamento = "PAGO";
      }
    } else if (payload.acao === "DESFAZER_PAGO") {
      target.status_pagamento = "SOLICITADO";
      target.data_pagamento = null;
      target.pago_em = null;
      target.pago_por_nome = null;
      for (const adj of allAdjustments) {
        if (adj.codigo_pagamento === codigoPagamento) adj.status_pagamento = "SOLICITADO";
      }
    } else {
      target.status_pagamento = "ESTORNADO";
      target.estornado_em = nowIso;
      target.estornado_por_nome = "Usuário Demo";
      target.motivo_estorno = payload.motivo_estorno || "Estorno manual";
      for (const adj of allAdjustments) {
        if (adj.codigo_pagamento === codigoPagamento) {
          adj.vinculado_pagamento = false;
          adj.codigo_pagamento = null;
          adj.status_pagamento = null;
        }
      }
    }
    saveDemoSettlements(allSettlements);
    saveDemoAdjustments(allAdjustments);
    return target;
  },

  async updatePaymentSettlementInvoice(
    codigoPagamento: string,
    payload: FreightPaymentInvoiceUpdateInput,
  ): Promise<FreightPaymentSettlementSummary> {
    await pause();
    const allSettlements = readDemoSettlements();
    const target = allSettlements.find((s) => s.codigo_pagamento === codigoPagamento);
    if (!target) throw new Error("Fechamento de pagamento não encontrado.");
    target.nf_numero = payload.nf_numero;
    target.nf_data = payload.nf_data;
    target.nf_recebida = payload.nf_recebida;
    saveDemoSettlements(allSettlements);
    return target;
  },

  async listPaymentSettlements(
    filters: FreightPaymentSettlementHistoryFilters = {},
  ): Promise<FreightPaymentSettlementPage> {
    await pause();
    const filtered = readDemoSettlements()
      .filter((s) => !filters.tipo_transporte || s.tipo_transporte === filters.tipo_transporte)
      .filter((s) => !filters.status_pagamento || s.status_pagamento === filters.status_pagamento)
      .filter((s) => filters.incluir_estornados !== false || s.status_pagamento !== "ESTORNADO")
      .filter((s) => !filters.nome_transportador || s.nome_transportador === filters.nome_transportador)
      .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  },

  async listPaymentAdjustments(
    dataDe?: string,
    dataAte?: string,
    tipoTransporte?: string,
    nomeTransportador?: string,
  ): Promise<FreightPaymentAdjustmentItem[]> {
    await pause();
    return readDemoAdjustments()
      .filter((adj) => !tipoTransporte || adj.tipo_transporte === tipoTransporte)
      .filter((adj) => dateInRange(adj.data_referencia, dataDe, dataAte))
      .filter((adj) => !nomeTransportador || adj.nome_transportador === nomeTransportador)
      .sort((a, b) => b.data_referencia.localeCompare(a.data_referencia));
  },

  async createPaymentAdjustments(
    payload: FreightPaymentAdjustmentCreateInput,
  ): Promise<FreightPaymentAdjustmentItem[]> {
    await pause();
    const all = readDemoAdjustments();
    const totalVal = numeric(payload.valor) ?? 0;
    const n = payload.parcelas;
    const basePart = money(totalVal / n);
    let acc = 0;
    const created: FreightPaymentAdjustmentItem[] = [];
    for (let i = 0; i < n; i += 1) {
      const partVal = i === n - 1 ? money(totalVal - acc) : basePart;
      acc = money(acc + partVal);
      const refDate = payload.periodicidade === "SEMANAL"
        ? demoAddDays(payload.data_referencia, i * 7)
        : demoAddMonths(payload.data_referencia, i);
      const item: FreightPaymentAdjustmentItem = {
        codigo_ajuste: crypto.randomUUID(),
        tipo_transporte: payload.tipo_transporte,
        nome_transportador: payload.nome_transportador,
        id_pessoa_responsavel: null,
        data_referencia: refDate,
        natureza: payload.natureza,
        categoria: payload.categoria,
        descricao: n > 1 ? `${payload.descricao} (${i + 1}/${n})` : payload.descricao,
        valor: moneyText(partVal),
        observacao: payload.observacao ?? null,
        vinculado_pagamento: false,
        codigo_pagamento: null,
        status_pagamento: null,
        criado_em: new Date().toISOString(),
        criado_por_nome: "Usuário Demo",
      };
      all.unshift(item);
      created.push(item);
    }
    saveDemoAdjustments(all);
    return created;
  },

  async deletePaymentAdjustment(codigoAjuste: string): Promise<void> {
    await pause();
    const all = readDemoAdjustments();
    const found = all.find((a) => a.codigo_ajuste === codigoAjuste);
    if (!found) throw new Error("Lançamento não encontrado.");
    if (found.vinculado_pagamento) throw new Error("Estorne o pagamento vinculado antes de excluir.");
    saveDemoAdjustments(all.filter((a) => a.codigo_ajuste !== codigoAjuste));
  },
};
