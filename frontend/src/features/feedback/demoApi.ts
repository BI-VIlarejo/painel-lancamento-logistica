import { demoApi } from "../deliveries/demoApi";
import type {
  FeedbackCreateInput,
  FeedbackDeliveryItem,
  FeedbackItem,
  FeedbackLocality,
  FeedbackListFilters,
  FeedbackPageResponse,
} from "./types";

const STORAGE_KEY = "lancamento-logistica:demo-feedbacks";
const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 120));

function readItems(): FeedbackItem[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is FeedbackItem => Boolean(
      item && typeof item === "object" &&
      typeof item.id_feedback === "number" &&
      typeof item.data_entrega === "string" &&
      typeof item.codigo_item_lancamento === "string",
    ));
  } catch {
    return [];
  }
}

function writeItems(items: FeedbackItem[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export const demoFeedbackApi = {
  async localities(): Promise<FeedbackLocality[]> {
    const page = await demoApi.listDeliveries({ estado: "ENVIADA", limit: 100, offset: 0 });
    const localities = new Map<number, string>();
    for (const launch of page.items) {
      for (const item of launch.itens) localities.set(item.id_localidade, item.nome_localidade);
    }
    return Array.from(localities, ([id_localidade, nome_localidade]) => ({ id_localidade, nome_localidade }));
  },

  async deliveryItems(dataEntrega: string, idLocalidade: number): Promise<FeedbackDeliveryItem[]> {
    await pause();
    const page = await demoApi.listDeliveries({ estado: "ENVIADA", limit: 100, offset: 0 });
    return page.items.flatMap((launch) => launch.itens
      .filter((item) => item.data_entrega === dataEntrega && item.id_localidade === idLocalidade)
      .map((item) => ({
        codigo_lancamento: launch.codigo_lancamento,
        codigo_revisao: launch.codigo_revisao,
        codigo_item_lancamento: item.codigo_item_lancamento,
        data_entrega: item.data_entrega,
        id_localidade: item.id_localidade,
        nome_localidade: item.nome_localidade,
        quantidade_realizada: item.quantidade_realizada,
        quantidade_nao_realizada: item.quantidade_nao_realizada,
        participantes: item.participantes.map((person) => ({
          id_pessoa: person.id_pessoa,
          nome_exibicao: person.nome_exibicao,
          papel_participante: person.papel_participante,
        })),
      })));
  },

  async list(filters: FeedbackListFilters = {}): Promise<FeedbackPageResponse> {
    await pause();
    const localities = (await demoApi.listLocalities()).items;
    const people = (await demoApi.listPeople()).items;
    const items = readItems().map((item) => ({
      ...item,
      nome_localidade: localities.find((locality) => locality.id_localidade === item.id_localidade)?.nome_localidade ?? item.nome_localidade,
      participantes: item.participantes.map((participant) => ({
        ...participant,
        nome_exibicao: people.find((person) => person.id_pessoa === participant.id_pessoa)?.nome_exibicao ?? participant.nome_exibicao,
      })),
    })).filter((item) => !filters.q || [item.relato, item.nome_localidade, ...item.participantes.map((person) => person.nome_exibicao)].join(" ").toLocaleLowerCase("pt-BR").includes(filters.q.toLocaleLowerCase("pt-BR")))
      .filter((item) => !filters.tipo || filters.tipo === "TODOS" || item.tipo === filters.tipo)
      .filter((item) => !filters.id_localidade || item.id_localidade === filters.id_localidade)
      .filter((item) => !filters.data_de || item.data_feedback >= filters.data_de)
      .filter((item) => !filters.data_ate || item.data_feedback <= filters.data_ate)
      .sort((a, b) => b.data_feedback.localeCompare(a.data_feedback) || b.criado_em.localeCompare(a.criado_em));
    const limit = filters.limit ?? 25;
    const offset = filters.offset ?? 0;
    return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
  },

  async create(input: FeedbackCreateInput): Promise<FeedbackItem> {
    await pause();
    const deliveries = await demoApi.listDeliveries({ estado: "ENVIADA", limit: 100, offset: 0 });
    const launch = deliveries.items.find((entry) => entry.codigo_lancamento === input.codigo_lancamento && entry.codigo_revisao === input.codigo_revisao);
    const delivery = launch?.itens.find((entry) => entry.codigo_item_lancamento === input.codigo_item_lancamento);
    if (!launch || !delivery) throw new Error("A entrega confirmada selecionada não está disponível.");
    if (input.data_feedback < delivery.data_entrega) throw new Error("A data da manifestação não pode anteceder a data da entrega.");
    const currentItems = readItems();
    const item: FeedbackItem = {
      ...input,
      id_feedback: Math.max(Date.now(), ...currentItems.map((entry) => entry.id_feedback + 1)),
      data_entrega: delivery.data_entrega,
      id_localidade: delivery.id_localidade,
      nome_localidade: delivery.nome_localidade,
      participantes: delivery.participantes.map((person) => ({
        id_pessoa: person.id_pessoa,
        nome_exibicao: person.nome_exibicao,
        papel_participante: person.papel_participante,
      })),
      criado_em: new Date().toISOString(),
    };
    writeItems([item, ...currentItems]);
    return item;
  },

  async export(filters: FeedbackListFilters = {}): Promise<Blob> {
    let offset = 0;
    const allItems: FeedbackItem[] = [];
    let total = 0;
    do {
      const page = await this.list({ ...filters, limit: 100, offset });
      allItems.push(...page.items);
      total = page.total;
      offset += page.limit;
    } while (offset < total);
    const rows = [
      ["data_manifestacao", "data_entrega", "tipo", "loja", "equipe", "relato"],
      ...allItems.map((item) => [
        item.data_feedback,
        item.data_entrega,
        item.tipo,
        item.nome_localidade,
        item.participantes.map((person) => person.nome_exibicao).join(", "),
        item.relato,
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((value) => {
      const text = String(value);
      const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(",")).join("\r\n")}`;
    return new Blob([csv], { type: "text/csv;charset=utf-8" });
  },
};
