import type { AuthenticatedUser, MeResponse } from "../auth/types";
import type {
  CatalogPage,
  DeliveryDraftRequest,
  DeliveryDraftUpdateRequest,
  DeliveryEvent,
  DeliveryHistoryFilters,
  DeliveryItemResponse,
  DeliveryLaunchDetail,
  DeliveryLaunchPage,
  DeliveryLaunchSummary,
  DeliveryStatus,
  LocalityCatalogItem,
  NonDeliveryReasonCatalogItem,
  PersonCatalogItem,
  SectorCatalogItem,
} from "./types";

const DEMO_SESSION_KEY = "lancamento-logistica:demo-session";
const DEMO_HISTORY_KEY = "lancamento-logistica:demo-history";
const DEMO_EVENTS_KEY = "lancamento-logistica:demo-events";

export const demoUser: AuthenticatedUser = {
  id_usuario: 7,
  username: "demonstracao",
  nome_completo: "Camila Oliveira",
  troca_senha_obrigatoria: false,
};

const sectors: SectorCatalogItem[] = [
  { id_setor: 1, codigo: "SUPORTE", nome: "Suporte" },
];
const localities: LocalityCatalogItem[] = [
  { id_localidade: 11, codigo_localidade: "MAC", nome_localidade: "Macaé", tipo_localidade: "LOJA" },
  { id_localidade: 12, codigo_localidade: "CBF", nome_localidade: "Cabo Frio", tipo_localidade: "LOJA" },
  { id_localidade: 13, codigo_localidade: "CPS", nome_localidade: "Campos dos Goytacazes", tipo_localidade: "LOJA" },
  { id_localidade: 14, codigo_localidade: "CD", nome_localidade: "Centro de Distribuição", tipo_localidade: "CD" },
];
const people: PersonCatalogItem[] = [
  { id_pessoa: 21, nome_exibicao: "Rafael Martins", tipo_funcao: "MOTORISTA", tipo_transporte_entrega: "PROPRIA" },
  { id_pessoa: 22, nome_exibicao: "Joana Costa", tipo_funcao: "MOTORISTA", tipo_transporte_entrega: "TERCEIRIZADA" },
  { id_pessoa: 23, nome_exibicao: "Bruno Souza", tipo_funcao: "MOTORISTA", tipo_transporte_entrega: "PROPRIA" },
  { id_pessoa: 31, nome_exibicao: "Marina Alves", tipo_funcao: "AJUDANTE", tipo_transporte_entrega: "PROPRIA" },
  { id_pessoa: 32, nome_exibicao: "Pedro Lima", tipo_funcao: "AJUDANTE", tipo_transporte_entrega: "TERCEIRIZADA" },
  { id_pessoa: 33, nome_exibicao: "Luiz Fernando", tipo_funcao: "AJUDANTE", tipo_transporte_entrega: "PROPRIA" },
];
const reasons: NonDeliveryReasonCatalogItem[] = [
  { id_motivo_nao_entrega: 41, codigo_motivo: "CLIENTE_AUSENTE", descricao_motivo: "Cliente ausente", grupo_motivo: "LOJA" },
  { id_motivo_nao_entrega: 42, codigo_motivo: "ENDERECO_INCORRETO", descricao_motivo: "Endereço incorreto", grupo_motivo: "LOJA" },
  { id_motivo_nao_entrega: 43, codigo_motivo: "AVARIA", descricao_motivo: "Produto avariado", grupo_motivo: "TRANSPORTE_PROPRIO" },
  { id_motivo_nao_entrega: 44, codigo_motivo: "VEICULO", descricao_motivo: "Imprevisto com veículo", grupo_motivo: "TRANSPORTE_PROPRIO" },
];

const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 140));
const uuid = () => crypto.randomUUID();
const dateOffset = (daysAgo: number) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function asPage<T>(items: T[]): CatalogPage<T> {
  return { items, total: items.length, limit: 100, offset: 0 };
}

function personName(id: number): string {
  return people.find((person) => person.id_pessoa === id)?.nome_exibicao ?? "Pessoa de demonstração";
}

