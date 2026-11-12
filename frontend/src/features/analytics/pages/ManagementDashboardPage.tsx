import { useEffect, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import styles from "./ManagementDashboardPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { analyticsApi } from "../api";
import type { DashboardGoal, DashboardLocality, DashboardResponse, DashboardTrendPoint } from "../types";
import { catalogsApi } from "../../catalogs/api";
import type { LocalityCatalogItem } from "../../deliveries/types";
import { deliveryTransportLabel, nonDeliveryReasonGroupLabel } from "../../deliveries/classifications";
import type { DeliveryTransportType, NonDeliveryReasonGroup } from "../../deliveries/classifications";
import { messageFromApiError } from "../../../shared/api/apiError";
import { DashboardDetailDialog } from "./DashboardDetailDialog";
import type { DashboardDetailSelection } from "./DashboardDetailDialog";

const countFormat = new Intl.NumberFormat("pt-BR");
const percentageFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const currentMonth = localDate(new Date()).slice(0, 7);
const currentYear = String(new Date().getFullYear());
const currentQuarter = `${currentYear}-T${Math.ceil((new Date().getMonth() + 1) / 3)}`;

function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function firstDayOfCurrentMonth(): string {
  const date = new Date();
  date.setDate(1);
  return localDate(date);
}

function rateLabel(value: number | null): string {
  return value === null ? "—" : `${percentageFormat.format(value)}%`;
}

function reasonGroupLabel(value: string | null): string {
  return value === null
    ? "Sem classificação (histórico)"
    : nonDeliveryReasonGroupLabel(value as NonDeliveryReasonGroup);
}

function operationLabel(value: "ENTREGA" | "COLETA"): string {
  return value === "COLETA" ? "Coleta" : "Entrega";
}

function ReasonPercentageGuide({ kind }: { kind: "motivo" | "grupo" }) {
  const subject = kind === "grupo" ? "um motivo deste grupo" : "este motivo";

  return <div className={cx(styles, commonStyles, "reason-percent-guide")} aria-label="Como interpretar as porcentagens">
    <div className={cx(styles, commonStyles, "reason-percent-card")}>
      <span className={cx(styles, commonStyles, "reason-percent-index")}>1</span>
      <div><strong>Entre as não realizadas</strong><p>Das entregas ou coletas não realizadas, quantas tiveram {subject}?</p></div>
    </div>
    <div className={cx(styles, commonStyles, "reason-percent-card")}>
      <span className={cx(styles, commonStyles, "reason-percent-index")}>2</span>
      <div><strong>No total da operação</strong><p>De todas as entregas ou coletas registradas, quantas tiveram {subject}? Inclui as realizadas.</p></div>
    </div>
  </div>;
}

function deliveryTypeLabel(value: string | null): string {
  if (value === "MISTO") return "Equipe mista (histórico)";
  return value === null
    ? "Sem classificação (histórico)"
    : deliveryTransportLabel(value as DeliveryTransportType);
}

function shortDate(value: string, monthly: boolean): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day ?? 1);
  return new Intl.DateTimeFormat("pt-BR", monthly
    ? { month: "short", year: "2-digit" }
    : { day: "2-digit", month: "2-digit" }).format(date);
}

function dateTimeLabel(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function dashboardGoalRange(
  periodicity: DashboardGoal["periodicidade"],
  monthReference: string,
  quarterReference: string,
  yearReference: string,
): { from: string; to: string; label: string } | null {
  let year: number;
  let startMonth: number;
  let endMonth: number;
  let label: string;

  if (periodicity === "MENSAL") {
    const [yearPart, monthPart] = monthReference.split("-").map(Number);
    if (!yearPart || !monthPart || monthPart < 1 || monthPart > 12) return null;
    year = yearPart;
    startMonth = monthPart;
    endMonth = monthPart;
    label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(year, monthPart - 1, 1));
  } else if (periodicity === "TRIMESTRAL") {
    const match = /^(\d{4})-T([1-4])$/.exec(quarterReference);
    if (!match) return null;
    year = Number(match[1]);
    startMonth = (Number(match[2]) - 1) * 3 + 1;
    endMonth = startMonth + 2;
    label = `${match[2]}º trimestre de ${year}`;
  } else {
    year = Number(yearReference);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
    startMonth = 1;
    endMonth = 12;
    label = String(year);
  }

  return {
    from: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    to: localDate(new Date(year, endMonth, 0)),
    label,
  };
}

function goalRate(data: DashboardResponse | null, scope: DashboardGoal["escopo_operacao"]): number | null {
  if (!data) return null;
  const summary = data.resumo;
  const completed = scope === "ENTREGAS"
    ? summary.entregas_realizadas
    : scope === "COLETAS"
      ? summary.coletas_realizadas
      : summary.entregas_realizadas + summary.coletas_realizadas;
  const notCompleted = scope === "ENTREGAS"
    ? summary.entregas_nao_realizadas
    : scope === "COLETAS"
      ? summary.coletas_nao_realizadas
      : summary.entregas_nao_realizadas + summary.coletas_nao_realizadas;
  const total = completed + notCompleted;
  return total ? (completed / total) * 100 : null;
}

function goalScopeLabel(scope: DashboardGoal["escopo_operacao"]): string {
  if (scope === "ENTREGAS") return "Entregas";
  if (scope === "COLETAS") return "Coletas";
  return "Entregas e coletas";
}

function goalPeriodicityLabel(periodicity: DashboardGoal["periodicidade"]): string {
  if (periodicity === "TRIMESTRAL") return "trimestre";
  if (periodicity === "ANUAL") return "ano";
  return "mês";
}

function aggregateTrend(points: DashboardTrendPoint[], monthly: boolean): DashboardTrendPoint[] {
  if (!monthly) return points;
  const grouped = new Map<string, DashboardTrendPoint>();
  points.forEach((point) => {
    const month = point.data.slice(0, 7);
    const current = grouped.get(month) ?? {
      data: `${month}-01`, planejadas: 0, realizadas: 0, nao_realizadas: 0,
      taxa_realizacao: null, otif_percentual: null,
      entregas_realizadas: 0, entregas_nao_realizadas: 0,
      coletas_realizadas: 0, coletas_nao_realizadas: 0,
    };
    current.planejadas += point.planejadas;
    current.realizadas += point.realizadas;
    current.nao_realizadas += point.nao_realizadas;
    current.entregas_realizadas += point.entregas_realizadas;
    current.entregas_nao_realizadas += point.entregas_nao_realizadas;
    current.coletas_realizadas += point.coletas_realizadas;
    current.coletas_nao_realizadas += point.coletas_nao_realizadas;
    const total = current.realizadas + current.nao_realizadas;
    current.taxa_realizacao = total ? (current.realizadas / total) * 100 : null;
    current.otif_percentual = total ? (current.nao_realizadas / total) * 100 : null;
    grouped.set(month, current);
  });
  return [...grouped.values()];
}

