import { useCallback, useLayoutEffect, useRef } from "react";
import styles from "./DashboardDetailDialog.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import type {
  DashboardDeliveryType,
  DashboardLocality,
  DashboardPerson,
  DashboardReason,
  DashboardReasonGroup,
  DashboardResponse,
  DashboardTeam,
  DashboardTrendPoint,
} from "../types";

export type DashboardDetailSelection =
  | { kind: "trend"; title: string; point: DashboardTrendPoint }
  | { kind: "composition"; title: string; operation?: "ENTREGA" | "COLETA" }
  | { kind: "locality"; title: string; locality: DashboardLocality }
  | { kind: "reason"; title: string; reason: DashboardReason }
  | { kind: "reason-group"; title: string; group: DashboardReasonGroup }
  | { kind: "delivery-type"; title: string; deliveryType: DashboardDeliveryType }
  | { kind: "person"; title: string; person: DashboardPerson }
  | { kind: "team"; title: string; team: DashboardTeam };

type Props = {
  selection: DashboardDetailSelection | null;
  dashboard: DashboardResponse | null;
  localityDashboard: DashboardResponse | null;
  localityLoading: boolean;
  localityError: string;
  onClose: () => void;
};

const countFormat = new Intl.NumberFormat("pt-BR");
const percentageFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function rateLabel(value: number | null): string {
  return value === null ? "—" : `${percentageFormat.format(value)}%`;
}

function operationLabel(value: "ENTREGA" | "COLETA"): string {
  return value === "COLETA" ? "Coleta" : "Entrega";
}

function operationPlural(value: "ENTREGA" | "COLETA"): string {
  return value === "COLETA" ? "coletas" : "entregas";
}

function reasonGroupLabel(value: string | null): string {
  const labels: Record<string, string> = {
    TRANSPORTE_PROPRIO: "Transporte próprio",
    TRANSPORTE_TERCEIRIZADO: "Transporte terceirizado",
    LOJA: "Loja",
    LOGISTICA: "Logística",
  };
  return value ? labels[value] ?? value : "Sem classificação";
}

