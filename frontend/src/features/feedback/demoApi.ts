import { demoApi } from "../deliveries/demoApi";
import type { FeedbackCreateInput, FeedbackItem, FeedbackPageResponse } from "./types";

const STORAGE_KEY = "lancamento-logistica:demo-feedbacks";
const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 120));

function readItems(): FeedbackItem[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) as FeedbackItem[] : [];
  } catch {
    return [];
  }
}

function writeItems(items: FeedbackItem[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export const demoFeedbackApi = {
  async list(): Promise<FeedbackPageResponse> {
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
    })).sort((a, b) => b.data_feedback.localeCompare(a.data_feedback) || b.criado_em.localeCompare(a.criado_em));
    return { items, total: items.length, limit: 500, offset: 0 };
  },

  async create(input: FeedbackCreateInput): Promise<FeedbackItem> {
    await pause();
    const [localities, people] = await Promise.all([demoApi.listLocalities(), demoApi.listPeople()]);
    const locality = localities.items.find((item) => item.id_localidade === input.id_localidade);
    if (!locality) throw new Error("Selecione uma loja ativa.");
    const participants = input.participantes.map((participant) => {
      const person = people.items.find((item) => item.id_pessoa === participant.id_pessoa && item.tipo_funcao === participant.papel_participante);
      if (!person) throw new Error("Uma das pessoas selecionadas não está disponível.");
      return { ...participant, nome_exibicao: person.nome_exibicao };
    });
    const item: FeedbackItem = {
      ...input,
      id_feedback: crypto.randomUUID(),
      nome_localidade: locality.nome_localidade,
      participantes,
      criado_em: new Date().toISOString(),
    };
    writeItems([item, ...readItems()]);
    return item;
  },
};