function sortLocalities(localities: DashboardLocality[], sort: "taxa" | "alfabetica"): DashboardLocality[] {
  return [...localities].sort((a, b) => sort === "alfabetica"
    ? a.nome.localeCompare(b.nome, "pt-BR")
    : (b.taxa_realizacao ?? -1) - (a.taxa_realizacao ?? -1) || a.nome.localeCompare(b.nome, "pt-BR"));
}

function TrendChart({ points, monthly, onSelect }: { points: DashboardTrendPoint[]; monthly: boolean; onSelect: (point: DashboardTrendPoint) => void }) {
  const values = aggregateTrend(points, monthly).filter((point) => point.otif_percentual !== null);
  if (!values.length) return <div className={cx(styles, commonStyles, "manager-empty")}>Sem lançamentos registrados neste período.</div>;

  const width = 760;
  const height = 250;
  const left = 46;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const x = (index: number) => values.length === 1 ? left + chartWidth / 2 : left + (index / (values.length - 1)) * chartWidth;
  const y = (value: number | null) => top + ((100 - (value ?? 0)) / 100) * chartHeight;
  const line = values.map((point, index) => `${x(index)},${y(point.otif_percentual)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(values.length / 6));

  return (
    <div className={cx(styles, commonStyles, "trend-chart-wrap")}>
      <svg className={cx(styles, commonStyles, "trend-chart")} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolução percentual do OTIF no período">
        <title>Evolução do OTIF</title>
        <desc>Percentual de entregas e coletas não realizadas sobre o total registrado em cada dia ou mês selecionado.</desc>
        {[0, 50, 100].map((tick) => {
          const tickY = y(tick);
          return <g key={tick}><line x1={left} x2={width - right} y1={tickY} y2={tickY} className={cx(styles, commonStyles, "chart-grid-line")} /><text x={left - 9} y={tickY + 4} textAnchor="end" className={cx(styles, commonStyles, "chart-axis-label")}>{tick}%</text></g>;
        })}
        <polyline points={line} className={cx(styles, commonStyles, "trend-line")} />
        {values.map((point, index) => <g
          key={point.data}
          className={cx(styles, commonStyles, "trend-point-button")}
          role="button"
          tabIndex={0}
          aria-label={`${shortDate(point.data, monthly)}: OTIF ${rateLabel(point.otif_percentual)}. Abrir detalhes.`}
          onClick={() => onSelect(point)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(point); }
          }}
        ><circle cx={x(index)} cy={y(point.otif_percentual)} r="5" className={cx(styles, commonStyles, "trend-point")} /></g>)}
        {values.map((point, index) => (index % labelEvery === 0 || index === values.length - 1)
          ? <text key={`${point.data}-label`} x={x(index)} y={height - 13} textAnchor="middle" className={cx(styles, commonStyles, "chart-axis-label")}>{shortDate(point.data, monthly)}</text>
          : null)}
      </svg>
    </div>
  );
}

function OperationComposition({ title, completed, notCompleted, onSelect }: { title: string; completed: number; notCompleted: number; onSelect: () => void }) {
  const total = completed + notCompleted;
  const doneWidth = total ? (completed / total) * 100 : 0;
  const failedWidth = total ? (notCompleted / total) * 100 : 0;
  return (
    <button className={cx(styles, commonStyles, "composition-body")} type="button" onClick={onSelect} aria-label={`Abrir detalhes da proporção de ${title.toLocaleLowerCase("pt-BR")}`}>
      <div className={cx(styles, commonStyles, "composition-bar")} aria-hidden="true">
        <span className={cx(styles, commonStyles, "composition-completed")} style={{ width: `${doneWidth}%` }} />
        <span className={cx(styles, commonStyles, "composition-not-completed")} style={{ width: `${failedWidth}%` }} />
      </div>
      <div className={cx(styles, commonStyles, "composition-legend")}>
        <span><i className={cx(styles, commonStyles, "legend-completed")} />Realizadas <strong>{countFormat.format(completed)} · {rateLabel(doneWidth)}</strong></span>
        <span><i className={cx(styles, commonStyles, "legend-not-completed")} />Não realizadas <strong>{countFormat.format(notCompleted)} · {rateLabel(failedWidth)}</strong></span>
      </div>
    </button>
  );
}

type HorizontalBarItem = {
  key: string;
  label: string;
  value: number | null;
  valueLabel: string;
  detail: string;
};

function HorizontalBarChart({
  items,
  scaleMax,
  valueName,
  tone = "warning",
  onSelect,
}: {
  items: HorizontalBarItem[];
  scaleMax: number;
  valueName: string;
  tone?: "warning" | "success";
  onSelect: (item: HorizontalBarItem) => void;
}) {
  if (!items.length) return null;
  return <div className={cx(styles, commonStyles, "insight-chart")} role="group" aria-label={valueName}>
    <ol className={cx(styles, commonStyles, "insight-chart-list")}>
      {items.map((item) => {
        const width = item.value === null ? 0 : Math.min(100, Math.max(0, (item.value / scaleMax) * 100));
        return <li className={cx(styles, commonStyles, "insight-chart-row")} key={item.key}>
          <button className={cx(styles, commonStyles, "insight-chart-row-button")} type="button" aria-label={`${item.label}: ${item.valueLabel}. Abrir detalhes.`} onClick={() => onSelect(item)}>
            <div className={cx(styles, commonStyles, "insight-chart-row-label")}><span>{item.label}</span><strong>{item.valueLabel}</strong></div>
            <div className={cx(styles, commonStyles, "insight-chart-track")} aria-hidden="true">
              <i className={cx(styles, commonStyles, tone === "success" ? "insight-chart-bar-success" : "insight-chart-bar-warning")} style={{ width: `${width}%` }} />
            </div>
            {item.detail && <small>{item.detail}</small>}
          </button>
        </li>;
      })}
    </ol>
  </div>;
}

function DeliveryTypeChart({ items, onSelect }: { items: DashboardResponse["por_tipo_entrega"]; onSelect: (item: DashboardResponse["por_tipo_entrega"][number]) => void }) {
  if (!items.length) return null;
  return <div className={cx(styles, commonStyles, "delivery-type-chart")} role="group" aria-label="Entregas e coletas realizadas e não realizadas por tipo de transporte">
    {items.map((item) => {
      const total = item.realizadas + item.nao_realizadas;
      const completedWidth = total ? (item.realizadas / total) * 100 : 0;
      const failedWidth = total ? (item.nao_realizadas / total) * 100 : 0;
      return <button className={cx(styles, commonStyles, "delivery-type-chart-row")} type="button" key={item.tipo_transporte_entrega ?? "unclassified"} onClick={() => onSelect(item)} aria-label={`${deliveryTypeLabel(item.tipo_transporte_entrega)}: ${countFormat.format(item.realizadas)} realizadas, ${countFormat.format(item.nao_realizadas)} não realizadas e OTIF ${rateLabel(item.otif_percentual)}. Abrir detalhes.`}>
        <div className={cx(styles, commonStyles, "delivery-type-chart-heading")}><strong>{deliveryTypeLabel(item.tipo_transporte_entrega)}</strong><span>{rateLabel(item.taxa_realizacao)} realizadas</span></div>
        <div className={cx(styles, commonStyles, "delivery-type-chart-track")} aria-hidden="true">
          <i className={cx(styles, commonStyles, "delivery-type-chart-completed")} style={{ width: `${completedWidth}%` }} />
          <i className={cx(styles, commonStyles, "delivery-type-chart-failed")} style={{ width: `${failedWidth}%` }} />
        </div>
        <div className={cx(styles, commonStyles, "delivery-type-chart-legend")}>
          <span><i className={cx(styles, commonStyles, "legend-completed")} />Realizadas {countFormat.format(item.realizadas)}</span>
          <span><i className={cx(styles, commonStyles, "legend-not-completed")} />Não realizadas {countFormat.format(item.nao_realizadas)}</span>
          <small>{countFormat.format(item.registros_entrega)} registros de entrega · {countFormat.format(item.registros_coleta)} de coleta</small>
          <small>Entregas: {countFormat.format(item.entregas_realizadas)} realizadas / {countFormat.format(item.entregas_nao_realizadas)} não realizadas</small>
          <small>Coletas: {countFormat.format(item.coletas_realizadas)} realizadas / {countFormat.format(item.coletas_nao_realizadas)} não realizadas</small>
          <small>OTIF combinado: {rateLabel(item.otif_percentual)}</small>
        </div>
      </button>;
    })}
  </div>;
}

export function ManagementDashboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [activeTab, setActiveTab] = useState<"resumo" | "meta">("resumo");
  const [fromDate, setFromDate] = useState(firstDayOfCurrentMonth);
  const [toDate, setToDate] = useState(() => localDate(new Date()));
  const [localityId, setLocalityId] = useState("");
  const [transportType, setTransportType] = useState<"" | DeliveryTransportType>("");
  const [localities, setLocalities] = useState<LocalityCatalogItem[]>([]);
  const [localitiesLoading, setLocalitiesLoading] = useState(true);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [catalogReloadVersion, setCatalogReloadVersion] = useState(0);
  const [localitySort, setLocalitySort] = useState<"taxa" | "alfabetica">("taxa");
  const [teamSort, setTeamSort] = useState<"taxa-menor" | "taxa-maior" | "realizadas">("taxa-menor");
  const [detailSelection, setDetailSelection] = useState<DashboardDetailSelection | null>(null);
  const [localityDetailDashboard, setLocalityDetailDashboard] = useState<DashboardResponse | null>(null);
  const [localityDetailLoading, setLocalityDetailLoading] = useState(false);
  const [localityDetailError, setLocalityDetailError] = useState("");
  const [goal, setGoal] = useState<DashboardGoal | null>(null);
  const [goalValue, setGoalValue] = useState("95");
  const [goalPeriodicity, setGoalPeriodicity] = useState<DashboardGoal["periodicidade"]>("MENSAL");
  const [goalScope, setGoalScope] = useState<DashboardGoal["escopo_operacao"]>("TODAS");
  const [goalMonthReference, setGoalMonthReference] = useState(currentMonth);
  const [goalQuarterReference, setGoalQuarterReference] = useState(currentQuarter);
  const [goalYearReference, setGoalYearReference] = useState(currentYear);
  const [goalDashboard, setGoalDashboard] = useState<DashboardResponse | null>(null);
  const [goalDashboardLoading, setGoalDashboardLoading] = useState(false);
  const [goalDashboardError, setGoalDashboardError] = useState("");
  const [goalLoading, setGoalLoading] = useState(true);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalError, setGoalError] = useState("");
  const [goalSavedMessage, setGoalSavedMessage] = useState("");
  const [goalReloadVersion, setGoalReloadVersion] = useState(0);
  const [goalDashboardReloadVersion, setGoalDashboardReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLocalitiesLoading(true);
    void catalogsApi.localities()
      .then((page) => { if (active) { setLocalities(page.items); setCatalogError(""); } })
      .catch((loadError: unknown) => { if (active) setCatalogError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLocalitiesLoading(false); });
    return () => { active = false; };
  }, [catalogReloadVersion]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void analyticsApi.dashboard({
      data_de: fromDate || undefined,
      data_ate: toDate || undefined,
      id_localidade: localityId ? Number(localityId) : undefined,
      tipo_transporte_entrega: transportType || undefined,
    })
      .then((result) => { if (active) setData(result); })
      .catch((loadError: unknown) => { if (active) setError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fromDate, toDate, localityId, transportType, reloadVersion]);

  useEffect(() => {
    let active = true;
    setGoalLoading(true);
    setGoalError("");
    void analyticsApi.goal()
      .then((result) => {
        if (active) {
          setGoal(result);
          setGoalValue(String(result.valor_percentual));
          setGoalPeriodicity(result.periodicidade);
          setGoalScope(result.escopo_operacao);
        }
      })
      .catch((loadError: unknown) => { if (active) setGoalError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setGoalLoading(false); });
    return () => { active = false; };
  }, [goalReloadVersion]);

  const selectedGoalPeriod = useMemo(
    () => dashboardGoalRange(goalPeriodicity, goalMonthReference, goalQuarterReference, goalYearReference),
    [goalPeriodicity, goalMonthReference, goalQuarterReference, goalYearReference],
  );

  useEffect(() => {
    if (activeTab !== "meta") return;
    if (!selectedGoalPeriod) {
      setGoalDashboardError("Escolha um período válido para consultar a meta.");
      setGoalDashboard(null);
      setGoalDashboardLoading(false);
      return;
    }
    let active = true;
    setGoalDashboardLoading(true);
    setGoalDashboardError("");
    void analyticsApi.dashboard({ data_de: selectedGoalPeriod.from, data_ate: selectedGoalPeriod.to })
      .then((result) => { if (active) setGoalDashboard(result); })
      .catch((loadError: unknown) => { if (active) setGoalDashboardError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setGoalDashboardLoading(false); });
    return () => { active = false; };
  }, [activeTab, selectedGoalPeriod, goalDashboardReloadVersion]);

  useEffect(() => {
    if (detailSelection?.kind !== "locality") {
      setLocalityDetailDashboard(null);
      setLocalityDetailLoading(false);
      setLocalityDetailError("");
      return;
    }
    let active = true;
    setLocalityDetailDashboard(null);
    setLocalityDetailLoading(true);
    setLocalityDetailError("");
    void analyticsApi.dashboard({
      data_de: fromDate || undefined,
      data_ate: toDate || undefined,
      id_localidade: detailSelection.locality.id_localidade,
      tipo_transporte_entrega: transportType || undefined,
    })
      .then((result) => { if (active) setLocalityDetailDashboard(result); })
      .catch((loadError: unknown) => { if (active) setLocalityDetailError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLocalityDetailLoading(false); });
    return () => { active = false; };
  }, [detailSelection, fromDate, toDate, transportType]);

  const monthlyTrend = useMemo(() => {
    if (!fromDate || !toDate) return true;
    const start = new Date(`${fromDate}T00:00:00`);
    const end = new Date(`${toDate}T00:00:00`);
    return (end.getTime() - start.getTime()) / 86_400_000 > 93;
  }, [fromDate, toDate]);

  const summary = data?.resumo;
  const feedback = data?.feedback;
  const feedbackAvailable = feedback?.disponivel ?? false;
  const localityPerformance = useMemo<DashboardLocality[]>(() => {
    const totalsByLocality = new Map((data?.por_localidade ?? []).map((item) => [item.id_localidade, item]));
    const visibleLocalities = localityId
      ? localities.filter((locality) => locality.id_localidade === Number(localityId))
      : localities;
    return visibleLocalities.map((locality) => totalsByLocality.get(locality.id_localidade) ?? {
      id_localidade: locality.id_localidade,
      nome: locality.nome_localidade,
      lancamentos: 0,
      itens_planejados: 0,
      realizadas: 0,
      nao_realizadas: 0,
      taxa_realizacao: null,
      otif_percentual: null,
      entregas_realizadas: 0,
      entregas_nao_realizadas: 0,
      coletas_realizadas: 0,
      coletas_nao_realizadas: 0,
      elogios: feedbackAvailable ? 0 : null,
      reclamacoes: feedbackAvailable ? 0 : null,
    });
  }, [data, feedbackAvailable, localities, localityId]);
  const orderedLocalityPerformance = useMemo(() => sortLocalities(localityPerformance, localitySort), [localityPerformance, localitySort]);
  const currentGoalValue = goal?.valor_percentual ?? null;
  const currentRate = goalRate(goalDashboard, goalScope);
  const goalReached = currentGoalValue !== null && currentRate !== null && currentRate >= currentGoalValue;
  function resetFilters() {
    setFromDate(firstDayOfCurrentMonth());
    setToDate(localDate(new Date()));
    setLocalityId("");
    setTransportType("");
  }

  async function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(goalValue.replace(",", "."));
    if (!Number.isFinite(value) || value < 0 || value > 100 || Math.round(value * 100) !== value * 100) {
      setGoalError("Informe um percentual entre 0 e 100, com até duas casas decimais.");
      return;
    }
    setGoalSaving(true);
    setGoalError("");
    setGoalSavedMessage("");
    try {
      const updated = await analyticsApi.updateGoal(value, goalPeriodicity, goalScope);
      setGoal(updated);
      setGoalValue(String(updated.valor_percentual));
      setGoalPeriodicity(updated.periodicidade);
      setGoalScope(updated.escopo_operacao);
      setGoalSavedMessage("Meta atualizada.");
    } catch (saveError) {
      setGoalError(messageFromApiError(saveError));
    } finally {
      setGoalSaving(false);
    }
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextTab = event.key === "Home" ? "resumo"
      : event.key === "End" ? "meta"
        : activeTab === "resumo" ? "meta" : "resumo";
    setActiveTab(nextTab);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-dashboard-tab="${nextTab}"]`)?.focus();
  }

  return (
    <div className={cx(styles, commonStyles, "portal-page", "page-stack", "manager-dashboard-page")}>
      <div className={cx(styles, commonStyles, "page-heading-row", "manager-heading")}>
        <div>
          <h1>Painel gerencial</h1>
          <p className={cx(styles, commonStyles, "page-lead")}>Performance dos lançamentos confirmados, com um único recorte aplicado a todos os indicadores.</p>
        </div>
        <div className={cx(styles, commonStyles, "manager-heading-status")}>
          <span className={cx(styles, commonStyles, "registered-status-dot")} />{activeTab === "meta" ? "Meta por período" : loading ? "Atualizando" : `${countFormat.format(summary?.lancamentos_registrados ?? 0)} lançamentos registrados`}
        </div>
      </div>

      <div className={cx(styles, commonStyles, "manager-tabs")} role="tablist" aria-label="Seções do painel gerencial">
        <button className={cx(styles, commonStyles, "manager-tab", activeTab === "resumo" && "manager-tab-active")} id="manager-tab-resumo" data-dashboard-tab="resumo" type="button" role="tab" aria-selected={activeTab === "resumo"} aria-controls="manager-panel-resumo" tabIndex={activeTab === "resumo" ? 0 : -1} onClick={() => setActiveTab("resumo")} onKeyDown={handleTabKeyDown}>Visão geral</button>
        <button className={cx(styles, commonStyles, "manager-tab", activeTab === "meta" && "manager-tab-active")} id="manager-tab-meta" data-dashboard-tab="meta" type="button" role="tab" aria-selected={activeTab === "meta"} aria-controls="manager-panel-meta" tabIndex={activeTab === "meta" ? 0 : -1} onClick={() => setActiveTab("meta")} onKeyDown={handleTabKeyDown}>Meta</button>
      </div>

      {activeTab === "resumo" && <>
      <section className={cx(styles, commonStyles, "manager-filter-card manager-dashboard-filter-card")} aria-label="Filtros do painel">
        <label className={cx(styles, commonStyles, "filter-control")}><span>Data inicial</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}><span>Data final</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}><span>Loja / localidade</span><select value={localityId} disabled={localitiesLoading || Boolean(catalogError)} onChange={(event) => setLocalityId(event.target.value)}><option value="">{localitiesLoading ? "Carregando localidades..." : "Todas as localidades ativas"}</option>{localities.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}</select></label>
        <label className={cx(styles, commonStyles, "filter-control")}><span>Tipo de entrega</span><select value={transportType} onChange={(event) => setTransportType(event.target.value as "" | DeliveryTransportType)}><option value="">Próprias e terceirizadas</option><option value="PROPRIA">Entregas próprias</option><option value="TERCEIRIZADA">Entregas terceirizadas</option></select></label>
        <button className={cx(styles, commonStyles, "manager-reset-button")} type="button" onClick={resetFilters}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6.5A6.5 6.5 0 1 1 3.6 11" /><path d="M4 3.8v3.5h3.5" /></svg><span>Limpar filtros</span></button>
        <span className={cx(styles, commonStyles, "manager-filter-note")}>O tipo da equipe filtra todos os indicadores junto com o período e a localidade.</span>
      </section>

      <details className={cx(styles, commonStyles, "methodology-details")}>
        <summary><span>Como os indicadores são calculados</span><span className={cx(styles, commonStyles, "methodology-toggle-label")}>Ver critérios</span><span className={cx(styles, commonStyles, "methodology-toggle-label-open")}>Ocultar critérios</span></summary>
        <div className={cx(styles, commonStyles, "methodology-content")}>
          <p><strong>Base:</strong> versão confirmada mais recente de cada lançamento no período e escopo selecionados.</p>
          <p><strong>Total registrado:</strong> soma das entregas e coletas realizadas e não realizadas no período.</p>
          <p><strong>Taxa de realização:</strong> entregas e coletas realizadas ÷ total registrado.</p>
          <p><strong>OTIF:</strong> entregas e coletas não realizadas ÷ total registrado; os volumes permanecem identificados por operação.</p>
          <p><strong>Ranking:</strong> motoristas e ajudantes aparecem juntos na página Indicadores por pessoa. A posição usa taxa de realização, score de atendimento (+1 por elogio e −1 por reclamação), volume realizado e nome como desempate.</p>
          <p><strong>Volumes por pessoa:</strong> as quantidades são o resultado das equipes em que a pessoa participou. Elas aparecem para cada integrante e não devem ser somadas entre pessoas.</p>
          <p><strong>Motivos por pessoa:</strong> mostram as ocorrências das equipes em que a pessoa trabalhou; cada ocorrência aparece para todos os integrantes e não indica responsabilidade individual. Os motivos ainda não alteram o score de atendimento.</p>
          <p><strong>Motivos:</strong> cada item identifica se pertence a entregas ou coletas; os percentuais usam os volumes da própria operação e o detalhe mostra somente essa operação.</p>
          <p><strong>Tipo de entrega:</strong> é calculado pela classificação das pessoas da equipe. Equipes antigas sem classificação aparecem separadas; equipes antigas mistas são identificadas como mistas.</p>
          <p><strong>Status:</strong> indica se o cadastro da pessoa está ativo ou inativo; não representa uma faixa de desempenho.</p>
          {!feedbackAvailable && <p><strong>Feedback:</strong> elogios e reclamações aparecem quando as tabelas opcionais de feedback estiverem disponíveis no banco.</p>}
        </div>
      </details>
      </>}

      {activeTab === "resumo" && (error || catalogError) && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>Não foi possível carregar todos os dados{error ? `: ${error}` : `: ${catalogError}`}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { if (error) setReloadVersion((version) => version + 1); if (catalogError) setCatalogReloadVersion((version) => version + 1); }}>Tentar novamente</button></div>}

      {activeTab === "resumo" && <div id="manager-panel-resumo" className={cx(styles, commonStyles, "manager-tab-panel")} role="tabpanel" aria-labelledby="manager-tab-resumo" tabIndex={0}>
      <section className={cx(styles, commonStyles, "manager-metrics")} aria-label="Resumo do período" aria-busy={loading}>
        <article className={cx(styles, commonStyles, "manager-metric")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Total registrado</span><strong>{loading ? "—" : countFormat.format(summary?.itens_planejados ?? 0)}</strong><small>realizadas + não realizadas</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "metric-completed")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Entregas realizadas</span><strong>{loading ? "—" : countFormat.format(summary?.entregas_realizadas ?? 0)}</strong><small>somente entregas</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "metric-not-completed")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Entregas não realizadas</span><strong>{loading ? "—" : countFormat.format(summary?.entregas_nao_realizadas ?? 0)}</strong><small>somente entregas</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "metric-completed")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Coletas realizadas</span><strong>{loading ? "—" : countFormat.format(summary?.coletas_realizadas ?? 0)}</strong><small>somente coletas</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "metric-not-completed")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Coletas não realizadas</span><strong>{loading ? "—" : countFormat.format(summary?.coletas_nao_realizadas ?? 0)}</strong><small>somente coletas</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "manager-metric-highlight")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Taxa de realização</span><strong>{loading ? "—" : rateLabel(summary?.taxa_realizacao ?? null)}</strong><small>realizadas ÷ total registrado</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "manager-metric-highlight", "metric-not-completed")}><span className={cx(styles, commonStyles, "manager-metric-label")}>OTIF</span><strong>{loading ? "—" : rateLabel(summary?.otif_percentual ?? null)}</strong><small>não realizadas ÷ total registrado</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "metric-praise")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Elogios</span><strong>{loading || !feedbackAvailable ? "—" : countFormat.format(feedback?.elogios ?? 0)}</strong><small>{feedbackAvailable ? "associados a lançamentos registrados" : "módulo de feedback indisponível"}</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "metric-complaint")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Reclamações</span><strong>{loading || !feedbackAvailable ? "—" : countFormat.format(feedback?.reclamacoes ?? 0)}</strong><small>{feedbackAvailable ? "associadas a lançamentos registrados" : "módulo de feedback indisponível"}</small></article>
      </section>

      <section className={cx(styles, commonStyles, "otif-definition-note")} aria-label="Nota sobre o cálculo de OTIF">
        <span className={cx(styles, commonStyles, "otif-note-icon")} aria-hidden="true">i</span>
        <div><strong>Como o OTIF é calculado</strong><p>(Entregas + coletas) não realizadas ÷ total de entregas e coletas registradas. Os cartões e gráficos detalhados também mostram cada operação separadamente.</p></div>
      </section>

      <div className={cx(styles, commonStyles, "manager-overview-grid")}>
        <section className={cx(styles, commonStyles, "manager-panel", "trend-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Evolução do OTIF</h2><p>Dia a dia{monthlyTrend ? " agrupada por mês" : ""} no período filtrado</p></div><span>{loading ? "—" : `${data?.evolucao.length ?? 0} períodos com movimento`}</span></div>
          {loading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando evolução...</div> : <TrendChart points={data?.evolucao ?? []} monthly={monthlyTrend} onSelect={(point) => setDetailSelection({ kind: "trend", title: `OTIF · ${shortDate(point.data, monthlyTrend)}`, point })} />}
        </section>
        <section className={cx(styles, commonStyles, "manager-panel", "composition-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Proporção de entregas e coletas</h2><p>Realizadas e não realizadas, somadas para o OTIF</p></div></div>
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando composição...</div> : summary?.itens_planejados ? <OperationComposition title="Entregas e coletas" completed={summary.entregas_realizadas + summary.coletas_realizadas} notCompleted={summary.entregas_nao_realizadas + summary.coletas_nao_realizadas} onSelect={() => setDetailSelection({ kind: "composition", title: "Proporção de entregas e coletas" })} /> : <div className={cx(styles, commonStyles, "manager-empty")}>Sem lançamentos registrados neste período.</div>}
          <div className={cx(styles, commonStyles, "composition-rate")}><span>Taxa de realização no recorte</span><strong>{loading ? "—" : rateLabel(summary?.taxa_realizacao ?? null)}</strong></div>
        </section>
      </div>

      <section className={cx(styles, commonStyles, "manager-panel")}>
        <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Performance por loja</h2><p>Volume, resultado e relacionamento com clientes no mesmo período</p></div><label className={cx(styles, commonStyles, "locality-sort-control")}><span>Ordenar</span><select aria-label="Ordenar performance por loja" value={localitySort} onChange={(event) => setLocalitySort(event.target.value as "taxa" | "alfabetica")}><option value="taxa">Maior taxa primeiro</option><option value="alfabetica">Ordem alfabética</option></select></label><span>{loading || localitiesLoading ? "Carregando..." : `${localityPerformance.length} localidades`}</span></div>
        {loading || localitiesLoading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando lojas ativas...</div> : !localityPerformance.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Não há localidades ativas disponíveis para os filtros selecionados.</div> : <>
          <p className={cx(styles, commonStyles, "insight-chart-caption")}>{localitySort === "taxa" ? "As lojas são ordenadas pela taxa de entregas e coletas realizadas, da maior para a menor; nomes desempatarão em ordem alfabética." : "As lojas são exibidas em ordem alfabética. Clique em uma loja para ver os fatores da performance e os motivos associados."}</p>
          <HorizontalBarChart
            items={orderedLocalityPerformance.map((locality) => ({
              key: String(locality.id_localidade),
              label: locality.nome,
              value: locality.taxa_realizacao,
              valueLabel: rateLabel(locality.taxa_realizacao),
              detail: `${countFormat.format(locality.itens_planejados)} entregas e coletas · ${countFormat.format(locality.lancamentos)} lançamentos · ${rateLabel(locality.otif_percentual)} OTIF · ${locality.elogios === null ? "—" : countFormat.format(locality.elogios)} elogios · ${locality.reclamacoes === null ? "—" : countFormat.format(locality.reclamacoes)} reclamações`,
            }))}
            scaleMax={100}
            valueName="Taxa de realização por loja"
            tone="success"
            onSelect={(bar) => {
              const locality = localityPerformance.find((item) => String(item.id_localidade) === bar.key);
              if (locality) setDetailSelection({ kind: "locality", title: locality.nome, locality });
            }}
          />
        </>}
      </section>

      <div className={cx(styles, commonStyles, "manager-analysis-grid")}>
        <section className={cx(styles, commonStyles, "manager-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Não realizadas por grupo de motivo</h2><p>Percentual das não realizadas e incidência no total</p></div><span>{loading ? "—" : `${data?.por_grupo_motivo.length ?? 0} grupos`}</span></div>
          {!loading && !!data?.por_grupo_motivo.length && <ReasonPercentageGuide kind="grupo" />}
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando grupos...</div> : !data?.por_grupo_motivo.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Nenhuma ocorrência de não realização.</div> : <HorizontalBarChart
            items={[...data.por_grupo_motivo].sort((a, b) => b.quantidade - a.quantidade).map((group) => ({ key: `${group.tipo_operacao}:${group.grupo_motivo ?? "unclassified"}`, label: `${operationLabel(group.tipo_operacao)} · ${reasonGroupLabel(group.grupo_motivo)}`, value: group.quantidade, valueLabel: countFormat.format(group.quantidade), detail: `${rateLabel(group.percentual_das_nao_realizadas)} das ${operationLabel(group.tipo_operacao).toLowerCase()}s não realizadas · ${rateLabel(group.incidencia_sobre_total)} do total dessa operação` }))}
            scaleMax={Math.max(1, ...data.por_grupo_motivo.map((group) => group.quantidade))}
            valueName="Quantidade de não realizadas por grupo de motivo e operação"
            onSelect={(bar) => {
              const [operation, ...groupParts] = bar.key.split(":");
              const groupName = groupParts.join(":");
              const group = data.por_grupo_motivo.find((item) => item.tipo_operacao === operation && (item.grupo_motivo ?? "unclassified") === groupName);
              if (group) setDetailSelection({ kind: "reason-group", title: `${operationLabel(group.tipo_operacao)} · ${reasonGroupLabel(group.grupo_motivo)}`, group });
            }}
          />}
        </section>
        <section className={cx(styles, commonStyles, "manager-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Entregas próprias e terceirizadas</h2><p>Resultado por tipo informado no cadastro da equipe</p></div><span>{loading ? "—" : `${data?.por_tipo_entrega.length ?? 0} tipos`}</span></div>
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando tipos...</div> : !data?.por_tipo_entrega.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Não há entregas no período.</div> : <>
            <DeliveryTypeChart items={data.por_tipo_entrega} onSelect={(deliveryType) => setDetailSelection({ kind: "delivery-type", title: deliveryTypeLabel(deliveryType.tipo_transporte_entrega), deliveryType })} />
          </>}
        </section>
      </div>

      <section className={cx(styles, commonStyles, "manager-panel")}>
        <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Não realizadas por motivo</h2><p>Quantidade, grupo associado e participação nas entregas e coletas do período</p></div><span>{loading ? "—" : `${data?.por_motivo.length ?? 0} motivos`}</span></div>
        {!loading && !!data?.por_motivo.length && <ReasonPercentageGuide kind="motivo" />}
        {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando motivos...</div> : !data?.por_motivo.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Nenhuma ocorrência de não realização.</div> : <HorizontalBarChart
          items={[...data.por_motivo].sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR")).map((reason) => ({ key: `${reason.tipo_operacao}:${reason.id_motivo}`, label: `${operationLabel(reason.tipo_operacao)} · ${reason.motivo}`, value: reason.quantidade, valueLabel: countFormat.format(reason.quantidade), detail: `${reasonGroupLabel(reason.grupo_motivo)} · ${rateLabel(reason.percentual_das_nao_realizadas)} das ${operationLabel(reason.tipo_operacao).toLowerCase()}s não realizadas · ${rateLabel(reason.incidencia_sobre_total)} do total dessa operação` }))}
          scaleMax={Math.max(1, ...data.por_motivo.map((reason) => reason.quantidade))}
          valueName="Quantidade de não realizadas por motivo e operação"
          onSelect={(bar) => {
            const [operation, id] = bar.key.split(":");
            const reason = data.por_motivo.find((item) => item.tipo_operacao === operation && item.id_motivo === Number(id));
            if (reason) setDetailSelection({ kind: "reason", title: `${operationLabel(reason.tipo_operacao)} · ${reason.motivo}`, reason });
          }}
        />}
      </section>

      <div className={cx(styles, commonStyles, "manager-analysis-grid")}>
        <section className={cx(styles, commonStyles, "manager-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Taxa de realização por equipe</h2><p>Resultado coletivo das equipes no recorte</p></div><label className={cx(styles, commonStyles, "locality-sort-control")}><span>Ordenar</span><select aria-label="Ordenar equipes" value={teamSort} onChange={(event) => setTeamSort(event.target.value as typeof teamSort)}><option value="taxa-maior">Maior taxa primeiro</option><option value="taxa-menor">Menor taxa primeiro</option><option value="realizadas">Mais realizadas primeiro</option></select></label><span>{loading ? "—" : `${data?.por_equipe.length ?? 0} equipes`}</span></div>
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando equipes...</div> : !data?.por_equipe.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Não há equipes com lançamentos registrados.</div> : <>
            <p className={cx(styles, commonStyles, "insight-chart-caption")}>{teamSort === "taxa-menor" ? "Menor taxa primeiro" : teamSort === "taxa-maior" ? "Maior taxa primeiro" : "Maior quantidade realizada primeiro"}. Volume e OTIF incluem entregas e coletas.</p>
            <HorizontalBarChart items={[...data.por_equipe].sort((a, b) => {
              if (teamSort === "realizadas") return b.realizadas - a.realizadas || a.equipe.localeCompare(b.equipe, "pt-BR");
              const rateOrder = (a.taxa_realizacao ?? -1) - (b.taxa_realizacao ?? -1);
              return (teamSort === "taxa-maior" ? -rateOrder : rateOrder) || b.itens_planejados - a.itens_planejados || a.equipe.localeCompare(b.equipe, "pt-BR");
            }).map((team) => ({ key: team.chave, label: team.equipe, value: team.taxa_realizacao, valueLabel: rateLabel(team.taxa_realizacao), detail: `${countFormat.format(team.realizadas)} realizadas de ${countFormat.format(team.itens_planejados)} entregas e coletas · ${rateLabel(team.otif_percentual)} OTIF` }))} scaleMax={100} valueName="Taxa de realização por equipe" tone="success" onSelect={(bar) => {
              const team = data.por_equipe.find((item) => item.chave === bar.key);
              if (team) setDetailSelection({ kind: "team", title: team.equipe, team });
            }} />
          </>}
        </section>
        <section className={cx(styles, commonStyles, "manager-panel")}>
        <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Indicadores por pessoa</h2><p>Ranking completo com filtros por período, localidade, transporte, nome, função e situação cadastral.</p></div><button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={() => onNavigate("/indicadores/pessoas")}>Abrir ranking</button></div>
      </section>
      </div>

      </div>}

      {activeTab === "meta" && <section id="manager-panel-meta" className={cx(styles, commonStyles, "goal-panel")} role="tabpanel" aria-labelledby="manager-tab-meta" tabIndex={0}>
        <div className={cx(styles, commonStyles, "goal-panel-heading")}>
          <div><span className={cx(styles, commonStyles, "goal-eyebrow")}>ACOMPANHAMENTO DO PAINEL</span><h2>Meta de taxa de realização</h2><p>A meta é geral para o portal. Escolha um mês, trimestre ou ano para comparar o resultado de toda a operação.</p></div>
          <span className={cx(styles, commonStyles, "goal-status", goalReached && "goal-status-reached")}>{goalLoading || goalDashboardLoading ? "Carregando resultado" : goalReached ? "Meta atingida" : "Em acompanhamento"}</span>
        </div>

        {goalError && <div className={cx(styles, commonStyles, "notice notice-error", "goal-notice")} role="alert"><span>{goalError}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setGoalReloadVersion((version) => version + 1)}>Tentar novamente</button></div>}
        {goalDashboardError && <div className={cx(styles, commonStyles, "notice notice-error", "goal-notice")} role="alert"><span>{goalDashboardError}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setGoalDashboardReloadVersion((version) => version + 1)}>Recarregar resultado</button></div>}
        {goalSavedMessage && <div className={cx(styles, commonStyles, "notice notice-success", "goal-notice")} role="status">{goalSavedMessage}</div>}

        <div className={cx(styles, commonStyles, "goal-period-toolbar")}>
          <div><span className={cx(styles, commonStyles, "goal-eyebrow")}>PERÍODO AVALIADO</span><strong>{selectedGoalPeriod?.label ?? "Período inválido"}</strong><p>Resultado de {goalScopeLabel(goalScope).toLocaleLowerCase("pt-BR")} para este intervalo.</p></div>
          <div className={cx(styles, commonStyles, "goal-period-fields")}>
            {goalPeriodicity === "MENSAL" && <label htmlFor="dashboard-goal-month">Mês<input id="dashboard-goal-month" type="month" value={goalMonthReference} onChange={(event) => setGoalMonthReference(event.target.value)} /></label>}
            {goalPeriodicity === "TRIMESTRAL" && <>
              <label htmlFor="dashboard-goal-quarter">Trimestre<select id="dashboard-goal-quarter" value={goalQuarterReference.slice(-2)} onChange={(event) => setGoalQuarterReference(`${goalQuarterReference.slice(0, 4)}-${event.target.value}`)}><option value="T1">1º trimestre</option><option value="T2">2º trimestre</option><option value="T3">3º trimestre</option><option value="T4">4º trimestre</option></select></label>
              <label htmlFor="dashboard-goal-quarter-year">Ano<input id="dashboard-goal-quarter-year" type="number" min="2000" max="2100" value={goalQuarterReference.slice(0, 4)} onChange={(event) => setGoalQuarterReference(`${event.target.value}-T${goalQuarterReference.slice(-1)}`)} /></label>
            </>}
            {goalPeriodicity === "ANUAL" && <label htmlFor="dashboard-goal-year">Ano<input id="dashboard-goal-year" type="number" min="2000" max="2100" value={goalYearReference} onChange={(event) => setGoalYearReference(event.target.value)} /></label>}
          </div>
        </div>

        <div className={cx(styles, commonStyles, "goal-summary-grid")}>
          <article className={cx(styles, commonStyles, "goal-value-card")}>
            <span>Meta definida</span>
            <strong>{goalLoading || currentGoalValue === null ? "—" : rateLabel(currentGoalValue)}</strong>
            <small>{goalScopeLabel(goal?.escopo_operacao ?? "TODAS")} · avaliação {goalPeriodicityLabel(goal?.periodicidade ?? "MENSAL")}</small>
          </article>
          <article className={cx(styles, commonStyles, "goal-value-card", "goal-current-card")}>
            <span>Resultado do período</span>
            <strong>{goalDashboardLoading || currentRate === null ? "—" : rateLabel(currentRate)}</strong>
            <small>{goalDashboardLoading ? "Atualizando dados" : currentRate === null ? "Sem operações registradas neste período" : `${goalScopeLabel(goalScope)} realizadas ÷ total registrado`}</small>
          </article>
        </div>

        <div className={cx(styles, commonStyles, "goal-progress-section")}>
          <div className={cx(styles, commonStyles, "goal-progress-labels")}><span>Taxa atual <strong>{goalDashboardLoading ? "—" : rateLabel(currentRate)}</strong></span><span>Meta <strong>{goalLoading || currentGoalValue === null ? "—" : rateLabel(currentGoalValue)}</strong></span></div>
          <div className={cx(styles, commonStyles, "goal-progress-track")} role="progressbar" aria-label={`Taxa de realização de ${goalScopeLabel(goalScope).toLocaleLowerCase("pt-BR")}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={currentRate ?? 0} aria-valuetext={currentRate === null ? "Sem operações neste período" : `Taxa atual ${rateLabel(currentRate)}; meta ${rateLabel(currentGoalValue)}`}>
            <span className={cx(styles, commonStyles, "goal-progress-fill", goalReached && "goal-progress-fill-reached")} style={{ width: `${Math.max(0, Math.min(100, currentRate ?? 0))}%` }} />
            {currentGoalValue !== null && <i className={cx(styles, commonStyles, "goal-progress-marker")} style={{ left: `${currentGoalValue}%` }} aria-hidden="true" />}
          </div>
          <p className={cx(styles, commonStyles, "goal-progress-caption")}>
            {currentRate === null || currentGoalValue === null
              ? "Não há operações registradas para este período e escopo."
              : goalReached
                ? currentRate === currentGoalValue ? "A taxa atual chegou exatamente à meta." : `A taxa está ${rateLabel(currentRate - currentGoalValue)} acima da meta.`
                : `Faltam ${rateLabel(currentGoalValue - currentRate)} para alcançar a meta.`}
          </p>
        </div>

        <div className={cx(styles, commonStyles, "goal-management-row")}>
          <div className={cx(styles, commonStyles, "goal-audit-note")}>
            <strong>Como funciona</strong>
            <p>A meta vale para todas as lojas e equipes. O diretor define o percentual, a periodicidade e se acompanha entregas, coletas ou as duas operações. O período de referência muda somente os dados avaliados.</p>
            <small>{goal?.atualizado_em ? `Última alteração: ${dateTimeLabel(goal.atualizado_em)}${goal.atualizado_por ? ` · ${goal.atualizado_por}` : ""}` : "Meta inicial do Painel Gerencial"}</small>
          </div>
          <div className={cx(styles, commonStyles, "goal-editor")}>
            {goalLoading ? <p>Carregando configuração da meta…</p> : goalError ? <p>Não foi possível carregar as permissões e a configuração da meta.</p> : goal?.pode_editar ? <form onSubmit={saveGoal}>
              <label htmlFor="dashboard-goal-value">Meta (%)</label>
              <input id="dashboard-goal-value" name="valor_percentual" type="number" min="0" max="100" step="0.01" value={goalValue} onChange={(event) => { setGoalValue(event.target.value); setGoalSavedMessage(""); }} />
              <label htmlFor="dashboard-goal-periodicity">Periodicidade</label>
              <select id="dashboard-goal-periodicity" value={goalPeriodicity} onChange={(event) => setGoalPeriodicity(event.target.value as DashboardGoal["periodicidade"])}><option value="MENSAL">Mensal</option><option value="TRIMESTRAL">Trimestral</option><option value="ANUAL">Anual</option></select>
              <label htmlFor="dashboard-goal-scope">Operações consideradas</label>
              <select id="dashboard-goal-scope" value={goalScope} onChange={(event) => setGoalScope(event.target.value as DashboardGoal["escopo_operacao"])}><option value="TODAS">Entregas e coletas</option><option value="ENTREGAS">Somente entregas</option><option value="COLETAS">Somente coletas</option></select>
              <small>A mesma meta percentual vale para cada período da periodicidade escolhida. A edição é registrada na auditoria.</small>
              <button className={cx(styles, commonStyles, "button button-primary")} type="submit" disabled={goalSaving || goalLoading}>{goalSaving ? "Salvando…" : "Salvar configuração"}</button>
            </form> : <p>Somente perfis globais de Diretoria ou DEV podem alterar a meta e as operações acompanhadas.</p>}
          </div>
        </div>
      </section>}

      <DashboardDetailDialog
        selection={detailSelection}
        dashboard={data}
        localityDashboard={localityDetailDashboard}
        localityLoading={localityDetailLoading}
        localityError={localityDetailError}
        onClose={() => setDetailSelection(null)}
      />
    </div>
  );
}
