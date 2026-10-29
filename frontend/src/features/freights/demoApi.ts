import type {
  AggregateCreateRequest,
  AggregatePaymentFilters,
  AggregatePaymentSummary,
  AggregateResponse,
  FreightHistoryFilters,
  FreightInput,
  FreightPage,
  FreightPaymentReport,
  FreightQuoteResponse,
  FreightResponse,
  FreightTariffOptions,
  JustInTimeZoneOption,
} from "./types";

const AGGREGATES_KEY = "lancamento-logistica:demo-freight-aggregates";
const FREIGHTS_KEY = "lancamento-logistica:demo-freights";
const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 120));

/** No modo demo, o CPF fica no armazenamento local e nunca integra a resposta comum. */
type DemoAggregate = AggregateResponse & { cpf: string | null };

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
  { codigo: "BUZIOS", nome: "Búzios" },
  { codigo: "SAO PEDRO DA ALDEIA", nome: "São Pedro da Aldeia" },
  { codigo: "ARRAIAL DO CABO", nome: "Arraial do Cabo" },
  { codigo: "ARARUAMA", nome: "Araruama" },
  { codigo: "CAMPOS", nome: "Campos" },
];

const jitZones: JustInTimeZoneOption[] = [
  { codigo: "ZONA_OESTE_1", nome: "ZONA OESTE 1", areas: "Recreio dos Bandeirantes, Garnenia, Azul, Anil, Barra da Tijuca, Joá, Itanhangá, Jacarépagua, Freguesia, Taquara, Tanque, Praça Seca, Camorim, Jardim Sulacap, Vila Valqueire" },
  { codigo: "ZONA_OESTE_2", nome: "ZONA OESTE 2", areas: "Guaratiba, Pedra de Guaratiba, Campo Grande, Santa Cruz, Barra de Guarariba, Vargem Grande" },
  { codigo: "ZONA_SUL", nome: "ZONA SUL", areas: "Flamengo, Botafogo, Cosme Velho, Glória, Humaitá, Santa Teresa, Catete, Copacabana, Ipanema, Leblon, Jardim Botânico, Lagoa, São Conrado, Leme, Gávea" },
  { codigo: "BAIXADA_FLUMINENSE", nome: "BAIXADA FLUMINENSE", areas: "Caxias, Nova Iguaçu, Belford Roxo, Mesquita, Queimados, Eng Pedreira, Japeri, Nilopólis" },
  { codigo: "ZONA_NORTE_1", nome: "ZONA NORTE 1", areas: "Cachambi, Pilares, Piedade, Cascadura, Madureira, Todos os Santos, Bonsucesso, Ramos, Penha, Engenho de Dentro, Ilha do Governador" },
  { codigo: "ZONA_NORTE_2", nome: "ZONA NORTE 2", areas: "Macaranã, Tijuca, Vila Isabel, Grajaú, Andaraí, Alto da Boa Vista, Caju, Centro" },
  { codigo: "NORTE_FLUMINENSE", nome: "NORTE FLUMINENSE", areas: "Conceição de Macabu, Quisamã, Campos, São João da Barra" },
  { codigo: "NOROESTE_FLUMINENSE", nome: "NOROESTE FLUMINENSE", areas: "Cordeiro, Santo Antônio de Padua, Piratininga, Latoca, Aperibé, Miracema, Laje do Muriaé, Natividade, Muriaé, Itaperuna, Macuco, Cantagalo" },
  { codigo: "REGI_O_SERRANA_1", nome: "REGIÃO SERRANA 1", areas: "Petropólis, Itaipava, Três Rios, Areal" },
  { codigo: "REGI_O_SERRANA_2", nome: "REGIÃO SERRANA 2", areas: "Teresopólis, Cachoeira de Macacu, Friburgo, Bom Jardim, Nova Friburgo" },
  { codigo: "NITEROI_1", nome: "NITEROI 1", areas: "Niteroi, Centro, Icarai, Santa Rosa, Pendotiba, Piratininga, Itaipu, Camboinhas, São Francisco, Charitas" },
  { codigo: "NITEROI_2", nome: "NITEROI 2", areas: "São Gonçalo, Itaborai, Rio Bonito, Tanga" },
  { codigo: "REGI_O_DOS_LAGOS_1", nome: "REGIÃO DOS LAGOS 1", areas: "Marica, Araruama, Saquarema, Iguaba, Cabo Frio, Arraial do cano, Búzios, São Pedro da Aldeia" },
  { codigo: "REGI_O_DOS_LAGOS_2", nome: "REGIÃO DOS LAGOS 2", areas: "Cassimiro de Abreu, Rios das Ostras, Macaé, Silva Jardim" },
  { codigo: "COSTA_VERDE_1", nome: "COSTA VERDE 1", areas: "Iataguai, Itacuruça, Coroa Grande, Muriqui, Conceição de Jacarei, Mangaratiba" },
  { codigo: "COSTA_VERDE_2", nome: "COSTA VERDE 2", areas: "Angra dos Reis, Paraty, Rio Claro, Lídice" },
  { codigo: "VALE_DO_PARAIBA1", nome: "VALE DO PARAIBA1", areas: "Parai, Barra do Parai, Volta Redonda, Rio das Flore, Itatiaia, Porto Real, Quatis, Barra Mansa, Resende, Valença, Pinheiral" },
  { codigo: "VALE_DO_PARAIBA_2", nome: "VALE DO PARAIBA 2", areas: "Miguel Pereira, Paty Alferes, Mendes, Paraiba do Sul, Vassouras, Avelar" },
];

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

