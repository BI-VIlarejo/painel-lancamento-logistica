import { demoApi } from "../deliveries/demoApi";
import { demoFeedbackApi } from "../feedback/demoApi";
import { demoAdministrationApi } from "../administration/demoApi";
import type { DeliveryTransportType } from "../deliveries/classifications";
import type { DashboardFilters, DashboardResponse } from "./types";

const percentage = (count: number, total: number): number | null =>
  total ? Math.round((count / total) * 10_000) / 100 : null;
const operationOf = (item: { tipo_operacao?: "ENTREGA" | "COLETA" }): "ENTREGA" | "COLETA" => item.tipo_operacao ?? "ENTREGA";

export const demoAnalyticsApi = {
  async dashboard(filters: DashboardFilters = {}): Promise<DashboardResponse> {
    const page = await demoApi.listDeliveries({ estado: "TODOS", limit: 500, offset: 0 });
    const catalogPeople = await demoAdministrationApi.people();
    const activeByPersonId = new Map(catalogPeople.map((person) => [person.id_pessoa, person.ativo]));
    const registered = page.items
      .filter((launch) => launch.estado === "ENVIADA" || launch.estado === "APROVADA")
      .flatMap((launch) => launch.itens.map((item) => ({ launch, item })))
      .filter(({ item }) => (!filters.data_de || item.data_entrega >= filters.data_de)
        && (!filters.data_ate || item.data_entrega <= filters.data_ate)
        && (!filters.id_localidade || item.id_localidade === filters.id_localidade)
        && (!filters.tipo_transporte_entrega || item.participantes.every((person) => person.tipo_transporte_entrega === filters.tipo_transporte_entrega)));

    const itemByCode = new Map(registered.map(({ item }) => [item.codigo_item_lancamento, item]));
    const feedbackPage = await demoFeedbackApi.list({ limit: 500, offset: 0 });
    const feedback = feedbackPage.items.filter((entry) => itemByCode.has(entry.codigo_item_lancamento)
      && (!filters.data_de || entry.data_feedback >= filters.data_de)
      && (!filters.data_ate || entry.data_feedback <= filters.data_ate));

    const people = new Map<number, {
      name: string; role: string; teams: Set<string>; planned: number; completed: number;
      notCompleted: number; praise: number; complaint: number;
      reasons: Map<string, { id: number; operation: "ENTREGA" | "COLETA"; name: string; group: string | null; quantity: number }>;
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
    const reasons = new Map<string, { id: number; operation: "ENTREGA" | "COLETA"; name: string; group: string | null; quantity: number }>();
    const deliveryTypes = new Map<string | null, {
      records: number; planned: number; completed: number; notCompleted: number;
      deliveryRecords: number; collectionRecords: number; deliveryPlanned: number;
      deliveryCompleted: number; deliveryNotCompleted: number; collectionPlanned: number;
      collectionCompleted: number; collectionNotCompleted: number;
    }>();
    const days = new Map<string, { planned: number; completed: number; notCompleted: number }>();

    for (const { launch, item } of registered) {
      const planned = item.quantidade_realizada + item.quantidade_nao_realizada;
      const operation = operationOf(item);
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
        const reasonKey = `${operation}:${reason.id_motivo_nao_entrega}`;
        const current = reasons.get(reasonKey) ?? {
          id: reason.id_motivo_nao_entrega, operation, name: reason.descricao_motivo, group: reason.grupo_motivo, quantity: 0,
        };
        current.quantity += reason.quantidade;
        reasons.set(reasonKey, current);
      }

      const knownTypes = new Set(item.participantes
        .map((person) => person.tipo_transporte_entrega)
        .filter((type): type is DeliveryTransportType => type !== null));
      const hasUnclassifiedParticipant = item.participantes.some((person) => !person.tipo_transporte_entrega);
      const deliveryType = knownTypes.size > 1
        ? "MISTO"
        : hasUnclassifiedParticipant
          ? null
          : [...knownTypes][0] ?? null;
      const typeTotals = deliveryTypes.get(deliveryType) ?? {
        records: 0, planned: 0, completed: 0, notCompleted: 0,
        deliveryRecords: 0, collectionRecords: 0, deliveryPlanned: 0,
        deliveryCompleted: 0, deliveryNotCompleted: 0, collectionPlanned: 0,
        collectionCompleted: 0, collectionNotCompleted: 0,
      };
      typeTotals.records += 1;
      typeTotals.planned += planned;
      typeTotals.completed += item.quantidade_realizada;
      typeTotals.notCompleted += item.quantidade_nao_realizada;
      if (operation === "ENTREGA") {
        typeTotals.deliveryRecords += 1;
        typeTotals.deliveryPlanned += planned;
        typeTotals.deliveryCompleted += item.quantidade_realizada;
        typeTotals.deliveryNotCompleted += item.quantidade_nao_realizada;
      } else {
        typeTotals.collectionRecords += 1;
        typeTotals.collectionPlanned += planned;
        typeTotals.collectionCompleted += item.quantidade_realizada;
        typeTotals.collectionNotCompleted += item.quantidade_nao_realizada;
      }
      deliveryTypes.set(deliveryType, typeTotals);

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
          praise: 0, complaint: 0, reasons: new Map(),
        };
        person.teams.add(teamKey);
        // O resultado é lançado por equipe. Cada integrante recebe o resultado
        // das equipes em que participou para poder compor o ranking conjunto.
        person.planned += planned;
        person.completed += item.quantidade_realizada;
        person.notCompleted += item.quantidade_nao_realizada;
        for (const reason of item.motivos) {
          const reasonKey = `${operation}:${reason.id_motivo_nao_entrega}`;
          const reasonTotal = person.reasons.get(reasonKey) ?? {
            id: reason.id_motivo_nao_entrega,
            operation,
            name: reason.descricao_motivo,
            group: reason.grupo_motivo,
            quantity: 0,
          };
          reasonTotal.quantity += reason.quantidade;
          person.reasons.set(reasonKey, reasonTotal);
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
    const operationTotals = {
      ENTREGA: { completed: 0, notCompleted: 0 },
      COLETA: { completed: 0, notCompleted: 0 },
    };
    for (const { item } of registered) {
      const operation = operationOf(item);
      operationTotals[operation].completed += item.quantidade_realizada;
      operationTotals[operation].notCompleted += item.quantidade_nao_realizada;
    }
    const reasonGroups = new Map<string, { operation: "ENTREGA" | "COLETA"; group: string | null; quantity: number }>();
    for (const reason of reasons.values()) {
      const groupKey = `${reason.operation}:${reason.group ?? ""}`;
      const group = reasonGroups.get(groupKey) ?? { operation: reason.operation, group: reason.group, quantity: 0 };
      group.quantity += reason.quantity;
      reasonGroups.set(groupKey, group);
    }

    const byPeople = [...people.entries()].map(([id, value]) => ({
      id_pessoa: id, nome: value.name, funcao: value.role,
      ativo: activeByPersonId.get(id) ?? true,
      equipes: value.teams.size, itens_planejados: value.planned,
      realizadas: value.completed, nao_realizadas: value.notCompleted,
      taxa_realizacao: percentage(value.completed, value.planned),
      otif_percentual: percentage(value.notCompleted, value.planned),
      elogios: value.praise, reclamacoes: value.complaint,
      score_atendimento: value.praise - value.complaint,
      motivos_da_equipe: [...value.reasons.values()].map((reason) => ({
        tipo_operacao: reason.operation,
        id_motivo: reason.id, motivo: reason.name, grupo_motivo: reason.group,
        quantidade: reason.quantity,
      })).sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR")),
    })).sort((a, b) => (b.taxa_realizacao ?? -1) - (a.taxa_realizacao ?? -1)
      || b.score_atendimento - a.score_atendimento || b.realizadas - a.realizadas
      || a.nome.localeCompare(b.nome, "pt-BR"));

    return {
      data_de: filters.data_de ?? null,
      data_ate: filters.data_ate ?? null,
      id_localidade: filters.id_localidade ?? null,
      tipo_transporte_entrega: filters.tipo_transporte_entrega ?? null,
      resumo: {
        lancamentos_registrados: new Set(registered.map(({ launch }) => launch.codigo_lancamento)).size,
        itens_planejados: planned,
        entregas_realizadas: operationTotals.ENTREGA.completed,
        entregas_nao_realizadas: operationTotals.ENTREGA.notCompleted,
        coletas_realizadas: operationTotals.COLETA.completed,
        coletas_nao_realizadas: operationTotals.COLETA.notCompleted,
        taxa_realizacao: percentage(completed, planned),
        otif_percentual: percentage(notCompleted, planned),
      },
      feedback: { disponivel: true, elogios: praise, reclamacoes: complaint },
      evolucao: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
        data: date, planejadas: value.planned, realizadas: value.completed,
        nao_realizadas: value.notCompleted, taxa_realizacao: percentage(value.completed, value.planned),
        otif_percentual: percentage(value.notCompleted, value.planned),
      })),
      por_localidade: [...localities.entries()].map(([id, value]) => ({
        id_localidade: id, nome: value.name, lancamentos: value.launches.size,
        itens_planejados: value.planned, realizadas: value.completed,
        nao_realizadas: value.notCompleted, taxa_realizacao: percentage(value.completed, value.planned),
        otif_percentual: percentage(value.notCompleted, value.planned),
        elogios: value.praise, reclamacoes: value.complaint,
      })).sort((a, b) => b.itens_planejados - a.itens_planejados || a.nome.localeCompare(b.nome, "pt-BR")),
      por_motivo: [...reasons.values()].map((value) => ({
        tipo_operacao: value.operation,
        id_motivo: value.id,
        motivo: value.name,
        grupo_motivo: value.group,
        quantidade: value.quantity,
        percentual_das_nao_realizadas: percentage(value.quantity, operationTotals[value.operation].notCompleted),
        incidencia_sobre_total: percentage(value.quantity, operationTotals[value.operation].completed + operationTotals[value.operation].notCompleted),
      })).sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR")),
      por_grupo_motivo: [...reasonGroups.values()].map(({ operation, group, quantity }) => ({
        tipo_operacao: operation,
        grupo_motivo: group,
        quantidade: quantity,
        percentual_das_nao_realizadas: percentage(quantity, operationTotals[operation].notCompleted),
        incidencia_sobre_total: percentage(quantity, operationTotals[operation].completed + operationTotals[operation].notCompleted),
      })).sort((a, b) => b.quantidade - a.quantidade),
      por_tipo_entrega: [...deliveryTypes.entries()].map(([type, value]) => ({
        tipo_transporte_entrega: type,
        registros_entrega: value.deliveryRecords,
        registros_coleta: value.collectionRecords,
        itens_planejados: value.planned,
        realizadas: value.completed,
        nao_realizadas: value.notCompleted,
        entregas_planejadas: value.deliveryPlanned,
        entregas_realizadas: value.deliveryCompleted,
        entregas_nao_realizadas: value.deliveryNotCompleted,
        coletas_planejadas: value.collectionPlanned,
        coletas_realizadas: value.collectionCompleted,
        coletas_nao_realizadas: value.collectionNotCompleted,
        taxa_realizacao: percentage(value.completed, value.planned),
        otif_percentual: percentage(value.notCompleted, value.planned),
      })),
      por_pessoa: byPeople,
      por_equipe: [...teams.entries()].map(([key, value]) => ({
        chave: key, equipe: value.name, itens_planejados: value.planned,
        realizadas: value.completed, nao_realizadas: value.notCompleted,
        taxa_realizacao: percentage(value.completed, value.planned),
        otif_percentual: percentage(value.notCompleted, value.planned),
        lancamentos: value.launches.size, elogios: value.praise, reclamacoes: value.complaint,
      })).sort((a, b) => (b.taxa_realizacao ?? -1) - (a.taxa_realizacao ?? -1)
        || b.itens_planejados - a.itens_planejados || a.equipe.localeCompare(b.equipe, "pt-BR")),
    };
  },
};
