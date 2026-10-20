import { useEffect, useMemo, useState } from "react";
import styles from "./ManagementDashboardPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { analyticsApi } from "../api";
import type { DashboardResponse, DashboardTrendPoint } from "../types";
import { catalogsApi } from "../../catalogs/api";
import type { LocalityCatalogItem } from "../../deliveries/types";
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
      data: `${month}-01`, planejadas: 0, realizadas: 0, nao_realizadas: 0, taxa_realizacao: null,
    };
    current.planejadas += point.planejadas;
    current.realizadas += point.realizadas;
    current.nao_realizadas += point.nao_realizadas;
    const total = current.realizadas + current.nao_realizadas;
    current.taxa_realizacao = total ? (current.realizadas / total) * 100 : null;
    grouped.set(month, current);
  });
  return [...grouped.values()];
}

function TrendChart({ points, monthly }: { points: DashboardTrendPoint[]; monthly: boolean }) {
  const values = aggregateTrend(points, monthly).filter((point) => point.taxa_realizacao !== null);
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
  const line = values.map((point, index) => `${x(index)},${y(point.taxa_realizacao)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(values.length / 6));

  return (
    <div className={cx(styles, commonStyles, "trend-chart-wrap")}>
      <svg className={cx(styles, commonStyles, "trend-chart")} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolução percentual da taxa de realização no período">
        <title>Evolução da taxa de realização</title>
        <desc>Percentual de entregas realizadas sobre o total registrado em cada dia ou mês selecionado.</desc>
        {[0, 50, 100].map((tick) => {
          const tickY = y(tick);
          return <g key={tick}><line x1={left} x2={width - right} y1={tickY} y2={tickY} className={cx(styles, commonStyles, "chart-grid-line")} /><text x={left - 9} y={tickY + 4} textAnchor="end" className={cx(styles, commonStyles, "chart-axis-label")}>{tick}%</text></g>;
        })}
        <polyline points={line} className={cx(styles, commonStyles, "trend-line")} />
        {values.map((point, index) => <circle key={point.data} cx={x(index)} cy={y(point.taxa_realizacao)} r="4" className={cx(styles, commonStyles, "trend-point")} />)}
        {values.map((point, index) => (index % labelEvery === 0 || index === values.length - 1)
          ? <text key={`${point.data}-label`} x={x(index)} y={height - 13} textAnchor="middle" className={cx(styles, commonStyles, "chart-axis-label")}>{shortDate(point.data, monthly)}</text>
          : null)}
      </svg>
      <div className={cx(styles, commonStyles, "chart-caption")}>A taxa é calculada como realizadas ÷ total registrado. O cálculo não confirma prazo nem entrega completa, então ainda não representa o OTIF oficial.</div>
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
        <span><i className={cx(styles, commonStyles, "legend-completed")} />Realizadas <strong>{countFormat.format(completed)}</strong></span>
        <span><i className={cx(styles, commonStyles, "legend-not-completed")} />Não realizadas <strong>{countFormat.format(notCompleted)}</strong></span>
      </div>
    </div>
  );
}

function PerformanceRate({ value }: { value: number | null }) {
  if (value === null) return <span className={cx(styles, commonStyles, "rate-empty")}>—</span>;
  const width = Math.min(100, Math.max(0, value));
  return (
    <div className={cx(styles, commonStyles, "rate-cell")} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={`Taxa de realização de ${rateLabel(value)}`}>
      <span className={cx(styles, commonStyles, "rate-meter-track")}><i style={{ width: `${width}%` }} /></span>
      <strong className={cx(styles, commonStyles, "rate-value")}>{rateLabel(value)}</strong>
    </div>
  );
}

export function ManagementDashboardPage() {
  const [fromDate, setFromDate] = useState(firstDayOfCurrentMonth);
  const [toDate, setToDate] = useState(() => localDate(new Date()));
  const [localityId, setLocalityId] = useState("");
  const [localities, setLocalities] = useState<LocalityCatalogItem[]>([]);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [catalogReloadVersion, setCatalogReloadVersion] = useState(0);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [showAllTeams, setShowAllTeams] = useState(false);

  useEffect(() => {
    let active = true;
    void catalogsApi.localities()
      .then((page) => { if (active) { setLocalities(page.items); setCatalogError(""); } })
      .catch((loadError: unknown) => { if (active) setCatalogError(messageFromApiError(loadError)); });
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
    })
      .then((result) => { if (active) setData(result); })
      .catch((loadError: unknown) => { if (active) setError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fromDate, toDate, localityId, reloadVersion]);

  const monthlyTrend = useMemo(() => {
    if (!fromDate || !toDate) return true;
    const start = new Date(`${fromDate}T00:00:00`);
    const end = new Date(`${toDate}T00:00:00`);
    return (end.getTime() - start.getTime()) / 86_400_000 > 93;
  }, [fromDate, toDate]);

  const summary = data?.resumo;
  const feedback = data?.feedback;
  const feedbackAvailable = feedback?.disponivel ?? false;
  const shownPeople = showAllPeople ? data?.por_pessoa ?? [] : (data?.por_pessoa ?? []).slice(0, 8);
  const shownTeams = showAllTeams ? data?.por_equipe ?? [] : (data?.por_equipe ?? []).slice(0, 8);
  const reasonMax = Math.max(1, ...(data?.por_motivo.map((reason) => reason.quantidade) ?? []));

  function resetFilters() {
    setFromDate(firstDayOfCurrentMonth());
    setToDate(localDate(new Date()));
    setLocalityId("");
  }

  return (
    <div className={cx(styles, commonStyles, "page-stack", "manager-dashboard-page")}>
      <div className={cx(styles, commonStyles, "page-heading-row", "manager-heading")}>
        <div>
          <h1>Painel gerencial</h1>
          <p className={cx(styles, commonStyles, "page-lead")}>Performance dos lançamentos confirmados, com um único recorte aplicado a todos os indicadores.</p>
        </div>
        <div className={cx(styles, commonStyles, "manager-heading-status")}>
          <span className={cx(styles, commonStyles, "registered-status-dot")} />{loading ? "Atualizando" : `${countFormat.format(summary?.lancamentos_registrados ?? 0)} lançamentos registrados`}
        </div>
      </div>

      <section className={cx(styles, commonStyles, "manager-filter-card")} aria-label="Filtros do painel">
        <label className={cx(styles, commonStyles, "filter-control")}><span>Data inicial</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}><span>Data final</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}><span>Loja / localidade</span><select value={localityId} onChange={(event) => setLocalityId(event.target.value)}><option value="">Todas as localidades permitidas</option>{localities.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}</select></label>
        <button className={cx(styles, commonStyles, "button button-secondary", "manager-reset-button")} type="button" onClick={resetFilters}>Limpar filtros</button>
        <span className={cx(styles, commonStyles, "manager-filter-note")}>O painel considera lançamentos confirmados e localidades do seu escopo.</span>
      </section>

      <details className={cx(styles, commonStyles, "methodology-details")}>
        <summary><span>Como os indicadores são calculados</span><span className={cx(styles, commonStyles, "methodology-toggle-label")}>Ver critérios</span><span className={cx(styles, commonStyles, "methodology-toggle-label-open")}>Ocultar critérios</span></summary>
        <div className={cx(styles, commonStyles, "methodology-content")}>
          <p><strong>Base:</strong> versão confirmada mais recente de cada lançamento no período e escopo selecionados.</p>
          <p><strong>Planejadas:</strong> soma das quantidades realizadas e não realizadas informadas no lançamento.</p>
          <p><strong>Taxa de realização:</strong> entregas realizadas ÷ total registrado. Sem prazo prometido e confirmação de pedido completo, não representa OTIF.</p>
          <p><strong>Por pessoa:</strong> mostra o resultado das equipes em que participou; o volume da equipe é atribuído integralmente a cada integrante.</p>
          {!feedbackAvailable && <p><strong>Feedback:</strong> elogios e reclamações aparecem quando as tabelas opcionais de feedback estiverem disponíveis no banco.</p>}
        </div>
      </details>

      {(error || catalogError) && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>Não foi possível carregar todos os dados{error ? `: ${error}` : `: ${catalogError}`}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { if (error) setReloadVersion((version) => version + 1); if (catalogError) setCatalogReloadVersion((version) => version + 1); }}>Tentar novamente</button></div>}

      <section className={cx(styles, commonStyles, "manager-metrics")} aria-label="Resumo do período" aria-busy={loading}>
        <article className={cx(styles, commonStyles, "manager-metric")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Entregas planejadas</span><strong>{loading ? "—" : countFormat.format(summary?.itens_planejados ?? 0)}</strong><small>realizadas + não realizadas</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "metric-completed")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Realizadas</span><strong>{loading ? "—" : countFormat.format(summary?.entregas_realizadas ?? 0)}</strong><small>resultado registrado</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "metric-not-completed")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Não realizadas</span><strong>{loading ? "—" : countFormat.format(summary?.entregas_nao_realizadas ?? 0)}</strong><small>resultado registrado</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "manager-metric-highlight")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Taxa de realização</span><strong>{loading ? "—" : rateLabel(summary?.taxa_realizacao ?? null)}</strong><small>realizadas ÷ planejadas</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "metric-praise")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Elogios</span><strong>{loading || !feedbackAvailable ? "—" : countFormat.format(feedback?.elogios ?? 0)}</strong><small>{feedbackAvailable ? "associados a lançamentos registrados" : "módulo de feedback indisponível"}</small></article>
        <article className={cx(styles, commonStyles, "manager-metric", "metric-complaint")}><span className={cx(styles, commonStyles, "manager-metric-label")}>Reclamações</span><strong>{loading || !feedbackAvailable ? "—" : countFormat.format(feedback?.reclamacoes ?? 0)}</strong><small>{feedbackAvailable ? "associadas a lançamentos registrados" : "módulo de feedback indisponível"}</small></article>
      </section>

      <section className={cx(styles, commonStyles, "otif-definition-note")} aria-label="Nota sobre o cálculo de OTIF">
        <span className={cx(styles, commonStyles, "otif-note-icon")} aria-hidden="true">i</span>
        <div><strong>OTIF oficial ainda não calculável</strong><p>O sistema não registra prazo prometido nem confirmação de entrega integral por pedido. Os gráficos mostram a taxa de realização disponível, sem apresentá-la como OTIF.</p></div>
      </section>

      <div className={cx(styles, commonStyles, "manager-overview-grid")}>
        <section className={cx(styles, commonStyles, "manager-panel", "trend-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Evolução da taxa de realização</h2><p>Dia a dia{monthlyTrend ? " agrupada por mês" : ""} no período filtrado</p></div><span>{loading ? "—" : `${data?.evolucao.length ?? 0} períodos com movimento`}</span></div>
          {loading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando evolução...</div> : <TrendChart points={data?.evolucao ?? []} monthly={monthlyTrend} />}
        </section>
        <section className={cx(styles, commonStyles, "manager-panel", "composition-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Proporção das entregas</h2><p>Realizadas e não realizadas</p></div></div>
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando composição...</div> : summary?.itens_planejados ? <DeliveryComposition completed={summary.entregas_realizadas} notCompleted={summary.entregas_nao_realizadas} /> : <div className={cx(styles, commonStyles, "manager-empty")}>Sem lançamentos registrados neste período.</div>}
          <div className={cx(styles, commonStyles, "composition-rate")}><span>Taxa de realização no recorte</span><strong>{loading ? "—" : rateLabel(summary?.taxa_realizacao ?? null)}</strong></div>
        </section>
      </div>

      <section className={cx(styles, commonStyles, "manager-panel")}>
        <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Performance por loja</h2><p>Volume, resultado e relacionamento com clientes no mesmo período</p></div><span>{loading ? "—" : `${data?.por_localidade.length ?? 0} lojas`}</span></div>
        {loading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando lojas...</div> : !data?.por_localidade.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Não há lançamentos registrados para os filtros selecionados.</div> : <div className={cx(styles, commonStyles, "manager-table-wrap")}><table className={cx(styles, commonStyles, "manager-table")}><thead><tr><th>Loja</th><th>Lançamentos</th><th>Planejadas</th><th>Realizadas</th><th>Não realizadas</th><th>Taxa</th><th>Elogios</th><th>Reclamações</th></tr></thead><tbody>{data.por_localidade.map((item) => <tr key={item.id_localidade}><th scope="row">{item.nome}</th><td>{countFormat.format(item.lancamentos)}</td><td>{countFormat.format(item.itens_planejados)}</td><td className={cx(styles, commonStyles, "number-positive")}>{countFormat.format(item.realizadas)}</td><td className={cx(styles, commonStyles, "number-attention")}>{countFormat.format(item.nao_realizadas)}</td><td><PerformanceRate value={item.taxa_realizacao} /></td><td>{item.elogios === null ? "—" : countFormat.format(item.elogios)}</td><td>{item.reclamacoes === null ? "—" : countFormat.format(item.reclamacoes)}</td></tr>)}</tbody></table></div>}
      </section>

      <section className={cx(styles, commonStyles, "manager-panel")}>
        <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Entregas não realizadas por motivo</h2><p>Quantidade de ocorrências no período</p></div><span>{loading ? "—" : `${data?.por_motivo.length ?? 0} motivos`}</span></div>
        {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando motivos...</div> : !data?.por_motivo.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Nenhuma ocorrência de não realização.</div> : <div className={cx(styles, commonStyles, "reason-list")}>{data.por_motivo.map((reason) => <div className={cx(styles, commonStyles, "reason-row")} key={reason.id_motivo}><div><span>{reason.motivo}</span><strong>{countFormat.format(reason.quantidade)}</strong></div><span className={cx(styles, commonStyles, "reason-track")}><i style={{ width: `${(reason.quantidade / reasonMax) * 100}%` }} /></span></div>)}</div>}
      </section>

      <div className={cx(styles, commonStyles, "manager-analysis-grid")}>
        <section className={cx(styles, commonStyles, "manager-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Taxa de realização por equipe</h2><p>Resultado coletivo das equipes no recorte</p></div><span>{loading ? "—" : `${data?.por_equipe.length ?? 0} equipes`}</span></div>
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando equipes...</div> : !data?.por_equipe.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Não há equipes com lançamentos registrados.</div> : <><div className={cx(styles, commonStyles, "manager-table-wrap")}><table className={cx(styles, commonStyles, "manager-table", "manager-compact-table")}><thead><tr><th>Equipe</th><th>Planejadas</th><th>Realizadas</th><th>Não realizadas</th><th>Taxa</th></tr></thead><tbody>{shownTeams.map((team) => <tr key={team.chave}><th scope="row">{team.equipe}</th><td>{countFormat.format(team.itens_planejados)}</td><td className={cx(styles, commonStyles, "number-positive")}>{countFormat.format(team.realizadas)}</td><td className={cx(styles, commonStyles, "number-attention")}>{countFormat.format(team.nao_realizadas)}</td><td><PerformanceRate value={team.taxa_realizacao} /></td></tr>)}</tbody></table></div>{data.por_equipe.length > 8 && <button className={cx(styles, commonStyles, "table-more-button")} type="button" onClick={() => setShowAllTeams((value) => !value)}>{showAllTeams ? "Mostrar menos" : `Ver todas as ${data.por_equipe.length} equipes`}</button>}</>}
        </section>

        <section className={cx(styles, commonStyles, "manager-panel")}>
          <div className={cx(styles, commonStyles, "manager-panel-heading")}><div><h2>Taxa de realização por pessoa</h2><p>Volume atribuído às equipes em que participou</p></div><span>{loading ? "—" : `${data?.por_pessoa.length ?? 0} pessoas`}</span></div>
          {loading ? <div className={cx(styles, commonStyles, "manager-empty")}>Carregando pessoas...</div> : !data?.por_pessoa.length ? <div className={cx(styles, commonStyles, "manager-empty")}>Não há pessoas com lançamentos registrados.</div> : <><div className={cx(styles, commonStyles, "manager-table-wrap")}><table className={cx(styles, commonStyles, "manager-table", "manager-compact-table")}><thead><tr><th>Pessoa</th><th>Equipes</th><th>Planejadas</th><th>Realizadas</th><th>Não realizadas</th><th>Taxa</th><th>Elogios</th><th>Reclamações</th></tr></thead><tbody>{shownPeople.map((person) => <tr key={person.id_pessoa}><th scope="row"><span className={cx(styles, commonStyles, "person-cell-name")}>{person.nome}</span><small>{person.funcao === "MOTORISTA" ? "Motorista" : "Ajudante"}</small></th><td>{countFormat.format(person.equipes)}</td><td>{countFormat.format(person.itens_planejados)}</td><td className={cx(styles, commonStyles, "number-positive")}>{countFormat.format(person.realizadas)}</td><td className={cx(styles, commonStyles, "number-attention")}>{countFormat.format(person.nao_realizadas)}</td><td><PerformanceRate value={person.taxa_realizacao} /></td><td>{person.elogios === null ? "—" : countFormat.format(person.elogios)}</td><td>{person.reclamacoes === null ? "—" : countFormat.format(person.reclamacoes)}</td></tr>)}</tbody></table></div>{data.por_pessoa.length > 8 && <button className={cx(styles, commonStyles, "table-more-button")} type="button" onClick={() => setShowAllPeople((value) => !value)}>{showAllPeople ? "Mostrar menos" : `Ver todas as ${data.por_pessoa.length} pessoas`}</button>}</>}
        </section>
      </div>
    </div>
  );
}