function makeItem(
  idLocalidade: number,
  daysAgo: number,
  completed: number,
  notCompleted: number,
  driverId: number,
  helperId: number,
  reasonId: number,
): DeliveryItemResponse {
  const locality = localities.find((item) => item.id_localidade === idLocalidade) ?? localities[0];
  const reason = reasons.find((item) => item.id_motivo_nao_entrega === reasonId) ?? reasons[0];
  return {
    codigo_item_lancamento: uuid(),
    data_entrega: dateOffset(daysAgo),
    id_localidade: idLocalidade,
    codigo_localidade: locality.codigo_localidade,
    nome_localidade: locality.nome_localidade,
    quantidade_realizada: completed,
    quantidade_nao_realizada: notCompleted,
    observacao: null,
    participantes: [
      { id_pessoa: driverId, codigo_pessoa: uuid(), nome_exibicao: personName(driverId), papel_participante: "MOTORISTA", ordem: 1, tipo_transporte_entrega: people.find((person) => person.id_pessoa === driverId)?.tipo_transporte_entrega ?? null },
      { id_pessoa: helperId, codigo_pessoa: uuid(), nome_exibicao: personName(helperId), papel_participante: "AJUDANTE", ordem: 2, tipo_transporte_entrega: people.find((person) => person.id_pessoa === helperId)?.tipo_transporte_entrega ?? null },
    ],
    motivos: notCompleted > 0
      ? [{ id_motivo_nao_entrega: reasonId, quantidade: notCompleted, observacao: null, codigo_motivo: reason.codigo_motivo, descricao_motivo: reason.descricao_motivo, grupo_motivo: reason.grupo_motivo }]
      : [],
  };
}

function makeLaunch(status: DeliveryStatus, daysAgo: number, localityId: number, done: number, failed: number, creatorId = demoUser.id_usuario): DeliveryLaunchDetail {
  const now = new Date();
  now.setDate(now.getDate() - daysAgo);
  const created = now.toISOString();
  const item = makeItem(localityId, daysAgo, done, failed, 21, 31, 41);
  return {
    codigo_lancamento: uuid(),
    id_setor: 1,
    codigo_setor: "SUPORTE",
    nome_setor: "Suporte",
    codigo_revisao: uuid(),
    numero_revisao: 1,
    estado: status,
    criado_por: creatorId,
    criado_em: created,
    atualizado_em: created,
    itens: [item],
  };
}

function initialHistory(): DeliveryLaunchDetail[] {
  return [
    makeLaunch("ENVIADA", 0, 11, 48, 3),
    makeLaunch("ENVIADA", 1, 12, 56, 2, 8),
    makeLaunch("ENVIADA", 2, 13, 38, 4),
    makeLaunch("RASCUNHO", 3, 14, 24, 1),
  ];
}

function getHistory(): DeliveryLaunchDetail[] {
  try {
    const stored = window.localStorage.getItem(DEMO_HISTORY_KEY);
    if (stored) return JSON.parse(stored) as DeliveryLaunchDetail[];
  } catch {
    // Dados locais corrompidos só reiniciam a demonstração.
  }
  const seeded = initialHistory();
  window.localStorage.setItem(DEMO_HISTORY_KEY, JSON.stringify(seeded));
  return seeded;
}

function saveHistory(history: DeliveryLaunchDetail[]): void {
  window.localStorage.setItem(DEMO_HISTORY_KEY, JSON.stringify(history));
}

function getEvents(): Record<string, DeliveryEvent[]> {
  try {
    return JSON.parse(window.localStorage.getItem(DEMO_EVENTS_KEY) ?? "{}") as Record<string, DeliveryEvent[]>;
  } catch {
    return {};
  }
}

function addEvent(
  launch: DeliveryLaunchDetail,
  type: string,
  previous: DeliveryEvent["estado_anterior"],
  next: DeliveryEvent["estado_novo"],
  comment: string | null = null,
): void {
  const all = getEvents();
  const items = all[launch.codigo_lancamento] ?? [];
  items.push({
    id_evento: Date.now(),
    codigo_revisao: launch.codigo_revisao,
    numero_revisao: launch.numero_revisao,
    tipo_evento: type,
    estado_anterior: previous,
    estado_novo: next,
    ator_usuario_id: demoUser.id_usuario,
    ocorrido_em: new Date().toISOString(),
    comentario: comment,
  });
  all[launch.codigo_lancamento] = items;
  window.localStorage.setItem(DEMO_EVENTS_KEY, JSON.stringify(all));
}

function summarize(launch: DeliveryLaunchDetail): DeliveryLaunchSummary {
  const dates = launch.itens.map((item) => item.data_entrega).sort();
  return {
    codigo_lancamento: launch.codigo_lancamento,
    id_setor: launch.id_setor,
    codigo_setor: launch.codigo_setor,
    nome_setor: launch.nome_setor,
    codigo_revisao: launch.codigo_revisao,
    numero_revisao: launch.numero_revisao,
    estado: launch.estado,
    criado_por: launch.criado_por,
    criado_em: launch.criado_em,
    atualizado_em: launch.atualizado_em,
    data_inicial: dates[0] ?? launch.criado_em.slice(0, 10),
    data_final: dates.at(-1) ?? launch.criado_em.slice(0, 10),
    quantidade_itens: launch.itens.length,
    quantidade_realizada: launch.itens.reduce((sum, item) => sum + item.quantidade_realizada, 0),
    quantidade_nao_realizada: launch.itens.reduce((sum, item) => sum + item.quantidade_nao_realizada, 0),
    itens: launch.itens,
  };
}

