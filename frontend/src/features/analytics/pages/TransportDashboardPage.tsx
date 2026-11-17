import { useEffect, useMemo, useState } from "react";
import styles from "./TransportDashboardPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { messageFromApiError } from "../../../shared/api/apiError";
import { freightsApi } from "../../freights/api";
import { firstDayOfCurrentMonth, formatDate, formatMoney, localDateValue, numericValue } from "../../freights/format";
import type { FreightResponse, FreightRecordedTransportType } from "../../freights/types";

type Props = { onNavigate: (path: string) => void; canViewPayments: boolean };
type ModalidadeFilter = "TODOS" | FreightRecordedTransportType;
type FreightGroup = { key: string; label: string; quantidade: number; bruto: number; avarias: number; liquido: number };
type MonthGroup = { key: string; label: string; quantidade: number; liquido: number };

const money = (value: FreightResponse["valor_frete_pago"]): number => numericValue(value) ?? 0;
const typeLabel = (type: FreightRecordedTransportType) => type === "AGREGADO"
  ? "Agregado"
  : type === "TRANSPORTADORA"
    ? "Transportadora independente"
    : "Frota própria (histórico)";

function groupFreights(items: FreightResponse[]): FreightGroup[] {
  const groups = new Map<string, FreightGroup>();
  for (const item of items) {
    const key = item.nome_transportador?.trim() || "__SEM_IDENTIFICACAO__";
    const group = groups.get(key) ?? {
      key,
      label: key === "__SEM_IDENTIFICACAO__" ? "Sem identificação" : key,
      quantidade: 0,
      bruto: 0,
      avarias: 0,
      liquido: 0,
    };
    group.quantidade += 1;
    group.bruto += money(item.valor_frete_bruto);
    group.avarias += money(item.valor_avaria);
    group.liquido += money(item.valor_frete_pago);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.liquido - a.liquido || b.quantidade - a.quantidade || a.label.localeCompare(b.label, "pt-BR"));
}

