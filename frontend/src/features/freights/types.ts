/** Tipos compartilhados pelas telas e chamadas da API de Fretes. */

/** Valores decimais podem chegar como texto pela serialização do Pydantic. */
export type DecimalValue = string | number;

/** Situação retornada pelo motor de cálculo de tarifas. */
export type FreightStatus = "CALCULADO" | "PENDENTE_CONFERENCIA";

/** Modalidade informada no lançamento; independe da fonte tarifária. */
export type FreightTransportType = "AGREGADO" | "TRANSPORTADORA";
/** Modalidades antigas continuam legíveis no histórico, mas não podem ser lançadas. */
export type FreightRecordedTransportType = FreightTransportType | "PROPRIO";
export type FreightPaymentTransportType = "AGREGADO" | "TRANSPORTADORA";

/** Planilhas de origem disponíveis no lançamento. */
export type FreightTariffSource = "AGREGADOS_CD" | "JUST_IN_TIME" | "PAULO_CRUZ";
export type FreightCarrierSource = Extract<FreightTariffSource, "JUST_IN_TIME" | "PAULO_CRUZ">;

/** Veículos tarifados pela tabela Paulo Cruz. */
export type FreightTruckType =
  | "SAVEIRO"
  | "KIA_BONGO"
  | "CAMINHAO_3_4"
  | "CAMINHAO_TOCO";

/** Opção simples de catálogo retornada pela API. */
export type FreightCatalogOption = {
  codigo: string;
  nome: string;
};

export type FreightAggregateDriverOption = {
  id_motorista: number;
  nome_motorista: string;
};

/** Motorista e transportadora independente escolhidos como uma única opção. */
export type FreightCarrierDriverOption = {
  id_motorista: number;
  nome_motorista: string;
  codigo_transportadora: FreightCarrierSource;
  nome_transportadora: string;
};

export type HistoricalFreightEditDriverOption = {
  id_motorista: number;
  nome_motorista: string;
  tipo_transporte: FreightTransportType;
  codigo_transportadora: FreightCarrierSource | null;
  nome_transportadora: string | null;
};

export type FreightDeliverySummary = {
  id_motorista: number;
  data_servico: string;
  rota_cidade: string;
  cidades: string[];
  quantidade_entregas: number;
  quantidade_avarias: number;
  quantidade_registros: number;
  peso_total_kg: DecimalValue | null;
};

/** Subzona tarifária JUST IN TIME com as áreas atendidas. */
export type JustInTimeZoneOption = FreightCatalogOption & {
  areas: string;
};

/** Região selecionável da JUST IN TIME e respectivas subzonas da planilha. */
export type JustInTimeRegionOption = FreightCatalogOption & {
  subzonas: JustInTimeZoneOption[];
};

/** Estrutura de GET /freights/tariff-options. */
export type FreightTariffOptions = {
  fontes: FreightCatalogOption[];
  rotas_agregados_cd: FreightCatalogOption[];
  zonas_just_in_time: JustInTimeRegionOption[];
  adicionais_just_in_time: FreightCatalogOption[];
  tipos_caminhao_paulo_cruz: FreightCatalogOption[];
  retrato_tarifas_em: string;
  hash_retrato_tarifas: string;
};

/** Campos enviados para simular ou registrar um frete. */
export type FreightInput = {
  data_servico: string;
  tipo_transporte: FreightTransportType;
  nome_transportador: string | null;
  id_motorista_agregado: number | null;
  id_motorista_transportadora: number | null;
  codigo_fonte_tarifa: FreightTariffSource | null;
  rota_cidade: string;
  km_inicial: DecimalValue | null;
  km_final: DecimalValue | null;
  quantidade_entregas: number;
  peso_kg: DecimalValue;
  valor_nota?: DecimalValue | null;
  valor_avaria?: DecimalValue;
  quantidade_avarias: number;
  codigo_zona_jit?: string | null;
  adicionais_jit?: string[];
  tipo_caminhao?: FreightTruckType | null;
};

/** Campos editáveis de um frete histórico, sem recálculo de tarifa. */
export type HistoricalFreightEditInput = {
  data_servico: string;
  id_motorista_selecionado: number | null;
  complementar_com_entregas: boolean;
  nome_transportador: string | null;
  rota_cidade: string | null;
  km_inicial: DecimalValue | null;
  km_final: DecimalValue | null;
  km_rodado: DecimalValue | null;
  quantidade_entregas: number | null;
  peso_kg: DecimalValue | null;
  valor_nota: DecimalValue | null;
  valor_frete_bruto: DecimalValue | null;
  valor_frete_pago: DecimalValue | null;
  percentual_frete: DecimalValue | null;
  valor_avaria: DecimalValue;
};