/** Arredonda valores não negativos para centavos, como a calculadora de fretes. */
function money(value: number): number {
  return Math.floor((value + Number.EPSILON) * 100 + 0.5) / 100;
}

/** Serializa os decimais de saída com escala monetária estável. */
function moneyText(value: number): string {
  return money(value).toFixed(2);
}

/** Verifica a validade matemática do CPF informado no cadastro demonstrativo. */
function validCpf(digits: string): boolean {
  if (digits.length !== 11 || /^([0-9])\1{10}$/.test(digits)) return false;
  const digitFor = (part: string, startWeight: number) => {
    const sum = [...part].reduce(
      (total, digit, index) => total + Number(digit) * (startWeight - index),
      0,
    );
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digits.endsWith(`${digitFor(digits.slice(0, 9), 10)}${digitFor(digits.slice(0, 10), 11)}`);
}

/** Valida e normaliza o CPF seguindo as regras do contrato da API. */
function normalizeCpf(value?: string | null): string | null {
  if (!value?.trim()) return null;
  if (!/^[0-9.\-\s]+$/.test(value.trim())) {
    throw new Error("Informe o CPF usando apenas números, pontos e hífen.");
  }
  const digits = value.replace(/[.\-\s]/g, "");
  if (digits.length !== 11) throw new Error("O CPF deve conter 11 dígitos.");
  if (!validCpf(digits)) throw new Error("O CPF informado é inválido.");
  return digits;
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

/** Retorna apenas campos suficientes para operar o agregado no modo demo. */
function isDemoAggregate(value: unknown): value is DemoAggregate {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DemoAggregate>;
  return typeof item.id_agregado === "number"
    && typeof item.codigo_agregado === "string"
    && typeof item.nome === "string"
    && typeof item.ativo === "boolean"
    && typeof item.criado_em === "string"
    && (typeof item.cpf === "string" || item.cpf === null);
}

/** Confere a estrutura mínima antes de reutilizar um frete salvo localmente. */
function isFreight(value: unknown): value is FreightResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<FreightResponse>;
  return typeof item.id_frete === "number"
    && typeof item.codigo_frete === "string"
    && typeof item.id_agregado === "number"
    && typeof item.data_servico === "string"
    && typeof item.status_calculo === "string";
}

function readAggregates(): DemoAggregate[] {
  return readArray(AGGREGATES_KEY, isDemoAggregate);
}

function readFreights(): FreightResponse[] {
  return readArray(FREIGHTS_KEY, isFreight);
}

function saveAggregates(items: DemoAggregate[]): void {
  window.localStorage.setItem(AGGREGATES_KEY, JSON.stringify(items));
}

function saveFreights(items: FreightResponse[]): void {
  window.localStorage.setItem(FREIGHTS_KEY, JSON.stringify(items));
}

/** Cria uma resposta pendente sem inventar preço quando a regra não resolve a tarifa. */
function pendingQuote(reason: string, detail: Record<string, unknown>): FreightQuoteResponse {
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

/** Calcula uma tarifa JIT apenas quando a faixa base e o adicional são únicos. */
function quoteJustInTime(payload: FreightInput): FreightQuoteResponse {
  const zone = jitZones.find((item) => item.codigo === payload.codigo_zona_jit);
  if (!zone) return pendingQuote("Selecione uma zona válida da tabela JUST IN TIME.", {});

  const weight = numeric(payload.peso_kg) ?? 0;
  const tiers = jitTiers(zone.codigo);
  const matches = tiers.filter((tier) => tier.min <= weight && weight <= tier.max);
  const detail: Record<string, unknown> = {
    zona: zone.nome,
    areas_da_zona: zone.areas,
    peso_kg: String(payload.peso_kg),
    fonte_tarifa: "JUST_IN_TIME",
  };
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
function quoteAggregates(payload: FreightInput): FreightQuoteResponse {
  const route = normalizeLabel(payload.rota_cidade);
  const routeSheets: Record<string, string> = {
    "RIO DAS OSTRAS": "RO",
    MACAE: "MC",
    "MACAE SERRA": "MC S",
    "CABO FRIO": "CF",
    BUZIOS: "CF",
    "SAO PEDRO DA ALDEIA": "CF",
    "ARRAIAL DO CABO": "CF",
    ARARUAMA: "AR",
    CAMPOS: "CP",
  };
  const sheet = routeSheets[route];
  if (!sheet) {
    return pendingQuote("A rota ainda não está associada a uma aba de tarifa Agregados CD.", {
      rota_cidade: payload.rota_cidade,
      fonte_tarifa: "AGREGADOS_CD",
    });
  }

  const km = numeric(payload.km_rodado)
    ?? ((numeric(payload.km_inicial) !== null && numeric(payload.km_final) !== null)
      ? (numeric(payload.km_final) as number) - (numeric(payload.km_inicial) as number)
      : null);
  const invoice = numeric(payload.valor_nota);
  const weight = numeric(payload.peso_kg) ?? 0;
  if (km === null || invoice === null) {
    return pendingQuote("Informe KM rodado e valor da nota para calcular a tarifa Agregados CD.", {
      aba_tarifa: sheet,
      fonte_tarifa: "AGREGADOS_CD",
    });
  }

  // RO e MC usam 1,2% conforme a validação do usuário para estas tabelas.
  const rates: Record<string, { percent: number; perKm: number; perKg: number }> = {
    RO: { percent: 0.012, perKm: 6.32, perKg: 0.06 },
    MC: { percent: 0.012, perKm: 3.56, perKg: 0.06 },
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

/** Seleciona o valor fixo Paulo Cruz e aplica somente os limites publicados. */
function quotePauloCruz(payload: FreightInput): FreightQuoteResponse {
  const vehicles: Record<string, { name: string; price: number; bounds: [number, number] | null; label: string }> = {
    SAVEIRO: { name: "Saveiro", price: 300, bounds: null, label: "Carro de apoio" },
    KIA_BONGO: { name: "Kia Bongo", price: 500, bounds: null, label: "Carro de apoio" },
    CAMINHAO_3_4: { name: "Caminhão 3/4", price: 950, bounds: [1500, 4000], label: "1.500 a 4.000 kg" },
    CAMINHAO_TOCO: { name: "Caminhão toco", price: 1100, bounds: [4001, 9000], label: "4.001 a 9.000 kg" },
  };
  const vehicle = payload.tipo_caminhao ? vehicles[payload.tipo_caminhao] : undefined;
  if (!vehicle) return pendingQuote("Selecione um tipo de caminhão da tabela Paulo Cruz.", {});

  const weight = numeric(payload.peso_kg) ?? 0;
  if (vehicle.bounds && (weight < vehicle.bounds[0] || weight > vehicle.bounds[1])) {
    return pendingQuote("O peso não se enquadra na faixa definida para o caminhão Paulo Cruz.", {
      tipo_caminhao: payload.tipo_caminhao,
      faixa_de_peso: vehicle.label,
      peso_kg: String(payload.peso_kg),
      fonte_tarifa: "PAULO_CRUZ",
    });
  }

  return {
    status_calculo: "CALCULADO",
    valor_frete_bruto: moneyText(vehicle.price),
    percentual_frete: null,
    motivo_pendencia: null,
    detalhe_calculo: {
      fonte_tarifa: "PAULO_CRUZ",
      status: "CALCULADO",
      tipo_caminhao: payload.tipo_caminhao,
      formula: "frete_fixo_por_tipo_de_caminhao",
      faixa_de_peso: vehicle.label,
      valor_fixo: moneyText(vehicle.price),
    },
  };
}

/** Executa a cotação conforme a fonte tarifária escolhida. */
function calculateQuote(payload: FreightInput): FreightQuoteResponse {
  let quote = payload.codigo_fonte_tarifa === "AGREGADOS_CD"
    ? quoteAggregates(payload)
    : payload.codigo_fonte_tarifa === "JUST_IN_TIME"
      ? quoteJustInTime(payload)
      : quotePauloCruz(payload);

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
  return quote;
}

/** Cria valores coerentes com as datas textuais enviadas pela API. */
function dateInRange(value: string, from?: string, to?: string): boolean {
  return (!from || value >= from) && (!to || value <= to);
}

/** Converte o nome de um agregado para o formato sem dados pessoais da resposta. */
function aggregateResponse(item: DemoAggregate): AggregateResponse {
  return {
    id_agregado: item.id_agregado,
    codigo_agregado: item.codigo_agregado,
    nome: item.nome,
    ativo: item.ativo,
    criado_em: item.criado_em,
  };
}

/** Gera as opções para os formulários de demonstração. */
function options(): FreightTariffOptions {
  return {
    fontes: tariffSources,
    rotas_agregados_cd: aggregateRoutes,
    zonas_just_in_time: jitZones,
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
function ensureValidPeriod(filters: AggregatePaymentFilters): void {
  if (filters.data_de > filters.data_ate) {
    throw new Error("A data inicial deve ser anterior à data final.");
  }
}

/** Converte valor numérico em data brasileira para o arquivo financeiro. */
function brazilianDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

/** Escapa uma célula CSV e bloqueia fórmulas iniciadas por caracteres especiais. */
function csvCell(value: string, protectFormula = false): string {
  const safe = protectFormula && /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Operações locais usadas somente quando VITE_DEMO_MODE estiver ativo. */
export const freightsDemoApi = {
  async tariffOptions(): Promise<FreightTariffOptions> {
    await pause();
    return options();
  },

  async listAggregates(): Promise<AggregateResponse[]> {
    await pause();
    return readAggregates()
      .filter((item) => item.ativo)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .map(aggregateResponse);
  },

  async createAggregate(payload: AggregateCreateRequest): Promise<AggregateResponse> {
    await pause();
    const nome = payload.nome.trim().replace(/\s+/g, " ");
    if (nome.length < 2) throw new Error("Informe o nome completo do agregado.");
    const aggregates = readAggregates();
    if (aggregates.some((item) => item.nome.toLocaleLowerCase("pt-BR") === nome.toLocaleLowerCase("pt-BR"))) {
      throw new Error("Já existe um agregado com esse nome.");
    }
    const cpf = normalizeCpf(payload.cpf);
    if (cpf && aggregates.some((item) => item.cpf === cpf)) {
      throw new Error("Já existe um agregado com esse CPF.");
    }
    const created: DemoAggregate = {
      id_agregado: Math.max(0, ...aggregates.map((item) => item.id_agregado)) + 1,
      codigo_agregado: crypto.randomUUID(),
      nome,
      cpf,
      ativo: true,
      criado_em: new Date().toISOString(),
    };
    saveAggregates([...aggregates, created]);
    return aggregateResponse(created);
  },

  async quote(payload: FreightInput): Promise<FreightQuoteResponse> {
    await pause();
    return calculateQuote(payload);
  },

  async create(payload: FreightInput): Promise<FreightResponse> {
    await pause();
    const aggregate = readAggregates().find((item) => item.id_agregado === payload.id_agregado && item.ativo);
    if (!aggregate) throw new Error("O agregado selecionado não foi encontrado ou está inativo.");

    const quote = calculateQuote(payload);
    const gross = numeric(quote.valor_frete_bruto);
    const damage = numeric(payload.valor_avaria) ?? 0;
    if (gross !== null && damage > gross) {
      throw new Error("A avaria não pode superar o frete calculado.");
    }

    const kmInitial = numeric(payload.km_inicial);
    const kmFinal = numeric(payload.km_final);
    const kmRun = numeric(payload.km_rodado)
      ?? (kmInitial !== null && kmFinal !== null ? kmFinal - kmInitial : null);
    const current = readFreights();
    const record: FreightResponse = {
      id_frete: Math.max(0, ...current.map((item) => item.id_frete)) + 1,
      codigo_frete: crypto.randomUUID(),
      id_agregado: aggregate.id_agregado,
      nome_agregado: aggregate.nome,
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
      codigo_zona_jit: payload.codigo_zona_jit ?? null,
      adicionais_jit: payload.adicionais_jit ?? [],
      valor_frete_bruto: gross === null ? null : moneyText(gross),
      valor_avaria: moneyText(damage),
      valor_frete_pago: gross === null ? null : moneyText(gross - damage),
      percentual_frete: quote.percentual_frete,
      status_calculo: quote.status_calculo,
      motivo_pendencia: quote.motivo_pendencia,
      detalhe_calculo: quote.detalhe_calculo,
      criado_por: 7,
      criado_em: new Date().toISOString(),
    };
    saveFreights([record, ...current]);
    return record;
  },

  async list(filters: FreightHistoryFilters = {}): Promise<FreightPage> {
    await pause();
    const filtered = readFreights()
      .filter((item) => dateInRange(item.data_servico, filters.data_de, filters.data_ate))
      .filter((item) => !filters.status_calculo || filters.status_calculo === "TODOS" || item.status_calculo === filters.status_calculo)
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

  async paymentReport(filters: AggregatePaymentFilters): Promise<FreightPaymentReport> {
    await pause();
    ensureValidPeriod(filters);
    const records = readFreights().filter((item) => dateInRange(item.data_servico, filters.data_de, filters.data_ate));
    const aggregates = new Map(readAggregates().map((item) => [item.id_agregado, item]));
    const grouped = new Map<number, AggregatePaymentSummary>();
    let grossTotal = 0;
    let damageTotal = 0;
    let netTotal = 0;
    let pendingTotal = 0;

    for (const freight of records) {
      const aggregate = aggregates.get(freight.id_agregado);
      if (!aggregate) continue;
      let summary = grouped.get(aggregate.id_agregado);
      if (!summary) {
        summary = {
          id_agregado: aggregate.id_agregado,
          nome_agregado: aggregate.nome,
          cpf_pendente: aggregate.cpf === null,
          quantidade_fretes: 0,
          quantidade_pendentes: 0,
          valor_frete_bruto: "0.00",
          valor_avarias: "0.00",
          valor_a_pagar: "0.00",
        };
        grouped.set(aggregate.id_agregado, summary);
      }
      summary.quantidade_fretes += 1;
      if (freight.status_calculo !== "CALCULADO" || freight.valor_frete_pago === null) {
        summary.quantidade_pendentes += 1;
        pendingTotal += 1;
        continue;
      }
      const gross = numeric(freight.valor_frete_bruto) ?? 0;
      const damage = numeric(freight.valor_avaria) ?? 0;
      const net = numeric(freight.valor_frete_pago) ?? 0;
      summary.valor_frete_bruto = moneyText((numeric(summary.valor_frete_bruto) ?? 0) + gross);
      summary.valor_avarias = moneyText((numeric(summary.valor_avarias) ?? 0) + damage);
      summary.valor_a_pagar = moneyText((numeric(summary.valor_a_pagar) ?? 0) + net);
      grossTotal += gross;
      damageTotal += damage;
      netTotal += net;
    }

    return {
      data_de: filters.data_de,
      data_ate: filters.data_ate,
      items: [...grouped.values()].sort((a, b) => a.nome_agregado.localeCompare(b.nome_agregado, "pt-BR")),
      quantidade_fretes: records.length,
      quantidade_pendentes: pendingTotal,
      valor_frete_bruto: moneyText(grossTotal),
      valor_avarias: moneyText(damageTotal),
      valor_a_pagar: moneyText(netTotal),
    };
  },

  async exportPaymentReport(filters: AggregatePaymentFilters): Promise<Blob> {
    const report = await this.paymentReport(filters);
    if (report.quantidade_pendentes) {
      throw new Error("Resolva os fretes pendentes de conferência antes de exportar o pagamento.");
    }

    const aggregates = new Map(readAggregates().map((item) => [item.id_agregado, item]));
    const missingCpf = report.items.filter((item) => !aggregates.get(item.id_agregado)?.cpf);
    if (missingCpf.length) {
      throw new Error(`Cadastre o CPF dos agregados antes de exportar: ${missingCpf.map((item) => item.nome_agregado).join(", ")}`);
    }

    const rows: string[][] = [["Data", "Nome", "CPF", "Motivo", "Setor", "Valor Total", "Observações"]];
    for (const item of report.items) {
      const aggregate = aggregates.get(item.id_agregado)!;
      rows.push([
        brazilianDate(filters.data_ate),
        aggregate.nome,
        aggregate.cpf!,
        `FRETES DO PERÍODO ${brazilianDate(filters.data_de)} A ${brazilianDate(filters.data_ate)}`,
        "TRANSPORTE",
        (numeric(item.valor_a_pagar) ?? 0).toFixed(2).replace(".", ","),
        `${item.quantidade_fretes} frete(s); bruto ${(numeric(item.valor_frete_bruto) ?? 0).toFixed(2)}; avarias ${(numeric(item.valor_avarias) ?? 0).toFixed(2)}`,
      ]);
    }
    rows.push(["", "TOTAL GERAL", "", "", "TRANSPORTE", (numeric(report.valor_a_pagar) ?? 0).toFixed(2).replace(".", ","), ""]);
    const csv = `\uFEFF${rows.map((row) => row.map((cell, index) => csvCell(cell, index === 1)).join(";")).join("\r\n")}`;
    return new Blob([csv], { type: "text/csv;charset=utf-8" });
  },
};
