import { useEffect, useMemo, useState } from "react";
import styles from "./ManagementDashboardPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { analyticsApi } from "../api";
import type { DashboardLocality, DashboardResponse, DashboardTrendPoint } from "../types";
import { catalogsApi } from "../../catalogs/api";
import type { LocalityCatalogItem } from "../../deliveries/types";
import { deliveryTransportLabel, nonDeliveryReasonGroupLabel } from "../../deliveries/classifications";
import type { DeliveryTransportType, NonDeliveryReasonGroup } from "../../deliveries/classifications";
import { messageFromApiError } from "../../../shared/api/apiError";

const countFormat = new Intl.NumberFormat("pt-BR");
const percentageFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

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

function aggregateTrend(points: DashboardTrendPoint[], monthly: boolean): DashboardTrendPoint[] {
  if (!monthly) return points;
  const grouped = new Map<string, DashboardTrendPoint>();
  points.forEach((point) => {
    const month = point.data.slice(0, 7);
    const current = grouped.get(month) ?? {
      data: `${month}-01`, planejadas: 0, realizadas: 0, nao_realizadas: 0,
      taxa_realizacao: null, otif_percentual: null,
    };
    current.planejadas += point.planejadas;
    current.realizadas += point.realizadas;
    current.nao_realizadas += point.nao_realizadas;
    const total = current.realizadas + current.nao_realizadas;
    current.taxa_realizacao = total ? (current.realizadas / total) * 100 : null;
    current.otif_percentual = total ? (current.nao_realizadas / total) * 100 : null;
    grouped.set(month, current);
  });
  return [...grouped.values()];
}

function TrendChart({ points, monthly }: { points: DashboardTrendPoint[]; monthly: boolean }) {
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
        <desc>Percentual de entregas não realizadas sobre o total registrado em cada dia ou mês selecionado.</desc>
        {[0, 50, 100].map((tick) => {
          const tickY = y(tick);
          return <g key={tick}><line x1={left} x2={width - right} y1={tickY} y2={tickY} className={cx(styles, commonStyles, "chart-grid-line")} /><text x={left - 9} y={tickY + 4} textAnchor="end" className={cx(styles, commonStyles, "chart-axis-label")}>{tick}%</text></g>;
        })}
        <polyline points={line} className={cx(styles, commonStyles, "trend-line")} />
        {values.map((point, index) => <circle key={point.data} cx={x(index)} cy={y(point.otif_percentual)} r="4" className={cx(styles, commonStyles, "trend-point")} />)}
        {values.map((point, index) => (index % labelEvery === 0 || index === values.length - 1)
          ? <text key={`${point.data}-label`} x={x(index)} y={height - 13} textAnchor="middle" className={cx(styles, commonStyles, "chart-axis-label")}>{shortDate(point.data, monthly)}</text>
          : null)}
      </svg>
      <div className={cx(styles, commonStyles, "chart-caption")}>OTIF = não realizadas de entregas e coletas ÷ total das duas operações.</div>
    </div>
  );
}

function DeliveryComposition({ completed, notCompleted }: { completed: number; notCompleted: number }) {
  const total = completed + notCompleted;
  const doneWidth = total ? (completed / total) * 100 : 0;
  const failedWidth = total ? (notCompleted / total) * 100 : 0;
  return (
    <div className={cx(styles, commonStyles, "composition-body")}>
      <div className={cx(styles, commonStyles, "composition-bar")} role="img" aria-label={`${countFormat.format(completed)} realizadas e ${countFormat.format(notCompleted)} não realizadas`}>
        <span className={cx(styles, commonStyles, "composition-completed")} style={{ width: `${doneWidth}%` }} />
        <span className={cx(styles, commonStyles, "composition-not-completed")} style={{ width: `${failedWidth}%` }} />
      </div>
      <div className={cx(styles, commonStyles, "composition-legend")}>
        <span><i className={cx(styles, commonStyles, "legend-completed")} />Realizadas <strong>{countFormat.format(completed)} · {rateLabel(doneWidth)}</strong></span>
        <span><i className={cx(styles, commonStyles, "legend-not-completed")} />Não realizadas <strong>{countFormat.format(notCompleted)} · {rateLabel(failedWidth)}</strong></span>
      </div>
    </div>
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
}: {
  items: HorizontalBarItem[];
  scaleMax: number;
  valueName: string;
  tone?: "warning" | "success";
}) {
  if (!items.length) return null;
  return <div className={cx(styles, commonStyles, "insight-chart")} role="group" aria-label={valueName}>
    <ol className={cx(styles, commonStyles, "insight-chart-list")}>
      {items.map((item) => {
        const width = item.value === null ? 0 : Math.min(100, Math.max(0, (item.value / scaleMax) * 100));
        return <li className={cx(styles, commonStyles, "insight-chart-row")} key={item.key}>
          <div className={cx(styles, commonStyles, "insight-chart-row-label")}><span>{item.label}</span><strong>{item.valueLabel}</strong></div>
          <div className={cx(styles, commonStyles, "insight-chart-track")} role="meter" aria-valuemin={0} aria-valuemax={scaleMax} aria-valuenow={item.value ?? 0} aria-label={`${item.label}: ${item.valueLabel}`}>
            <i className={cx(styles, commonStyles, tone === "success" ? "insight-chart-bar-success" : "insight-chart-bar-warning")} style={{ width: `${width}%` }} />
          </div>
          {item.detail && <small>{item.detail}</small>}
        </li>;
      })}
    </ol>
  </div>;
}

