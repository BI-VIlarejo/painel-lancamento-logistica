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
  valor_frete_bruto?: DecimalValue | null;
  valor_avaria?: DecimalValue;
  quantidade_avarias: number;
  nome_cliente?: string | null;
  codigo_cliente?: string | null;
  observacao?: string | null;
  codigo_zona_jit?: string | null;
  codigos_zonas_jit?: string[];
  adicionais_jit?: string[];
  tipo_caminhao?: FreightTruckType | null;
  carro_apoio?: "SAVEIRO" | "KIA_BONGO" | null;
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
  codigo_zona_jit: string | null;
  adicionais_jit: string[];
  tipo_caminhao: FreightTruckType | null;
  carro_apoio: "SAVEIRO" | "KIA_BONGO" | null;
  nome_cliente?: string | null;
  codigo_cliente?: string | null;
  observacao?: string | null;
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
  valor_frete_pago: DecimalValue | null;
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
  carro_apoio?: "SAVEIRO" | "KIA_BONGO" | null;
  nome_cliente?: string | null;
  codigo_cliente?: string | null;
  observacao?: string | null;
  codigo_zona_jit: string | null;
  codigos_zonas_jit?: string[];
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

export type PaymentSettlementStatus = "SOLICITADO" | "PAGO" | "ESTORNADO";
export type PaymentResponsibleStatus =
  | "PENDENTE_CONFERENCIA"
  | "A_PAGAR"
  | "PARCIAL"
  | "SOLICITADO"
  | "PAGO";
export type PaymentFreightState = "EM_ABERTO" | "SOLICITADO" | "PAGO";
export type PaymentAdjustmentNature = "ACRESCIMO" | "DESCONTO";
export type PaymentAdjustmentCategory =
  | "VALE"
  | "ADIANTAMENTO"
  | "BONUS"
  | "PEDAGIO"
  | "DESCONTO"
  | "OUTRO";
export type PaymentInstallmentFrequency = "SEMANAL" | "MENSAL";

export type FreightPaymentAdjustmentItem = {
  codigo_ajuste: string;
  tipo_transporte: FreightPaymentTransportType;
  nome_transportador: string;
  id_pessoa_responsavel: number | null;
  data_referencia: string;
  natureza: PaymentAdjustmentNature;
  categoria: PaymentAdjustmentCategory;
  descricao: string;
  valor: DecimalValue;
  observacao: string | null;
  vinculado_pagamento: boolean;
  codigo_pagamento: string | null;
  status_pagamento: PaymentSettlementStatus | null;
  criado_em: string;
  criado_por_nome: string | null;
};

export type FreightPaymentAdjustmentCreateInput = {
  tipo_transporte: FreightPaymentTransportType;
  nome_transportador: string;
  data_referencia: string;
  natureza: PaymentAdjustmentNature;
  categoria: PaymentAdjustmentCategory;
  descricao: string;
  valor: DecimalValue;
  parcelas: number;
  periodicidade: PaymentInstallmentFrequency;
  observacao?: string | null;
};

export type FreightPaymentFreightDetail = {
  id_frete: number;
  codigo_frete: string;
  data_servico: string;
  rota_cidade: string | null;
  nome_motorista_transportadora: string | null;
  quantidade_entregas: number | null;
  peso_kg: DecimalValue | null;
  valor_nota: DecimalValue | null;
  valor_frete_bruto: DecimalValue | null;
  valor_avaria: DecimalValue;
  valor_frete_pago: DecimalValue | null;
  pronto_para_pagamento: boolean;
  motivo_pendencia: string | null;
  status_pagamento_frete: PaymentFreightState;
  codigo_pagamento: string | null;
  data_pagamento: string | null;
  valor_divergente: boolean;
};

export type FreightPaymentSettlementSummary = {
  codigo_pagamento: string;
  tipo_transporte: FreightPaymentTransportType;
  nome_transportador: string;
  sem_identificacao: boolean;
  id_pessoa_responsavel: number | null;
  documento_fiscal: string | null;
  chave_pix: string | null;
  exige_nota_fiscal: boolean;
  data_de: string;
  data_ate: string;
  status_pagamento: PaymentSettlementStatus;
  quantidade_fretes: number;
  quantidade_dias: number;
  valor_frete_bruto: DecimalValue;
  valor_avarias: DecimalValue;
  valor_ajustes: DecimalValue;
  valor_liquido_registrado: DecimalValue;
  data_pagamento: string | null;
  nf_numero: string | null;
  nf_data: string | null;
  nf_recebida: boolean;
  observacao: string | null;
  criado_em: string;
  criado_por_nome: string | null;
  pago_em: string | null;
  pago_por_nome: string | null;
  estornado_em: string | null;
  estornado_por_nome: string | null;
  motivo_estorno: string | null;
  possui_alteracao: boolean;
  motivo_alteracao: string | null;
};