function toResponseItem(item: DeliveryDraftRequest["itens"][number]): DeliveryItemResponse {
  const locality = localities.find((entry) => entry.id_localidade === item.id_localidade) ?? localities[0];
  return {
    ...item,
    codigo_item_lancamento: item.codigo_item_lancamento ?? uuid(),
    codigo_localidade: locality.codigo_localidade,
    nome_localidade: locality.nome_localidade,
    observacao: null,
    participantes: item.participantes.map((participant, index) => ({
      ...participant,
      codigo_pessoa: uuid(),
      nome_exibicao: personName(participant.id_pessoa),
      tipo_transporte_entrega: people.find((person) => person.id_pessoa === participant.id_pessoa)?.tipo_transporte_entrega ?? null,
      ordem: index + 1,
    })),
    motivos: item.motivos.map((entry) => {
      const reason = reasons.find((candidate) => candidate.id_motivo_nao_entrega === entry.id_motivo_nao_entrega) ?? reasons[0];
      return { ...entry, observacao: entry.observacao ?? null, codigo_motivo: reason.codigo_motivo, descricao_motivo: reason.descricao_motivo, grupo_motivo: reason.grupo_motivo };
    }),
  };
}

export const demoApi = {
  async currentUser(): Promise<AuthenticatedUser | null> {
    return window.sessionStorage.getItem(DEMO_SESSION_KEY) === "1" ? demoUser : null;
  },
  async identity(): Promise<MeResponse> {
    return {
      user: demoUser,
      permissions: ["ENTREGAS_DIARIAS:VER", "ENTREGAS_DIARIAS:CRIAR", "ENTREGAS_DIARIAS:EDITAR_RASCUNHO", "ENTREGAS_DIARIAS:CORRIGIR", "ENTREGAS_DIARIAS:CANCELAR", "FEEDBACK_CLIENTES:ACESSAR", "FEEDBACK_CLIENTES:VER", "FEEDBACK_CLIENTES:CRIAR", "FEEDBACK_CLIENTES:EXPORTAR", "PAINEL_GERENCIAL:ACESSAR", "AUDITORIA:VER", "CADASTROS:ADMINISTRAR", "CONTROLE_ACESSO:ADMINISTRAR"],
      scopes: [],
    };
  },
  async login(): Promise<AuthenticatedUser> {
    await pause();
    window.sessionStorage.setItem(DEMO_SESSION_KEY, "1");
    return demoUser;
  },
  async logout(): Promise<void> {
    window.sessionStorage.removeItem(DEMO_SESSION_KEY);
  },
  async listSectors(): Promise<CatalogPage<SectorCatalogItem>> {
    await pause();
    return asPage(sectors);
  },
  async listLocalities(): Promise<CatalogPage<LocalityCatalogItem>> {
    await pause();
    return asPage(localities);
  },
  async listPeople(role?: "MOTORISTA" | "AJUDANTE"): Promise<CatalogPage<PersonCatalogItem>> {
    await pause();
    return asPage(role ? people.filter((person) => person.tipo_funcao === role) : people);
  },
  async listReasons(): Promise<CatalogPage<NonDeliveryReasonCatalogItem>> {
    await pause();
    return asPage(reasons);
  },
  async listDeliveries(filters: DeliveryHistoryFilters = {}): Promise<DeliveryLaunchPage> {
    await pause();
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const all = getHistory()
      .filter((launch) => filters.criado_por === undefined || launch.criado_por === filters.criado_por)
      .filter((launch) => filters.id_localidade === undefined || launch.itens.some((item) => item.id_localidade === filters.id_localidade))
      .map(summarize)
      .filter((item) => !filters.estado || filters.estado === "TODOS" || item.estado === filters.estado)
      .filter((item) => !filters.data_de || item.data_inicial >= filters.data_de)
      .filter((item) => !filters.data_ate || item.data_final <= filters.data_ate)
      .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    return { items: all.slice(offset, offset + limit), total: all.length, limit, offset };
  },
  async getDelivery(id: string): Promise<DeliveryLaunchDetail | null> {
    await pause();
    return getHistory().find((item) => item.codigo_lancamento === id) ?? null;
  },
  async listDeliveryEvents(id: string): Promise<DeliveryEvent[]> {
    await pause();
    return getEvents()[id] ?? [];
  },
  async createDraft(payload: DeliveryDraftRequest): Promise<DeliveryLaunchDetail> {
    await pause();
    const now = new Date().toISOString();
    const launch: DeliveryLaunchDetail = {
      codigo_lancamento: uuid(),
      id_setor: sectors.find((sector) => sector.codigo === "SUPORTE")?.id_setor ?? 1,
      codigo_setor: "SUPORTE",
      nome_setor: "Suporte",
      codigo_revisao: uuid(),
      numero_revisao: 1,
      estado: "RASCUNHO",
      criado_por: demoUser.id_usuario,
      criado_em: now,
      atualizado_em: now,
      itens: payload.itens.map(toResponseItem),
    };
    saveHistory([launch, ...getHistory()]);
    addEvent(launch, "RASCUNHO_CRIADO", null, "RASCUNHO");
    return launch;
  },
  async updateDraft(id: string, payload: DeliveryDraftUpdateRequest): Promise<DeliveryLaunchDetail> {
    await pause();
    const history = getHistory();
    const index = history.findIndex((item) => item.codigo_lancamento === id);
    if (index < 0) throw new Error("Rascunho não encontrado.");
    const current = history[index];
    if (current.estado !== "RASCUNHO") throw new Error("Somente rascunhos podem ser editados.");
    const updated = { ...current, atualizado_em: new Date().toISOString(), itens: payload.itens.map(toResponseItem) };
    history[index] = updated;
    saveHistory(history);
    addEvent(updated, "RASCUNHO_ATUALIZADO", "RASCUNHO", "RASCUNHO");
    return updated;
  },
  async discardDraft(id: string): Promise<void> {
    await pause();
    const history = getHistory();
    const index = history.findIndex((item) => item.codigo_lancamento === id);
    if (index < 0) throw new Error("Rascunho não encontrado.");
    const current = history[index];
    if (current.estado !== "RASCUNHO") throw new Error("Somente rascunhos podem ser descartados.");
    const discarded = { ...current, estado: "CANCELADA" as const, atualizado_em: new Date().toISOString() };
    history[index] = discarded;
    saveHistory(history);
    addEvent(discarded, "RASCUNHO_DESCARTADO", "RASCUNHO", "CANCELADA");
  },
  async confirmDraft(id: string): Promise<DeliveryLaunchDetail> {
    await pause();
    const history = getHistory();
    const index = history.findIndex((item) => item.codigo_lancamento === id);
    if (index < 0) throw new Error("Rascunho não encontrado.");
    const current = history[index];
    if (current.estado === "ENVIADA") return current;
    if (current.estado !== "RASCUNHO") throw new Error("Somente rascunhos podem ser confirmados como lançamentos.");
    const confirmed = { ...current, estado: "ENVIADA" as const, atualizado_em: new Date().toISOString() };
    history[index] = confirmed;
    saveHistory(history);
    addEvent(confirmed, "RASCUNHO_CONFIRMADO", "RASCUNHO", "ENVIADA");
    return confirmed;
  },
  async startCorrection(id: string, justification: string): Promise<DeliveryLaunchDetail> {
    await pause();
    const history = getHistory();
    const index = history.findIndex((item) => item.codigo_lancamento === id);
    if (index < 0) throw new Error("Lançamento não encontrado.");
    const current = history[index];
    if (current.estado !== "ENVIADA" && current.estado !== "APROVADA") {
      throw new Error("Só é possível corrigir um lançamento confirmado.");
    }
    const draft = {
      ...current,
      codigo_revisao: uuid(),
      numero_revisao: current.numero_revisao + 1,
      estado: "RASCUNHO" as const,
      atualizado_em: new Date().toISOString(),
      itens: current.itens.map((item) => ({ ...item, participantes: [...item.participantes], motivos: [...item.motivos] })),
    };
    history[index] = draft;
    saveHistory(history);
    addEvent(draft, "CORRECAO_INICIADA", current.estado, "RASCUNHO", justification);
    return draft;
  },
  async cancelDelivery(id: string, justification: string): Promise<void> {
    await pause();
    const history = getHistory();
    const index = history.findIndex((item) => item.codigo_lancamento === id);
    if (index < 0) throw new Error("Lançamento não encontrado.");
    const current = history[index];
    const hadConfirmation = current.estado === "ENVIADA" || current.estado === "APROVADA";
    const hasCorrection = (getEvents()[id] ?? []).some((event) => event.tipo_evento === "CORRECAO_INICIADA");
    if (!hadConfirmation && !(current.estado === "RASCUNHO" && hasCorrection)) {
      throw new Error("Somente lançamentos já confirmados podem ser cancelados.");
    }
    const canceled = { ...current, estado: "CANCELADA" as const, atualizado_em: new Date().toISOString() };
    history[index] = canceled;
    saveHistory(history);
    addEvent(canceled, "LANCAMENTO_CANCELADO", current.estado, "CANCELADA", justification);
  },
};