/** Linha histórica validada antes de ser enviada para importação em lote. */
export type HistoricalFreightImportItem = {
  linha_planilha: number;
  data_servico: string;
  data_servico_planilha: string | null;
  data_servico_ano_inferido: boolean;
  nome_transportador: string | null;
  rota_cidade: string | null;
  km_inicial: DecimalValue | null;
  km_final: DecimalValue | null;
  km_rodado: DecimalValue | null;
  quantidade_entregas: number | null;
  peso_kg: DecimalValue | null;
  valor_nota: DecimalValue | null;
  valor_frete_bruto: DecimalValue | null;
  valor_frete_pago: DecimalValue | null;
  percentual_frete: DecimalValue | null;
  percentual_frete_planilha: string | null;
  valores_originais_planilha: Record<string, string | null>;
  valor_avaria: DecimalValue;
};

export type HistoricalFreightImportRequest = {
  nome_arquivo: string;
  sha256_arquivo: string;
  aba_origem: string;
  itens: HistoricalFreightImportItem[];
};

export type HistoricalFreightImportResponse = {
  importados: number;
  atualizados: number;
  ja_existentes: number;
  vinculados_agregados: number;
  vinculados_transportadoras: number;
  sem_vinculo: number;
};

/** Resultado da cotação sem persistência do lançamento. */
export type FreightQuoteResponse = {
  status_calculo: FreightStatus;
  valor_frete_bruto: DecimalValue | null;
  percentual_frete: DecimalValue | null;
  motivo_pendencia: string | null;
  detalhe_calculo: Record<string, unknown>;
};

/** Lançamento persistido retornado pelo histórico e pela criação. */
export type FreightResponse = {
  id_frete: number;
  codigo_frete: string;
  tipo_transporte: FreightRecordedTransportType;
  nome_transportador: string | null;
  id_motorista_agregado: number | null;
  id_motorista_transportadora: number | null;
  nome_motorista_transportadora: string | null;
  codigo_fonte_tarifa: FreightTariffSource | null;
  data_servico: string;
  rota_cidade: string | null;
  km_inicial: DecimalValue | null;
  km_final: DecimalValue | null;
  km_rodado: DecimalValue | null;
  quantidade_entregas: number | null;
  peso_kg: DecimalValue | null;
  valor_nota: DecimalValue | null;
  tipo_caminhao: FreightTruckType | null;
  codigo_zona_jit: string | null;
  adicionais_jit: string[];
  valor_frete_bruto: DecimalValue | null;
  valor_avaria: DecimalValue;
  quantidade_avarias: number;
  valor_frete_pago: DecimalValue | null;
  percentual_frete: DecimalValue | null;
  status_calculo: FreightStatus;
  motivo_pendencia: string | null;
  detalhe_calculo: Record<string, unknown>;
  criado_por: number;
  criado_em: string;
  cancelado: boolean;
  cancelado_em: string | null;
  cancelado_por: number | null;
  justificativa_cancelamento: string | null;
};

/** Resultado paginado da consulta de lançamentos. */
export type FreightPage = {
  items: FreightResponse[];
  total: number;
  limit: number;
  offset: number;
};

/** Filtros aceitos pela tela de histórico. */
export type FreightHistoryFilters = {
  data_de?: string;
  data_ate?: string;
  tipo_transporte?: FreightRecordedTransportType | "TODOS";
  status_calculo?: FreightStatus | "TODOS";
  id_motorista?: number;
  rota_cidade?: string;
  codigo_transportadora?: FreightCarrierSource;
  limit?: number;
  offset?: number;
};

/** Listas disponíveis nos filtros de motorista e rota do histórico. */
export type FreightHistoryFilterOptions = {
  motoristas: Array<{ id_motorista: number; nome_motorista: string }>;
  rotas: string[];
  possui_sem_motorista: boolean;
};

/** Resposta de GET /freights/payments/report. */
export type FreightPaymentReport = {
  data_de: string;
  data_ate: string;
  tipo_transporte: FreightPaymentTransportType;
  nome_transportador: string | null;
  sem_identificacao: boolean;
  quantidade_fretes: number;
  quantidade_pendentes: number;
  valor_frete_bruto: DecimalValue;
  valor_avarias: DecimalValue;
  valor_a_pagar: DecimalValue;
};

/** Filtros comuns à consulta e à exportação do relatório financeiro. */
export type FreightPaymentFilters = {
  data_de: string;
  data_ate: string;
  tipo_transporte: FreightPaymentTransportType;
  nome_transportador?: string;
  sem_identificacao?: boolean;
};

/** Responsáveis encontrados no período para os filtros de pagamento. */
export type FreightPaymentOptions = {
  agregados: string[];
  transportadoras: string[];
  agregados_sem_identificacao: boolean;
};