function DeliveryTypeChart({ items }: { items: DashboardResponse["por_tipo_entrega"] }) {
  if (!items.length) return null;
  return <div className={cx(styles, commonStyles, "delivery-type-chart")} role="group" aria-label="Entregas realizadas e não realizadas por tipo de transporte">
    {items.map((item) => {
      const total = item.realizadas + item.nao_realizadas;
      const completedWidth = total ? (item.realizadas / total) * 100 : 0;
      const failedWidth = total ? (item.nao_realizadas / total) * 100 : 0;
      return <div className={cx(styles, commonStyles, "delivery-type-chart-row")} key={item.tipo_transporte_entrega ?? "unclassified"}>
        <div className={cx(styles, commonStyles, "delivery-type-chart-heading")}><strong>{deliveryTypeLabel(item.tipo_transporte_entrega)}</strong><span>{rateLabel(item.taxa_realizacao)} realizadas</span></div>
        <div className={cx(styles, commonStyles, "delivery-type-chart-track")} role="img" aria-label={`${deliveryTypeLabel(item.tipo_transporte_entrega)}: ${countFormat.format(item.realizadas)} realizadas e ${countFormat.format(item.nao_realizadas)} não realizadas`}>
          <i className={cx(styles, commonStyles, "delivery-type-chart-completed")} style={{ width: `${completedWidth}%` }} />
          <i className={cx(styles, commonStyles, "delivery-type-chart-failed")} style={{ width: `${failedWidth}%` }} />
        </div>
        <div className={cx(styles, commonStyles, "delivery-type-chart-legend")}><span><i className={cx(styles, commonStyles, "legend-completed")} />Realizadas {countFormat.format(item.realizadas)}</span><span><i className={cx(styles, commonStyles, "legend-not-completed")} />Não realizadas {countFormat.format(item.nao_realizadas)}</span><small>{countFormat.format(item.registros_entrega)} registros de entrega · {countFormat.format(item.registros_coleta)} de coleta</small><small>Entregas: {countFormat.format(item.entregas_realizadas)} realizadas / {countFormat.format(item.entregas_nao_realizadas)} não realizadas</small><small>Coletas: {countFormat.format(item.coletas_realizadas)} realizadas / {countFormat.format(item.coletas_nao_realizadas)} não realizadas</small><small>OTIF combinado: {rateLabel(item.otif_percentual)}</small></div>
      </div>;
    })}
  </div>;
}

