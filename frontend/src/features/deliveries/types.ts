import type { DeliveryTransportType, NonDeliveryReasonGroup } from "./classifications";

export type DeliveryStatus =
  | "RASCUNHO"
  | "ENVIADA"
  | "EM_REVISAO"
  | "DEVOLVIDA"
  | "APROVADA"
  | "CANCELADA";

export type SectorCatalogItem = { id_setor: number; codigo: string; nome: string };
export type LocalityCatalogItem = {
  id_localidade: number;
  codigo_localidade: string;
  nome_localidade: string;
  tipo_localidade: string;
};
export type PersonCatalogItem = {
  id_pessoa: number;
  nome_exibicao: string;
  tipo_funcao: string;
  tipo_transporte_entrega: DeliveryTransportType | null;
};
export type NonDeliveryReasonCatalogItem = {
  id_motivo_nao_entrega: number;
  codigo_motivo: string;
  descricao_motivo: string;
  grupo_motivo: NonDeliveryReasonGroup | null;
};

export type CatalogPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type DeliveryParticipantInput = {
  id_pessoa: number;
  papel_participante: "MOTORISTA" | "AJUDANTE";
};
export type DeliveryReasonInput = {
  id_motivo_nao_entrega: number;
  tipo_operacao: "ENTREGA" | "COLETA";
  observacao?: string | null;
};
export type DeliveryItemInput = {
  codigo_item_lancamento?: string;
  /** Legacy discriminator accepted while an old form tab is still open. */
  tipo_operacao?: "ENTREGA" | "COLETA";
  data_entrega: string;
  id_localidade: number;
  quantidade_realizada: number;
  quantidade_nao_realizada: number;
  quantidade_coleta_realizada: number;
  quantidade_coleta_nao_realizada: number;
  participantes: DeliveryParticipantInput[];
  motivos: DeliveryReasonInput[];
};
export type DeliveryDraftRequest = { itens: DeliveryItemInput[] };
export type DeliveryDraftUpdateRequest = { itens: DeliveryItemInput[] };

export type DeliveryParticipantResponse = DeliveryParticipantInput & {
  codigo_pessoa: string;
  nome_exibicao: string;
  ordem: number;
  tipo_transporte_entrega: DeliveryTransportType | null;
};
export type DeliveryReasonResponse = DeliveryReasonInput & {
  quantidade: number;
  codigo_motivo: string;
  descricao_motivo: string;
  grupo_motivo: NonDeliveryReasonGroup | null;
  observacao: string | null;
};
export type DeliveryItemResponse = Omit<DeliveryItemInput, "participantes" | "motivos"> & {
  codigo_item_lancamento: string;
  /** Present only in responses from the previous API version. */
  tipo_operacao?: "ENTREGA" | "COLETA";
  nome_localidade: string;
  codigo_localidade: string;
  observacao: string | null;
  participantes: DeliveryParticipantResponse[];
  motivos: DeliveryReasonResponse[];
};
export type DeliveryLaunchDetail = {
  codigo_lancamento: string;
  id_setor: number;
  codigo_setor: string;
  nome_setor: string;
  codigo_revisao: string;
  numero_revisao: number;
  estado: DeliveryStatus;
  criado_por: number;
  criado_em: string;
  atualizado_em: string;
  itens: DeliveryItemResponse[];
};
export type DeliveryLaunchSummary = {
  codigo_lancamento: string;
  id_setor: number;
  codigo_setor: string;
  nome_setor: string;
  codigo_revisao: string;
  numero_revisao: number;
  estado: DeliveryStatus;
  criado_por: number;
  criado_em: string;
  atualizado_em: string;
  data_inicial: string;
  data_final: string;
  quantidade_itens: number;
  quantidade_realizada: number;
  quantidade_nao_realizada: number;
  quantidade_coleta_realizada?: number;
  quantidade_coleta_nao_realizada?: number;
  entregas_realizadas: number;
  entregas_nao_realizadas: number;
  coletas_realizadas: number;
  coletas_nao_realizadas: number;
  itens: DeliveryItemResponse[];
};
export type DeliveryLaunchPage = {
  items: DeliveryLaunchSummary[];
  total: number;
  limit: number;
  offset: number;
};

export type DeliveryEvent = {
  id_evento: number;
  codigo_revisao: string;
  numero_revisao: number;
  tipo_evento: string;
  estado_anterior: DeliveryStatus | null;
  estado_novo: DeliveryStatus | null;
  ator_usuario_id: number;
  ocorrido_em: string;
  comentario: string | null;
};

export type DeliveryHistoryFilters = {
  estado?: DeliveryStatus | "TODOS" | "LANÇADO";
  data_de?: string;
  data_ate?: string;
  id_localidade?: number;
  id_motorista?: number;
  id_motivo_nao_entrega?: number;
  tipo_operacao?: "ENTREGA" | "COLETA";
  criado_por?: number;
  limit?: number;
  offset?: number;
};