function driverReasonSummaries(reasons: DashboardReason[]) {
  const drivers = new Map<string, {
    nome: string;
    quantidade: number;
    motivos: Map<string, { nome: string; quantidade: number }>;
    equipes: Set<string>;
  }>();

  for (const reason of reasons) {
    for (const team of reason.equipes ?? []) {
      const key = team.id_motorista === null || team.id_motorista === undefined
        ? `equipe:${team.chave}`
        : `motorista:${team.id_motorista}`;
      const driver = drivers.get(key) ?? {
        nome: team.motorista || "Motorista não informado",
        quantidade: 0,
        motivos: new Map<string, { nome: string; quantidade: number }>(),
        equipes: new Set<string>(),
      };
      driver.quantidade += team.quantidade;
      driver.equipes.add(team.equipe);
      const motiveKey = `${reason.tipo_operacao}:${reason.id_motivo}`;
      const motive = driver.motivos.get(motiveKey) ?? {
        nome: `${operationLabel(reason.tipo_operacao)} · ${reason.motivo}`,
        quantidade: 0,
      };
      motive.quantidade += team.quantidade;
      driver.motivos.set(motiveKey, motive);
      drivers.set(key, driver);
    }
  }

  return [...drivers.values()]
    .map((driver) => ({
      ...driver,
      motivos: [...driver.motivos.values()].sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR")),
      equipes: [...driver.equipes].sort((a, b) => a.localeCompare(b, "pt-BR")),
    }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR"));
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(year, month - 1, day ?? 1));
}

function MetricGrid({ items }: { items: Array<{ label: string; value: string; note?: string }> }) {
  return <dl className={cx(styles, commonStyles, "detail-metrics")}>{items.map((item) => <div key={item.label}>
    <dt>{item.label}</dt><dd>{item.value}</dd>{item.note && <small>{item.note}</small>}
  </div>)}</dl>;
}

function OperationResult({ title, completed, notCompleted, records }: {
  title: string;
  completed: number;
  notCompleted: number;
  records?: number;
}) {
  const total = completed + notCompleted;
  return <section className={cx(styles, commonStyles, "detail-operation-result")}>
    <div className={cx(styles, commonStyles, "detail-operation-heading")}>
      <h3>{title}</h3>
      {records !== undefined && <span>{countFormat.format(records)} registros</span>}
    </div>
    <MetricGrid items={[
      { label: "Total registrado", value: countFormat.format(total) },
      { label: "Realizadas", value: countFormat.format(completed) },
      { label: "Não realizadas", value: countFormat.format(notCompleted) },
      { label: "Taxa de realização", value: rateLabel(total ? (completed / total) * 100 : null) },
      { label: "OTIF", value: rateLabel(total ? (notCompleted / total) * 100 : null) },
    ]} />
  </section>;
}

function OperationResults({ delivery, collection }: {
  delivery: { completed: number; notCompleted: number; records?: number };
  collection: { completed: number; notCompleted: number; records?: number };
}) {
  return <div className={cx(styles, commonStyles, "detail-operation-results")}>
    <OperationResult title="Entregas" {...delivery} />
    <OperationResult title="Coletas" {...collection} />
  </div>;
}

function DetailList({ title, note, items }: { title: string; note?: string; items: Array<{ label: string; value: string; detail?: string }> }) {
  if (!items.length) return <section className={cx(styles, commonStyles, "detail-section")}><h3>{title}</h3><p className={cx(styles, commonStyles, "detail-empty")}>Sem dados para este recorte.</p></section>;
  return <section className={cx(styles, commonStyles, "detail-section")}>
    <div className={cx(styles, commonStyles, "detail-section-heading")}><h3>{title}</h3>{note && <p>{note}</p>}</div>
    <ul className={cx(styles, commonStyles, "detail-list")}>{items.map((item, index) => <li key={`${item.label}-${index}`}>
      <span>{item.label}{item.detail && <small>{item.detail}</small>}</span><strong>{item.value}</strong>
    </li>)}</ul>
  </section>;
}

export function DashboardDetailDialog({ selection, dashboard, localityDashboard, localityLoading, localityError, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const pageScrollPositionRef = useRef<{ left: number; top: number } | null>(null);

  const restorePageScroll = useCallback((clearAfterRestore = false) => {
    const position = pageScrollPositionRef.current;
    if (!position) return;
    const restore = () => window.scrollTo(position.left, position.top);

    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(() => {
        restore();
        if (clearAfterRestore && pageScrollPositionRef.current === position) {
          pageScrollPositionRef.current = null;
        }
      });
    });
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selection && !dialog.open) {
      pageScrollPositionRef.current = { left: window.scrollX, top: window.scrollY };
      dialog.showModal();
      closeButtonRef.current?.focus({ preventScroll: true });
      restorePageScroll();
    }
    if (!selection && dialog.open) dialog.close();
  }, [restorePageScroll, selection]);

  const operationName = selection?.kind === "reason"
    ? operationLabel(selection.reason.tipo_operacao)
    : selection?.kind === "reason-group"
      ? operationLabel(selection.group.tipo_operacao)
      : "";
  const relatedReasons = selection?.kind === "reason-group"
    ? (dashboard?.por_motivo ?? []).filter((reason) => reason.tipo_operacao === selection.group.tipo_operacao && reason.grupo_motivo === selection.group.grupo_motivo)
    : [];
  const groupDriverSummaries = selection?.kind === "reason-group"
    ? driverReasonSummaries(relatedReasons)
    : [];

  return <dialog
    ref={dialogRef}
    className={cx(styles, commonStyles, "dashboard-detail-dialog")}
    aria-labelledby="dashboard-detail-title"
    onClose={() => {
      restorePageScroll(true);
      onClose();
    }}
    onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
  >
    {selection && <>
      <header className={cx(styles, commonStyles, "detail-header")}>
        <div><span>DETALHES DO INDICADOR</span><h2 id="dashboard-detail-title">{selection.title}</h2></div>
        <button ref={closeButtonRef} className={cx(styles, commonStyles, "detail-close")} type="button" aria-label="Fechar detalhes" onClick={() => dialogRef.current?.close()}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      </header>
      <div className={cx(styles, commonStyles, "detail-content")}>
        {selection.kind === "trend" && <>
          <p className={cx(styles, commonStyles, "detail-intro")}>Resultado do período em <strong>{dateLabel(selection.point.data)}</strong>, conforme os filtros ativos do Painel.</p>
          <OperationResults
            delivery={{ completed: selection.point.entregas_realizadas, notCompleted: selection.point.entregas_nao_realizadas }}
            collection={{ completed: selection.point.coletas_realizadas, notCompleted: selection.point.coletas_nao_realizadas }}
          />
        </>}

        {selection.kind === "composition" && dashboard && <>
          <p className={cx(styles, commonStyles, "detail-intro")}>{selection.operation ? `Composição de ${operationPlural(selection.operation)}` : "Composição de entregas e coletas"} registradas no período e nos filtros selecionados.</p>
          {selection.operation
            ? <OperationResult
              title={selection.operation === "ENTREGA" ? "Entregas" : "Coletas"}
              completed={selection.operation === "ENTREGA" ? dashboard.resumo.entregas_realizadas : dashboard.resumo.coletas_realizadas}
              notCompleted={selection.operation === "ENTREGA" ? dashboard.resumo.entregas_nao_realizadas : dashboard.resumo.coletas_nao_realizadas}
            />
            : <OperationResults
              delivery={{ completed: dashboard.resumo.entregas_realizadas, notCompleted: dashboard.resumo.entregas_nao_realizadas }}
              collection={{ completed: dashboard.resumo.coletas_realizadas, notCompleted: dashboard.resumo.coletas_nao_realizadas }}
            />}
        </>}

        {selection.kind === "locality" && <>
          <p className={cx(styles, commonStyles, "detail-intro")}>Performance de <strong>{selection.locality.nome}</strong> no período e nos filtros atuais.</p>
          <MetricGrid items={[
            { label: "Lançamentos", value: countFormat.format(selection.locality.lancamentos) },
            { label: "Elogios", value: selection.locality.elogios === null ? "—" : countFormat.format(selection.locality.elogios) },
            { label: "Reclamações", value: selection.locality.reclamacoes === null ? "—" : countFormat.format(selection.locality.reclamacoes) },
          ]} />
          <OperationResults
            delivery={{ completed: selection.locality.entregas_realizadas, notCompleted: selection.locality.entregas_nao_realizadas }}
            collection={{ completed: selection.locality.coletas_realizadas, notCompleted: selection.locality.coletas_nao_realizadas }}
          />
          {localityLoading && <p className={cx(styles, commonStyles, "detail-loading")}>Carregando motivos e equipes da loja…</p>}
          {localityError && <p className={cx(styles, commonStyles, "detail-error")} role="alert">{localityError}</p>}
          {!localityLoading && localityDashboard && <>
            <DetailList title="Motivos de entregas não realizadas" note="Percentual dentro das não realizadas de entrega e no total de entregas." items={[...localityDashboard.por_motivo].filter((reason) => reason.tipo_operacao === "ENTREGA")
              .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR"))
              .map((reason) => ({ label: reason.motivo, value: countFormat.format(reason.quantidade), detail: `${reasonGroupLabel(reason.grupo_motivo)} · ${rateLabel(reason.percentual_das_nao_realizadas)} das não realizadas · ${rateLabel(reason.incidencia_sobre_total)} do total` }))} />
            <DetailList title="Motivos de coletas não realizadas" note="Percentual dentro das não realizadas de coleta e no total de coletas." items={[...localityDashboard.por_motivo].filter((reason) => reason.tipo_operacao === "COLETA")
              .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR"))
              .map((reason) => ({ label: reason.motivo, value: countFormat.format(reason.quantidade), detail: `${reasonGroupLabel(reason.grupo_motivo)} · ${rateLabel(reason.percentual_das_nao_realizadas)} das não realizadas · ${rateLabel(reason.incidencia_sobre_total)} do total` }))} />
            <DetailList title="Motivos de entrega por motorista" note="Os registros são coletivos da equipe e não identificam quem causou a ocorrência." items={driverReasonSummaries(localityDashboard.por_motivo.filter((reason) => reason.tipo_operacao === "ENTREGA")).map((driver) => ({
              label: driver.nome,
              value: `${countFormat.format(driver.quantidade)} ocorrências`,
              detail: `Motivos: ${driver.motivos.map((reason) => `${reason.nome} (${countFormat.format(reason.quantidade)})`).join(" · ")} · Equipes: ${driver.equipes.join(", ")}`,
            }))} />
            <DetailList title="Motivos de coleta por motorista" note="Os registros são coletivos da equipe e não identificam quem causou a ocorrência." items={driverReasonSummaries(localityDashboard.por_motivo.filter((reason) => reason.tipo_operacao === "COLETA")).map((driver) => ({
              label: driver.nome,
              value: `${countFormat.format(driver.quantidade)} ocorrências`,
              detail: `Motivos: ${driver.motivos.map((reason) => `${reason.nome} (${countFormat.format(reason.quantidade)})`).join(" · ")} · Equipes: ${driver.equipes.join(", ")}`,
            }))} />
            <DetailList title="Equipes · Entregas" note="Volumes registrados coletivamente por equipe." items={[...localityDashboard.por_equipe]
              .sort((a, b) => (b.taxa_realizacao ?? -1) - (a.taxa_realizacao ?? -1) || a.equipe.localeCompare(b.equipe, "pt-BR"))
              .filter((team) => team.entregas_realizadas + team.entregas_nao_realizadas > 0)
              .map((team) => { const total = team.entregas_realizadas + team.entregas_nao_realizadas; return ({ label: team.equipe, value: rateLabel(total ? (team.entregas_realizadas / total) * 100 : null), detail: `${countFormat.format(team.entregas_realizadas)} realizadas · ${countFormat.format(team.entregas_nao_realizadas)} não realizadas · ${countFormat.format(team.lancamentos)} lançamentos` }); })} />
            <DetailList title="Equipes · Coletas" note="Volumes registrados coletivamente por equipe." items={[...localityDashboard.por_equipe]
              .sort((a, b) => (b.taxa_realizacao ?? -1) - (a.taxa_realizacao ?? -1) || a.equipe.localeCompare(b.equipe, "pt-BR"))
              .filter((team) => team.coletas_realizadas + team.coletas_nao_realizadas > 0)
              .map((team) => { const total = team.coletas_realizadas + team.coletas_nao_realizadas; return ({ label: team.equipe, value: rateLabel(total ? (team.coletas_realizadas / total) * 100 : null), detail: `${countFormat.format(team.coletas_realizadas)} realizadas · ${countFormat.format(team.coletas_nao_realizadas)} não realizadas · ${countFormat.format(team.lancamentos)} lançamentos` }); })} />
          </>}
        </>}

        {selection.kind === "reason" && <>
          <p className={cx(styles, commonStyles, "detail-intro")}>{operationName} · {reasonGroupLabel(selection.reason.grupo_motivo)}. As porcentagens mostram quantas ocorrências tiveram este motivo dentro de dois totais diferentes.</p>
          <MetricGrid items={[
            { label: "Ocorrências", value: countFormat.format(selection.reason.quantidade) },
            { label: "Entre as não realizadas", value: rateLabel(selection.reason.percentual_das_nao_realizadas), note: `Parte das ${operationPlural(selection.reason.tipo_operacao)} não realizadas com este motivo.` },
            { label: "No total registrado", value: rateLabel(selection.reason.incidencia_sobre_total), note: `Parte de todas as ${operationPlural(selection.reason.tipo_operacao)} com este motivo, incluindo as realizadas.` },
          ]} />
          <DetailList title="Motoristas e equipes com este motivo" note="O motivo é registrado para a equipe. A identificação do motorista indica quem liderava a equipe, não quem causou a ocorrência." items={driverReasonSummaries([selection.reason]).map((driver) => ({
            label: driver.nome,
            value: countFormat.format(driver.quantidade),
            detail: `Ocorrências deste motivo · Equipes: ${driver.equipes.join(", ")}`,
          }))} />
        </>}

        {selection.kind === "reason-group" && <>
          <p className={cx(styles, commonStyles, "detail-intro")}>{operationName} · grupo {reasonGroupLabel(selection.group.grupo_motivo)}. As porcentagens mostram a participação do grupo entre as falhas e em toda a operação.</p>
          <MetricGrid items={[
            { label: "Ocorrências", value: countFormat.format(selection.group.quantidade) },
            { label: "Entre as não realizadas", value: rateLabel(selection.group.percentual_das_nao_realizadas), note: `Parte das ${operationPlural(selection.group.tipo_operacao)} não realizadas com motivo deste grupo.` },
            { label: "No total registrado", value: rateLabel(selection.group.incidencia_sobre_total), note: `Parte de todas as ${operationPlural(selection.group.tipo_operacao)} com motivo deste grupo, incluindo as realizadas.` },
          ]} />
          <DetailList title="Motivos do grupo" items={relatedReasons
            .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR"))
            .map((reason) => ({ label: reason.motivo, value: countFormat.format(reason.quantidade), detail: `${rateLabel(reason.percentual_das_nao_realizadas)} das não realizadas · ${rateLabel(reason.incidencia_sobre_total)} do total` }))} />
          <DetailList title="Motivos registrados por motorista" note="Os motivos são registrados coletivamente para as equipes. A lista mostra em quais equipes cada motivo apareceu, sem atribuir culpa individual." items={groupDriverSummaries.map((driver) => ({
            label: driver.nome,
            value: `${countFormat.format(driver.quantidade)} ocorrências`,
            detail: `Motivos: ${driver.motivos.map((reason) => `${reason.nome} (${countFormat.format(reason.quantidade)})`).join(" · ")} · Equipes: ${driver.equipes.join(", ")}`,
          }))} />
        </>}

        {selection.kind === "person" && <>
          <p className={cx(styles, commonStyles, "detail-intro")}>Indicadores de <strong>{selection.person.nome}</strong> nas equipes em que participou. Quantidades e motivos são registrados para a equipe e não identificam responsabilidade individual.</p>
          <MetricGrid items={[
            { label: "Função", value: selection.person.funcao === "MOTORISTA" ? "Motorista" : "Ajudante" },
            { label: "Equipes no período", value: countFormat.format(selection.person.equipes) },
            { label: "Situação cadastral", value: selection.person.ativo ? "Ativo" : "Inativo" },
            { label: "Score de atendimento", value: selection.person.score_atendimento > 0 ? `+${selection.person.score_atendimento}` : String(selection.person.score_atendimento) },
            { label: "Elogios", value: selection.person.elogios === null ? "—" : countFormat.format(selection.person.elogios) },
            { label: "Reclamações", value: selection.person.reclamacoes === null ? "—" : countFormat.format(selection.person.reclamacoes) },
          ]} />
          <OperationResults
            delivery={{ completed: selection.person.entregas_realizadas, notCompleted: selection.person.entregas_nao_realizadas }}
            collection={{ completed: selection.person.coletas_realizadas, notCompleted: selection.person.coletas_nao_realizadas }}
          />
          <DetailList title="Motivos nas equipes · Entregas" note="Motivos associados às equipes em que a pessoa participou; não indicam culpa individual." items={[...selection.person.motivos_da_equipe]
            .filter((reason) => reason.tipo_operacao === "ENTREGA")
            .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR"))
            .map((reason) => ({ label: reason.motivo, value: countFormat.format(reason.quantidade), detail: reasonGroupLabel(reason.grupo_motivo) }))} />
          <DetailList title="Motivos nas equipes · Coletas" note="Motivos associados às equipes em que a pessoa participou; não indicam culpa individual." items={[...selection.person.motivos_da_equipe]
            .filter((reason) => reason.tipo_operacao === "COLETA")
            .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR"))
            .map((reason) => ({ label: reason.motivo, value: countFormat.format(reason.quantidade), detail: reasonGroupLabel(reason.grupo_motivo) }))} />
        </>}

        {selection.kind === "delivery-type" && <>
          <p className={cx(styles, commonStyles, "detail-intro")}>Resultado do tipo de transporte selecionado no período e nos filtros ativos. Os volumes pertencem às equipes e não identificam quem executou cada entrega.</p>
          <OperationResults
            delivery={{ completed: selection.deliveryType.entregas_realizadas, notCompleted: selection.deliveryType.entregas_nao_realizadas, records: selection.deliveryType.registros_entrega }}
            collection={{ completed: selection.deliveryType.coletas_realizadas, notCompleted: selection.deliveryType.coletas_nao_realizadas, records: selection.deliveryType.registros_coleta }}
          />
          <DetailList title="Entregas por motorista" note="Volumes coletivos das equipes lideradas por cada motorista." items={[...(selection.deliveryType.motoristas ?? [])]
            .sort((a, b) => b.entregas_planejadas - a.entregas_planejadas || a.nome.localeCompare(b.nome, "pt-BR"))
            .filter((driver) => driver.entregas_planejadas > 0)
            .map((driver) => ({
              label: driver.nome,
              value: `${countFormat.format(driver.entregas_realizadas)} realizadas · ${countFormat.format(driver.entregas_nao_realizadas)} não realizadas`,
              detail: `${countFormat.format(driver.entregas_planejadas)} entregas · ${rateLabel(driver.entregas_planejadas ? (driver.entregas_realizadas / driver.entregas_planejadas) * 100 : null)} realizadas · Motivos: ${(driver.motivos ?? []).filter((reason) => reason.tipo_operacao === "ENTREGA").map((reason) => `${reason.motivo} (${countFormat.format(reason.quantidade)})`).join(" · ") || "nenhum registrado"}`,
            }))} />
          <DetailList title="Coletas por motorista" note="Volumes coletivos das equipes lideradas por cada motorista." items={[...(selection.deliveryType.motoristas ?? [])]
            .sort((a, b) => b.coletas_planejadas - a.coletas_planejadas || a.nome.localeCompare(b.nome, "pt-BR"))
            .filter((driver) => driver.coletas_planejadas > 0)
            .map((driver) => ({
              label: driver.nome,
              value: `${countFormat.format(driver.coletas_realizadas)} realizadas · ${countFormat.format(driver.coletas_nao_realizadas)} não realizadas`,
              detail: `${countFormat.format(driver.coletas_planejadas)} coletas · ${rateLabel(driver.coletas_planejadas ? (driver.coletas_realizadas / driver.coletas_planejadas) * 100 : null)} realizadas · Motivos: ${(driver.motivos ?? []).filter((reason) => reason.tipo_operacao === "COLETA").map((reason) => `${reason.motivo} (${countFormat.format(reason.quantidade)})`).join(" · ") || "nenhum registrado"}`,
            }))} />
        </>}

        {selection.kind === "team" && <>
          <p className={cx(styles, commonStyles, "detail-intro")}>Resultado coletivo da equipe liderada por <strong>{selection.team.motorista ?? "motorista não informado"}</strong>. Cada participante compartilha os volumes registrados nos lançamentos da equipe.</p>
          <MetricGrid items={[
            { label: "Motorista responsável", value: selection.team.motorista ?? "Não informado" },
            { label: "Lançamentos", value: countFormat.format(selection.team.lancamentos) },
            { label: "Elogios", value: selection.team.elogios === null ? "—" : countFormat.format(selection.team.elogios) },
            { label: "Reclamações", value: selection.team.reclamacoes === null ? "—" : countFormat.format(selection.team.reclamacoes) },
          ]} />
          <OperationResults
            delivery={{ completed: selection.team.entregas_realizadas, notCompleted: selection.team.entregas_nao_realizadas }}
            collection={{ completed: selection.team.coletas_realizadas, notCompleted: selection.team.coletas_nao_realizadas }}
          />
          <DetailList title="Motivos de entrega registrados para a equipe" note="As ocorrências são coletivas e não identificam quem causou o problema." items={[...(selection.team.motivos ?? [])].filter((reason) => reason.tipo_operacao === "ENTREGA")
            .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR"))
            .map((reason) => ({ label: reason.motivo, value: countFormat.format(reason.quantidade), detail: `${reasonGroupLabel(reason.grupo_motivo)} · ${rateLabel(reason.percentual_das_nao_realizadas)} das não realizadas · ${rateLabel(reason.incidencia_sobre_total)} do total` }))} />
          <DetailList title="Motivos de coleta registrados para a equipe" note="As ocorrências são coletivas e não identificam quem causou o problema." items={[...(selection.team.motivos ?? [])].filter((reason) => reason.tipo_operacao === "COLETA")
            .sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR"))
            .map((reason) => ({ label: reason.motivo, value: countFormat.format(reason.quantidade), detail: `${reasonGroupLabel(reason.grupo_motivo)} · ${rateLabel(reason.percentual_das_nao_realizadas)} das não realizadas · ${rateLabel(reason.incidencia_sobre_total)} do total` }))} />
        </>}
      </div>
    </>}
  </dialog>;
}
