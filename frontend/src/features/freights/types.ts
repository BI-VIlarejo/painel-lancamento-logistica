/** Tipos compartilhados pelas telas e chamadas da API de Fretes. */

/** Valores decimais podem chegar como texto pela serialização do Pydantic. */
export type DecimalValue = string | number;

/** Situação retornada pelo motor de cálculo de tarifas. */
export type FreightStatus = "CALCULADO" | "PENDENTE_CONFERENCIA";

/** Planilhas de origem disponíveis no lançamento. */
export type FreightTariffSource = "AGREGADOS_CD" | "JUST_IN_TIME" | "PAULO_CRUZ";

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

/** Zona JUST IN TIME com a relação de áreas atendidas. */
export type JustInTimeZoneOption = FreightCatalogOption & {
  areas: string;
};

/** Estrutura de GET /freights/tariff-options. */
export type FreightTariffOptions = {
  fontes: FreightCatalogOption[];
  rotas_agregados_cd: FreightCatalogOption[];
  zonas_just_in_time: JustInTimeZoneOption[];
  adicionais_just_in_time: FreightCatalogOption[];
  tipos_caminhao_paulo_cruz: FreightCatalogOption[];
  retrato_tarifas_em: string;
  hash_retrato_tarifas: string;
};

/** Corpo usado para cadastrar um agregado recebedor de pagamentos. */
export type AggregateCreateRequest = {
  nome: string;
  cpf?: string | null;
};

/** Agregado retornado pela API, sem CPF. */
export type AggregateResponse = {
  id_agregado: number;
  codigo_agregado: string;
  nome: string;
  ativo: boolean;
  criado_em: string;
};

/** Campos enviados para simular ou registrar um frete. */
export type FreightInput = {
  data_servico: string;
  id_agregado: number;
  codigo_fonte_tarifa: FreightTariffSource;
  rota_cidade: string;
  km_inicial?: DecimalValue | null;
  km_final?: DecimalValue | null;
  km_rodado?: DecimalValue | null;
  quantidade_entregas: number;
  peso_kg: DecimalValue;
  valor_nota?: DecimalValue | null;
  valor_avaria?: DecimalValue;
  codigo_zona_jit?: string | null;
  adicionais_jit?: string[];
  tipo_caminhao?: FreightTruckType | null;
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
  id_agregado: number;
  nome_agregado: string;
  codigo_fonte_tarifa: FreightTariffSource;
  data_servico: string;
  rota_cidade: string;
  km_inicial: DecimalValue | null;
  km_final: DecimalValue | null;
  km_rodado: DecimalValue | null;
  quantidade_entregas: number;
  peso_kg: DecimalValue;
  valor_nota: DecimalValue | null;
  tipo_caminhao: FreightTruckType | null;
  codigo_zona_jit: string | null;
  adicionais_jit: string[];
  valor_frete_bruto: DecimalValue | null;
  valor_avaria: DecimalValue;
  valor_frete_pago: DecimalValue | null;
  percentual_frete: DecimalValue | null;
  status_calculo: FreightStatus;
  motivo_pendencia: string | null;
  detalhe_calculo: Record<string, unknown>;
  criado_por: number;
  criado_em: string;
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
  status_calculo?: FreightStatus | "TODOS";
  limit?: number;
  offset?: number;
};

/** Totais do período para um agregado no relatório financeiro. */
export type AggregatePaymentSummary = {
  id_agregado: number;
  nome_agregado: string;
  cpf_pendente: boolean;
  quantidade_fretes: number;
  quantidade_pendentes: number;
  valor_frete_bruto: DecimalValue;
  valor_avarias: DecimalValue;
  valor_a_pagar: DecimalValue;
};

/** Resposta de GET /freights/payments/report. */
export type FreightPaymentReport = {
  data_de: string;
  data_ate: string;
  items: AggregatePaymentSummary[];
  quantidade_fretes: number;
  quantidade_pendentes: number;
  valor_frete_bruto: DecimalValue;
  valor_avarias: DecimalValue;
  valor_a_pagar: DecimalValue;
};

/** Filtros comuns à consulta e à exportação do relatório financeiro. */
export type AggregatePaymentFilters = {
  data_de: string;
  data_ate: string;
};