export function ManagementDashboardPage({ onNavigate }: { onNavigate: (path: string) => void }) {
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
      elogios: feedbackAvailable ? 0 : null,
      reclamacoes: feedbackAvailable ? 0 : null,
    });
  }, [data, feedbackAvailable, localities, localityId]);
  function resetFilters() {
    setFromDate(firstDayOfCurrentMonth());
    setToDate(localDate(new Date()));
    setLocalityId("");
    setTransportType("");
  }

  return (
    <div className={cx(styles, commonStyles, "portal-page", "page-stack", "manager-dashboard-page")}>
      <div className={cx(styles, commonStyles, "page-heading-row", "manager-heading")}>
        <div>
          <h1>Painel gerencial</h1>
          <p className={cx(styles, commonStyles, "page-lead")}>Performance dos lançamentos confirmados, com um único recorte aplicado a todos os indicadores.</p>
        </div>
        <div className={cx(styles, commonStyles, "manager-heading-status")}>
          <span className={cx(styles, commonStyles, "registered-status-dot")} />{loading ? "Atualizando" : `${countFormat.format(summary?.lancamentos_registrados ?? 0)} lançamentos registrados`}
        </div>
      </div>

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
          <p><strong>Motivos:</strong> grupos e motivos são apresentados separadamente para entregas e coletas; cada ocorrência usa como denominador o volume da mesma operação.</p>
          <p><strong>Tipo de entrega:</strong> é calculado pela classificação das pessoas da equipe. Equipes antigas sem classificação aparecem separadas; equipes antigas mistas são identificadas como mistas.</p>
          <p><strong>Status:</strong> indica se o cadastro da pessoa está ativo ou inativo; não representa uma faixa de desempenho.</p>
          {!feedbackAvailable && <p><strong>Feedback:</strong> elogios e reclamações aparecem quando as tabelas opcionais de feedback estiverem disponíveis no banco.</p>}
        </div>
      </details>

      {(error || catalogError) && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>Não foi possível carregar todos os dados{error ? `: ${error}` : `: ${catalogError}`}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { if (error) setReloadVersion((version) => version + 1); if (catalogError) setCatalogReloadVersion((version) => version + 1); }}>Tentar novamente</button></div>}

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
        <div><strong>Como o OTIF é calculado</strong><p>(Entregas + coletas) não realizadas ÷ total de entregas e coletas registradas. Os cartões e gráficos também mostram cada operação separadamente.</p></div>
      </section>

      <div className={cx(styles, commonStyles, "manager-overview-grid")}>
        <section className={cx(styles, commonStyles, "manager-panel", "trend-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Evolução do OTIF</h2><p>Dia a dia{monthlyTrend ? " agrupada por mês" : ""} no período filtrado</p></div><span>{loading ? "—" : `${data?.evolucao.length ?? 0} períodos com movimento`}</span></div>
          {loading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando evolução...</div> : <TrendChart points={data?.evolucao ?? []} monthly={monthlyTrend} />}
        </section>
        <section className={cx(styles, commonStyles, "manager-panel", "composition-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Proporção de entregas e coletas</h2><p>Realizadas e não realizadas, somadas para o OTIF</p></div></div>
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando composição...</div> : summary?.itens_planejados ? <DeliveryComposition completed={summary.entregas_realizadas + summary.coletas_realizadas} notCompleted={summary.entregas_nao_realizadas + summary.coletas_nao_realizadas} /> : <div className={cx(styles, commonStyles, "manager-empty")}>Sem lançamentos registrados neste período.</div>}
          <div className={cx(styles, commonStyles, "composition-rate")}><span>Taxa de realização no recorte</span><strong>{loading ? "—" : rateLabel(summary?.taxa_realizacao ?? null)}</strong></div>
        </section>
      </div>

      <section className={cx(styles, commonStyles, "manager-panel")}>
        <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Performance por loja</h2><p>Volume, resultado e relacionamento com clientes no mesmo período</p></div><span>{loading || localitiesLoading ? "Carregando..." : `${localityPerformance.length} localidades`}</span></div>
        {loading || localitiesLoading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando lojas ativas...</div> : !localityPerformance.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Não há localidades ativas disponíveis para os filtros selecionados.</div> : <>
          <p className={cx(styles, commonStyles, "insight-chart-caption")}>Taxa de realização de entregas e coletas por loja; as menores taxas aparecem primeiro. O volume ao lado ajuda a contextualizar a comparação.</p>
          <HorizontalBarChart items={[...localityPerformance].sort((a, b) => (a.taxa_realizacao ?? -1) - (b.taxa_realizacao ?? -1) || b.itens_planejados - a.itens_planejados).map((item) => ({ key: String(item.id_localidade), label: item.nome, value: item.taxa_realizacao, valueLabel: rateLabel(item.taxa_realizacao), detail: `${countFormat.format(item.itens_planejados)} entregas e coletas · ${countFormat.format(item.lancamentos)} lançamentos · ${rateLabel(item.otif_percentual)} OTIF · ${item.elogios === null ? "—" : countFormat.format(item.elogios)} elogios · ${item.reclamacoes === null ? "—" : countFormat.format(item.reclamacoes)} reclamações` }))} scaleMax={100} valueName="Taxa de realização por loja" tone="success" />
        </>}
      </section>

      <div className={cx(styles, commonStyles, "manager-analysis-grid")}>
        <section className={cx(styles, commonStyles, "manager-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Não realizadas por grupo de motivo</h2><p>Percentual das não realizadas e incidência no total</p></div><span>{loading ? "—" : `${data?.por_grupo_motivo.length ?? 0} grupos`}</span></div>
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando grupos...</div> : !data?.por_grupo_motivo.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Nenhuma ocorrência de não realização.</div> : <>
            <HorizontalBarChart items={[...data.por_grupo_motivo].sort((a, b) => b.quantidade - a.quantidade).map((group) => ({ key: `${group.tipo_operacao}:${group.grupo_motivo ?? "unclassified"}`, label: `${operationLabel(group.tipo_operacao)} · ${reasonGroupLabel(group.grupo_motivo)}`, value: group.quantidade, valueLabel: countFormat.format(group.quantidade), detail: `${rateLabel(group.percentual_das_nao_realizadas)} das ${operationLabel(group.tipo_operacao).toLowerCase()}s não realizadas · ${rateLabel(group.incidencia_sobre_total)} do total dessa operação` }))} scaleMax={Math.max(1, ...data.por_grupo_motivo.map((group) => group.quantidade))} valueName="Quantidade de não realizadas por grupo de motivo e operação" />
          </>}
        </section>
        <section className={cx(styles, commonStyles, "manager-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Entregas próprias e terceirizadas</h2><p>Resultado por tipo informado no cadastro da equipe</p></div><span>{loading ? "—" : `${data?.por_tipo_entrega.length ?? 0} tipos`}</span></div>
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando tipos...</div> : !data?.por_tipo_entrega.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Não há entregas no período.</div> : <>
            <DeliveryTypeChart items={data.por_tipo_entrega} />
          </>}
        </section>
      </div>

      <section className={cx(styles, commonStyles, "manager-panel")}>
        <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Não realizadas por motivo</h2><p>Quantidade, grupo associado e participação nas entregas do período</p></div><span>{loading ? "—" : `${data?.por_motivo.length ?? 0} motivos`}</span></div>
        {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando motivos...</div> : !data?.por_motivo.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Nenhuma ocorrência de não realização.</div> : <>
          <HorizontalBarChart items={[...data.por_motivo].sort((a, b) => b.quantidade - a.quantidade || a.motivo.localeCompare(b.motivo, "pt-BR")).map((reason) => ({ key: `${reason.tipo_operacao}:${reason.id_motivo}`, label: `${operationLabel(reason.tipo_operacao)} · ${reason.motivo}`, value: reason.quantidade, valueLabel: countFormat.format(reason.quantidade), detail: `${reasonGroupLabel(reason.grupo_motivo)} · ${rateLabel(reason.percentual_das_nao_realizadas)} das ${operationLabel(reason.tipo_operacao).toLowerCase()}s não realizadas · ${rateLabel(reason.incidencia_sobre_total)} do total dessa operação` }))} scaleMax={Math.max(1, ...data.por_motivo.map((reason) => reason.quantidade))} valueName="Quantidade de não realizadas por motivo e operação" />
        </>}
      </section>

      <div className={cx(styles, commonStyles, "manager-analysis-grid")}>
        <section className={cx(styles, commonStyles, "manager-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Taxa de realização por equipe</h2><p>Resultado coletivo das equipes no recorte</p></div><span>{loading ? "—" : `${data?.por_equipe.length ?? 0} equipes`}</span></div>
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando equipes...</div> : !data?.por_equipe.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Não há equipes com lançamentos registrados.</div> : <>
            <p className={cx(styles, commonStyles, "insight-chart-caption")}>Todas as equipes; as menores taxas aparecem primeiro. Volume e OTIF incluem entregas e coletas.</p>
            <HorizontalBarChart items={[...data.por_equipe].sort((a, b) => (a.taxa_realizacao ?? -1) - (b.taxa_realizacao ?? -1) || b.itens_planejados - a.itens_planejados || a.equipe.localeCompare(b.equipe, "pt-BR")).map((team) => ({ key: team.chave, label: team.equipe, value: team.taxa_realizacao, valueLabel: rateLabel(team.taxa_realizacao), detail: `${countFormat.format(team.realizadas)} realizadas de ${countFormat.format(team.itens_planejados)} entregas e coletas · ${rateLabel(team.otif_percentual)} OTIF` }))} scaleMax={100} valueName="Taxa de realização por equipe" tone="success" />
          </>}
        </section>
        <section className={cx(styles, commonStyles, "manager-panel")}>
        <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Indicadores por pessoa</h2><p>Ranking completo com filtros por período, localidade, transporte, nome, função e situação cadastral.</p></div><button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={() => onNavigate("/indicadores/pessoas")}>Abrir ranking</button></div>
      </section>
      </div>
    </div>
  );
}
