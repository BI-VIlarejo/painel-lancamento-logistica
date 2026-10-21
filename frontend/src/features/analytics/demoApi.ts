import { demoApi } from "../deliveries/demoApi";
import { demoFeedbackApi } from "../feedback/demoApi";
import type { DashboardFilters, DashboardResponse } from "./types";

const percentage = (count: number, total: number): number | null =>
  total ? Math.round((count / total) * 10_000) / 100 : null;

export const demoAnalyticsApi = {
  async dashboard(filters: DashboardFilters = {}): Promise<DashboardResponse> {
    const page = await demoApi.listDeliveries({ estado: "TODOS", limit: 500, offset: 0 });
    const registered = page.items
      .filter((launch) => launch.estado === "ENVIADA" || launch.estado === "APROVADA")
      .flatMap((launch) => launch.itens.map((item) => ({ launch, item })))
      .filter(({ item }) => (!filters.data_de || item.data_entrega >= filters.data_de)
        && (!filters.data_ate || item.data_entrega <= filters.data_ate)
        && (!filters.id_localidade || item.id_localidade === filters.id_localidade));

    const itemByCode = new Map(registered.map(({ item }) => [item.codigo_item_lancamento, item]));
    const feedbackPage = await demoFeedbackApi.list({ limit: 500, offset: 0 });
    const feedback = feedbackPage.items.filter((entry) => itemByCode.has(entry.codigo_item_lancamento)
      && (!filters.data_de || entry.data_feedback >= filters.data_de)
      && (!filters.data_ate || entry.data_feedback <= filters.data_ate));

    const people = new Map<number, {
      name: string; role: string; teams: Set<string>; planned: number; completed: number;
      notCompleted: number; praise: number; complaint: number;
    }>();
    const teams = new Map<string, {
      name: string; members: number[]; launches: Set<string>; planned: number;
      completed: number; notCompleted: number; praise: number; complaint: number;
    }>();
    const teamByItem = new Map<string, string>();
    const localities = new Map<number, {
      name: string; launches: Set<string>; planned: number; completed: number;
      notCompleted: number; praise: number; complaint: number;
    }>();
    const reasons = new Map<number, { name: string; quantity: number }>();
    const days = new Map<string, { planned: number; completed: number; notCompleted: number }>();

    for (const { launch, item } of registered) {
      const planned = item.quantidade_realizada + item.quantidade_nao_realizada;
      const locality = localities.get(item.id_localidade) ?? {
        name: item.nome_localidade, launches: new Set<string>(), planned: 0,
        completed: 0, notCompleted: 0, praise: 0, complaint: 0,
      };
      locality.launches.add(launch.codigo_lancamento);
      locality.planned += planned;
      locality.completed += item.quantidade_realizada;
      locality.notCompleted += item.quantidade_nao_realizada;
      localities.set(item.id_localidade, locality);

      const day = days.get(item.data_entrega) ?? { planned: 0, completed: 0, notCompleted: 0 };
      day.planned += planned;
      day.completed += item.quantidade_realizada;
      day.notCompleted += item.quantidade_nao_realizada;
      days.set(item.data_entrega, day);

      for (const reason of item.motivos) {
        const current = reasons.get(reason.id_motivo_nao_entrega) ?? {
          name: reason.descricao_motivo, quantity: 0,
        };
        current.quantity += reason.quantidade;
        reasons.set(reason.id_motivo_nao_entrega, current);
      }

      const ordered = [...item.participantes].sort((a, b) =>
        (a.papel_participante === "MOTORISTA" ? 0 : 1) - (b.papel_participante === "MOTORISTA" ? 0 : 1)
        || a.ordem - b.ordem || a.id_pessoa - b.id_pessoa);
      const teamKey = ordered.map((person) => person.id_pessoa).join(":");
      teamByItem.set(item.codigo_item_lancamento, teamKey);
      const team = teams.get(teamKey) ?? {
        name: ordered.map((person) => person.nome_exibicao).join(" · "),
        members: ordered.map((person) => person.id_pessoa), launches: new Set<string>(),
        planned: 0, completed: 0, notCompleted: 0, praise: 0, complaint: 0,
      };
      team.launches.add(launch.codigo_lancamento);
      team.planned += planned;
      team.completed += item.quantidade_realizada;
      team.notCompleted += item.quantidade_nao_realizada;
      teams.set(teamKey, team);

      for (const participant of ordered) {
        const person = people.get(participant.id_pessoa) ?? {
          name: participant.nome_exibicao, role: participant.papel_participante,
          teams: new Set<string>(), planned: 0, completed: 0, notCompleted: 0,
          praise: 0, complaint: 0,
        };
        person.teams.add(teamKey);
        if (participant.papel_participante === "MOTORISTA") {
          person.planned += planned;
          person.completed += item.quantidade_realizada;
          person.notCompleted += item.quantidade_nao_realizada;
        }
        people.set(participant.id_pessoa, person);
      }
    }

    let praise = 0;
    let complaint = 0;
    for (const entry of feedback) {
      const metric = entry.tipo === "ELOGIO" ? "praise" : "complaint";
      if (metric === "praise") praise += 1;
      else complaint += 1;
      for (const participant of entry.participantes) {
        const person = people.get(participant.id_pessoa);
        if (person) person[metric] += 1;
      }
      const team = teams.get(teamByItem.get(entry.codigo_item_lancamento) ?? "");
      if (team) team[metric] += 1;
      const item = itemByCode.get(entry.codigo_item_lancamento);
      const locality = item ? localities.get(item.id_localidade) : undefined;
      if (locality) locality[metric] += 1;
    }

    const completed = registered.reduce((sum, { item }) => sum + item.quantidade_realizada, 0);
    const notCompleted = registered.reduce((sum, { item }) => sum + item.quantidade_nao_realizada, 0);
    const planned = completed + notCompleted;
    const onTimeCounts = registered.map(({ item }) => item.quantidade_entregas_no_prazo);
    const fullCounts = registered.map(({ item }) => item.quantidade_entregas_completas);
    const otifAvailable = registered.length > 0 && onTimeCounts.every((value) => value !== null && value !== undefined)
      && fullCounts.every((value) => value !== null && value !== undefined);
    const onTime = otifAvailable ? onTimeCounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    const inFull = otifAvailable ? fullCounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    const onTimeRate = onTime === null ? null : percentage(onTime, planned);
    const inFullRate = inFull === null ? null : percentage(inFull, planned);

    const byPeople = [...people.entries()].map(([id, value]) => ({
      id_pessoa: id, nome: value.name, funcao: value.role,
      equipes: value.teams.size, itens_planejados: value.planned,
      realizadas: value.completed, nao_realizadas: value.notCompleted,
      taxa_realizacao: percentage(value.completed, value.planned),
      elogios: value.praise, reclamacoes: value.complaint,
      score_atendimento: value.praise - value.complaint,
    })).sort((a, b) => (b.taxa_realizacao ?? -1) - (a.taxa_realizacao ?? -1)
      || b.score_atendimento - a.score_atendimento || b.realizadas - a.realizadas
      || a.nome.localeCompare(b.nome, "pt-BR"));

    return {
      data_de: filters.data_de ?? null,
      data_ate: filters.data_ate ?? null,
      id_localidade: filters.id_localidade ?? null,
      resumo: {
        lancamentos_registrados: new Set(registered.map(({ launch }) => launch.codigo_lancamento)).size,
        itens_planejados: planned,
        entregas_realizadas: completed,
        entregas_nao_realizadas: notCompleted,
        taxa_realizacao: percentage(completed, planned),
        quantidade_entregas_no_prazo: onTime,
        quantidade_entregas_completas: inFull,
        percentual_entregas_no_prazo: onTimeRate,
        percentual_entregas_completas: inFullRate,
        otif_percentual: onTimeRate === null || inFullRate === null ? null : Math.round((onTimeRate * inFullRate) / 100 * 100) / 100,
      },
      feedback: { disponivel: true, elogios: praise, reclamacoes: complaint },
      evolucao: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
        data: date, planejadas: value.planned, realizadas: value.completed,
        nao_realizadas: value.notCompleted, taxa_realizacao: percentage(value.completed, value.planned),
      })),
      por_localidade: [...localities.entries()].map(([id, value]) => ({
        id_localidade: id, nome: value.name, lancamentos: value.launches.size,
        itens_planejados: value.planned, realizadas: value.completed,
        nao_realizadas: value.notCompleted, taxa_realizacao: percentage(value.completed, value.planned),
        elogios: value.praise, reclamacoes: value.complaint,
      })).sort((a, b) => b.itens_planejados - a.itens_planejados || a.nome.localeCompare(b.nome, "pt-BR")),
      por_motivo: [...reasons.entries()].map(([id, value]) => ({
        id_motivo: id, motivo: value.name, quantidade: value.quantity,
      })).sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR")),
      por_pessoa: byPeople,
      por_equipe: [...teams.entries()].map(([key, value]) => ({
        chave: key, equipe: value.name, itens_planejados: value.planned,
        realizadas: value.completed, nao_realizadas: value.notCompleted,
        taxa_realizacao: percentage(value.completed, value.planned),
        lancamentos: value.launches.size, elogios: value.praise, reclamacoes: value.complaint,
      })).sort((a, b) => (b.taxa_realizacao ?? -1) - (a.taxa_realizacao ?? -1)
        || b.itens_planejados - a.itens_planejados || a.equipe.localeCompare(b.equipe, "pt-BR")),
    };
  },
};