function groupMonths(items: FreightResponse[]): MonthGroup[] {
  const groups = new Map<string, MonthGroup>();
  for (const item of items) {
    const key = item.data_servico.slice(0, 7);
    const group = groups.get(key) ?? {
      key,
      label: new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" }).format(new Date(`${key}-15T12:00:00`)),
      quantidade: 0,
      liquido: 0,
    };
    group.quantidade += 1;
    group.liquido += money(item.valor_frete_pago);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
}

async function loadFreights(dataDe: string, dataAte: string, type: ModalidadeFilter): Promise<FreightResponse[]> {
  const filters = {
    data_de: dataDe,
    data_ate: dataAte,
    tipo_transporte: type === "TODOS" ? undefined : type,
    limit: 100,
    offset: 0,
  } as const;
  const firstPage = await freightsApi.list(filters);
  const records = [...firstPage.items];
  let offset = records.length;
  while (offset < firstPage.total) {
    const page = await freightsApi.list({ ...filters, offset });
    if (!page.items.length) break;
    records.push(...page.items);
    offset += page.items.length;
  }
  return records.filter((item) => !item.cancelado);
}

/** Indicadores próprios do setor de Transporte, calculados a partir do histórico de fretes. */
export function TransportDashboardPage({ onNavigate, canViewPayments }: Props) {
  const [fromDate, setFromDate] = useState(firstDayOfCurrentMonth());
  const [toDate, setToDate] = useState(localDateValue());
  const [transportType, setTransportType] = useState<ModalidadeFilter>("TODOS");
  const [items, setItems] = useState<FreightResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    if (!fromDate || !toDate || fromDate > toDate) {
      setItems([]);
      setError(fromDate && toDate ? "A data inicial deve ser anterior à data final." : "Informe as duas datas do período.");
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    setItems([]);
    void loadFreights(fromDate, toDate, transportType)
      .then((records) => { if (active) setItems(records); })
      .catch((loadError: unknown) => { if (active) setError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fromDate, toDate, transportType, reloadVersion]);

  const totals = useMemo(() => items.reduce((result, item) => ({
    bruto: result.bruto + money(item.valor_frete_bruto),
    avarias: result.avarias + money(item.valor_avaria),
    liquido: result.liquido + money(item.valor_frete_pago),
    entregas: result.entregas + (item.quantidade_entregas ?? 0),
    peso: result.peso + (numericValue(item.peso_kg) ?? 0),
    pendentes: result.pendentes + (item.status_calculo === "PENDENTE_CONFERENCIA" ? 1 : 0),
  }), { bruto: 0, avarias: 0, liquido: 0, entregas: 0, peso: 0, pendentes: 0 }), [items]);
  const modalities = useMemo(() => {
    const groups = new Map<string, FreightGroup>();
    for (const item of items) {
      const key = item.tipo_transporte;
      const group = groups.get(key) ?? { key, label: typeLabel(key), quantidade: 0, bruto: 0, avarias: 0, liquido: 0 };
      group.quantidade += 1;
      group.bruto += money(item.valor_frete_bruto);
      group.avarias += money(item.valor_avaria);
      group.liquido += money(item.valor_frete_pago);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.quantidade - a.quantidade);
  }, [items]);
  const responsibleGroups = useMemo(() => groupFreights(items).slice(0, 10), [items]);
  const months = useMemo(() => groupMonths(items), [items]);
  const maxMonthly = Math.max(1, ...months.map((month) => Math.abs(month.liquido)));
  const maxResponsible = Math.max(1, ...responsibleGroups.map((group) => Math.abs(group.liquido)));

  return <div className={cx(styles, commonStyles, "portal-page page-stack transport-dashboard-page")}>
    <header className={cx(styles, commonStyles, "page-heading-row transport-dashboard-heading")}>
      <div><p className={cx(styles, commonStyles, "eyebrow")}>INDICADORES · TRANSPORTE</p><h1>Painel Gerencial de Transportes</h1><p className={cx(styles, commonStyles, "page-lead")}>Acompanhe fretes, valores, avarias e volume de entregas por modalidade e responsável.</p></div>
      <div className={cx(styles, commonStyles, "transport-dashboard-actions")}>
        <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/historico")}>Histórico de fretes</button>
        {canViewPayments && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/pagamentos")}>Pagamentos</button>}
      </div>
    </header>

    <section className={cx(styles, commonStyles, "transport-dashboard-filters")} aria-label="Filtros do painel de transportes">
      <label className={cx(styles, commonStyles, "filter-control")}><span>Data inicial</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Data final</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Modalidade</span><select value={transportType} onChange={(event) => setTransportType(event.target.value as ModalidadeFilter)}><option value="TODOS">Todas</option><option value="AGREGADO">Agregados</option><option value="TRANSPORTADORA">Transportadoras independentes</option><option value="PROPRIO">Frota própria (histórico)</option></select></label>
      <span className={cx(styles, commonStyles, "transport-dashboard-filter-summary")}>{loading ? "Atualizando período…" : `${items.length.toLocaleString("pt-BR")} fretes ativos · ${formatDate(fromDate)} a ${formatDate(toDate)}`}</span>
    </section>

    {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{error}{fromDate && toDate && fromDate <= toDate && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReloadVersion((version) => version + 1)}>Tentar novamente</button>}</div>}

    <section className={cx(styles, "transport-dashboard-metrics")} aria-label="Resumo do transporte">
      <article className={cx(styles, "transport-dashboard-metric")}><span>Fretes ativos</span><strong>{loading ? "—" : items.length.toLocaleString("pt-BR")}</strong><small>Lançamentos não cancelados no período</small></article>
      <article className={cx(styles, "transport-dashboard-metric")}><span>Valor bruto</span><strong>{loading ? "—" : formatMoney(totals.bruto)}</strong><small>Total registrado antes das avarias</small></article>
      <article className={cx(styles, "transport-dashboard-metric")}><span>Avarias</span><strong>{loading ? "—" : formatMoney(totals.avarias)}</strong><small>{totals.pendentes.toLocaleString("pt-BR")} fretes pendentes de conferência</small></article>
      <article className={cx(styles, "transport-dashboard-metric", "transport-dashboard-metric-highlight")}><span>Valor líquido registrado</span><strong>{loading ? "—" : formatMoney(totals.liquido)}</strong><small>Valores registrados no histórico de fretes</small></article>
      <article className={cx(styles, "transport-dashboard-metric")}><span>Entregas informadas</span><strong>{loading ? "—" : totals.entregas.toLocaleString("pt-BR")}</strong><small>Volume declarado nos fretes do período</small></article>
      <article className={cx(styles, "transport-dashboard-metric")}><span>Peso transportado</span><strong>{loading ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(totals.peso)} kg`}</strong><small>Soma dos pesos informados</small></article>
    </section>

    <section className={cx(styles, "transport-dashboard-grid")}>
      <article className={cx(styles, "transport-dashboard-panel")}>
        <div className={cx(styles, "transport-dashboard-panel-heading")}><div><h2>Fretes por modalidade</h2><p>Volume, valor bruto, avarias e valor líquido registrado.</p></div></div>
        {loading ? <p className={cx(styles, "transport-dashboard-empty")}>Carregando indicadores…</p> : modalities.length ? <div className={cx(styles, "transport-modality-list")}>{modalities.map((group) => <div className={cx(styles, "transport-modality-row")} key={group.key}>
          <div><strong>{group.label}</strong><span>{group.quantidade.toLocaleString("pt-BR")} fretes · líquido {formatMoney(group.liquido)}</span></div>
          <div className={cx(styles, "transport-modality-values")}><span>Bruto <b>{formatMoney(group.bruto)}</b></span><span>Avarias <b>{formatMoney(group.avarias)}</b></span></div>
        </div>)}</div> : <p className={cx(styles, "transport-dashboard-empty")}>Nenhum frete encontrado neste período.</p>}
      </article>

      <article className={cx(styles, "transport-dashboard-panel")}>
        <div className={cx(styles, "transport-dashboard-panel-heading")}><div><h2>Valor líquido por mês</h2><p>Últimos 12 meses do período consultado.</p></div></div>
        {loading ? <p className={cx(styles, "transport-dashboard-empty")}>Carregando indicadores…</p> : months.length ? <div className={cx(styles, "transport-month-list")}>{months.map((month) => <div className={cx(styles, "transport-month-row")} key={month.key}>
          <div><span>{month.label}</span><strong>{formatMoney(month.liquido)}</strong></div><span className={cx(styles, "transport-month-track")}><i style={{ width: `${Math.max(month.liquido ? 4 : 0, Math.abs(month.liquido) / maxMonthly * 100)}%` }} /></span><small>{month.quantidade.toLocaleString("pt-BR")} fretes</small>
        </div>)}</div> : <p className={cx(styles, "transport-dashboard-empty")}>Nenhum frete encontrado neste período.</p>}
      </article>

      <article className={cx(styles, "transport-dashboard-panel", "transport-dashboard-responsibles")}>
        <div className={cx(styles, "transport-dashboard-panel-heading")}><div><h2>Maiores valores por responsável</h2><p>Até dez responsáveis, ordenados pelo valor líquido registrado.</p></div></div>
        {loading ? <p className={cx(styles, "transport-dashboard-empty")}>Carregando indicadores…</p> : responsibleGroups.length ? <div className={cx(styles, "transport-responsible-list")}>{responsibleGroups.map((group, index) => <div className={cx(styles, "transport-responsible-row")} key={group.key}>
          <span className={cx(styles, "transport-responsible-rank")}>{String(index + 1).padStart(2, "0")}</span><div><strong>{group.label}</strong><small>{group.quantidade.toLocaleString("pt-BR")} fretes · bruto {formatMoney(group.bruto)} · avarias {formatMoney(group.avarias)}</small></div><b>{formatMoney(group.liquido)}</b><span className={cx(styles, "transport-responsible-track")}><i style={{ width: `${Math.max(group.liquido ? 4 : 0, Math.abs(group.liquido) / maxResponsible * 100)}%` }} /></span>
        </div>)}</div> : <p className={cx(styles, "transport-dashboard-empty")}>Nenhum frete encontrado neste período.</p>}
      </article>
    </section>
  </div>;
}