export type FreightPaymentSettlementPage = {
  items: FreightPaymentSettlementSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type FreightPaymentResponsibleSummary = {
  chave_responsavel: string;
  nome_transportador: string;
  sem_identificacao: boolean;
  id_pessoa_responsavel: number | null;
  documento_fiscal: string | null;
  chave_pix: string | null;
  exige_nota_fiscal: boolean;
  quantidade_fretes: number;
  quantidade_fretes_prontos: number;
  quantidade_fretes_pendentes: number;
  quantidade_fretes_pagos: number;
  quantidade_fretes_solicitados: number;
  quantidade_fretes_em_aberto: number;
  quantidade_dias: number;
  valor_frete_bruto: DecimalValue;
  valor_avarias: DecimalValue;
  valor_ajustes_acrescimos: DecimalValue;
  valor_ajustes_descontos: DecimalValue;
  valor_ajustes_liquido: DecimalValue;
  valor_liquido_total: DecimalValue;
  valor_pago: DecimalValue;
  valor_solicitado: DecimalValue;
  valor_em_aberto: DecimalValue;
  status_pagamento: PaymentResponsibleStatus;
  possui_alteracao: boolean;
  motivo_alteracao: string | null;
  data_pagamento_mais_recente: string | null;
  nf_pendente: boolean;
  ultimo_pagamento: FreightPaymentSettlementSummary | null;
  pagamentos: FreightPaymentSettlementSummary[];
  fretes: FreightPaymentFreightDetail[];
  ajustes: FreightPaymentAdjustmentItem[];
};

export type FreightPaymentExecutionSummary = {
  total_responsaveis: number;
  responsaveis_pagos: number;
  responsaveis_solicitados: number;
  responsaveis_parciais: number;
  responsaveis_em_aberto: number;
  responsaveis_com_pendencia: number;
  responsaveis_com_alteracao: number;
  nf_pendentes: number;
  valor_pago: DecimalValue;
  valor_solicitado: DecimalValue;
  valor_em_aberto: DecimalValue;
  valor_ajustes: DecimalValue;
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
  pendencias?: Array<{
    codigo_frete: string;
    data_servico: string;
    nome_transportador: string | null;
    rota_cidade: string | null;
    valor_frete_bruto: DecimalValue | null;
    valor_avaria: DecimalValue;
    valor_frete_pago: DecimalValue | null;
    motivo_pendencia: string;
  }>;
  avisos?: Array<{
    codigo_frete: string;
    data_servico: string;
    nome_transportador: string | null;
    rota_cidade: string | null;
    campos_ausentes: string[];
    motivo_aviso: string;
  }>;
  valor_frete_bruto: DecimalValue;
  valor_avarias: DecimalValue;
  valor_a_pagar: DecimalValue;
  resumo_execucao?: FreightPaymentExecutionSummary;
  responsaveis?: FreightPaymentResponsibleSummary[];
  ajustes?: FreightPaymentAdjustmentItem[];
};

/** Filtros comuns à consulta e à exportação do relatório financeiro. */
export type FreightPaymentFilters = {
  data_de: string;
  data_ate: string;
  tipo_transporte: FreightPaymentTransportType;
  nome_transportador?: string;
  sem_identificacao?: boolean;
  responsaveis?: string[];
  apenas_em_aberto?: boolean;
  codigo_pagamento?: string;
};

export type FreightPaymentSettlementCreateInput = {
  data_de: string;
  data_ate: string;
  tipo_transporte: FreightPaymentTransportType;
  acao: "SOLICITAR" | "MARCAR_PAGO";
  responsaveis?: string[];
  sem_identificacao?: boolean;
  data_pagamento?: string | null;
  observacao?: string | null;
  incluir_solicitados?: boolean;
  nf_numero?: string | null;
  nf_data?: string | null;
  nf_recebida?: boolean;
};

export type FreightPaymentSettlementStatusInput = {
  acao: "MARCAR_PAGO" | "DESFAZER_PAGO" | "ESTORNAR";
  data_pagamento?: string | null;
  observacao?: string | null;
  motivo_estorno?: string | null;
};

export type FreightPaymentInvoiceUpdateInput = {
  nf_numero: string | null;
  nf_data: string | null;
  nf_recebida: boolean;
};

export type FreightPaymentSettlementHistoryFilters = {
  data_de?: string;
  data_ate?: string;
  tipo_transporte?: FreightPaymentTransportType;
  status_pagamento?: PaymentSettlementStatus;
  nome_transportador?: string;
  incluir_estornados?: boolean;
  limit?: number;
  offset?: number;
};

export type FreightPaymentPendingSummary = {
  semana_de: string;
  semana_ate: string;
  responsaveis_em_aberto: number;
  responsaveis_com_pendencia: number;
  nf_pendentes: number;
  valor_em_aberto: DecimalValue;
};

/** Responsáveis encontrados no período para os filtros de pagamento. */
export type FreightPaymentOptions = {
  agregados: string[];
  transportadoras: string[];
  agregados_sem_identificacao: boolean;
};
