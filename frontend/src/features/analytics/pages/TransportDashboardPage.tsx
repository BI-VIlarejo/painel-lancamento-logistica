import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import styles from "./TransportDashboardPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { messageFromApiError } from "../../../shared/api/apiError";
import { analyticsApi } from "../api";
import type { TransportDashboardResponse } from "../types";
import { firstDayOfCurrentMonth, formatDate, formatMoney, formatNumber, localDateValue } from "../../freights/format";
import { TransportDashboardDetailDialog } from "./TransportDashboardDetailDialog";
import type { TransportDetailSelection } from "./TransportDashboardDetailDialog";

type Props = { onNavigate: (path: string) => void; canViewPayments: boolean };

const countFormat = new Intl.NumberFormat("pt-BR");
const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function MetricPanel({ title, description, badge, children, className = "" }: {
  title: string;
  description: string;
  badge?: string;
  children: ReactNode;
  className?: string;
}) {
  return <section className={cx(styles, "transport-dashboard-panel", className)}>
    <header className={cx(styles, "transport-dashboard-panel-heading")}>
      <div><h2>{title}</h2><p>{description}</p></div>
      {badge && <span>{badge}</span>}
    </header>
    {children}
  </section>;
}

function DetailRow({ label, value, note, barWidth, barSecondaryWidth = 0, tone = "green", onClick, ariaLabel }: {
  label: string;
  value: string;
  note: string;
  barWidth: number;
  barSecondaryWidth?: number;
  tone?: "green" | "blue" | "orange";
  onClick: () => void;
  ariaLabel: string;
}) {
  return <button className={cx(styles, "transport-dashboard-row")} type="button" onClick={onClick} aria-label={ariaLabel}>
    <span className={cx(styles, "transport-dashboard-row-heading")}><strong>{label}</strong><b>{value}</b></span>
    <span className={cx(styles, "transport-dashboard-track")} aria-hidden="true"><i className={cx(styles, `transport-dashboard-track-${tone}`)} style={{ width: `${Math.max(0, Math.min(100, barWidth))}%` }} /><i className={cx(styles, "transport-dashboard-track-orange")} style={{ width: `${Math.max(0, Math.min(100, barSecondaryWidth))}%` }} /></span>
    <small>{note}</small>
  </button>;
}

function LoadingOrEmpty({ loading, hasData, text }: { loading: boolean; hasData: boolean; text: string }) {
  if (loading) return <p className={cx(styles, "transport-dashboard-empty")} role="status">Atualizando indicadores…</p>;
  if (!hasData) return <p className={cx(styles, "transport-dashboard-empty")}>{text}</p>;
  return null;
}

/** Indicadores gerenciais do transporte agregados no servidor e com detalhamento sob demanda. */
export function TransportDashboardPage({ onNavigate, canViewPayments }: Props) {
  const [fromDate, setFromDate] = useState(firstDayOfCurrentMonth());
  const [toDate, setToDate] = useState(localDateValue());
  const [dashboard, setDashboard] = useState<TransportDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [detailSelection, setDetailSelection] = useState<TransportDetailSelection | null>(null);

  useEffect(() => {
    if (!fromDate || !toDate || fromDate > toDate) {
      setDashboard(null);
      setError(fromDate && toDate ? "A data inicial deve ser anterior à data final." : "Informe as duas datas do período.");
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    setDashboard(null);

    void analyticsApi.transport({ data_de: fromDate, data_ate: toDate }, controller.signal)
      .then((response) => {
        if (!active || controller.signal.aborted) return;
        setDashboard(response);
      })
      .catch((loadError: unknown) => {
        if (!active || controller.signal.aborted) return;
        setError(messageFromApiError(loadError));
      })
      .finally(() => {
        if (active && !controller.signal.aborted) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [fromDate, toDate, reloadVersion]);

  const contextLabel = `${formatDate(fromDate)} a ${formatDate(toDate)}`;
  const openCarrierDetail = (key: string, label: string, title: string, description: string) => setDetailSelection({
    title: `${title} · ${label}`,
    description,
    slice: { kind: "carrier", key },
  });

  const paymentGroups = dashboard?.pagamentos ?? [];
  const maxPayment = useMemo(
    () => Math.max(1, ...paymentGroups.map((entry) => entry.total)),
    [paymentGroups],
  );

  const rateGroups = dashboard?.percentuais_frete ?? [];
  const maxRate = useMemo(
    () => Math.max(1, ...rateGroups.map((entry) => entry.percentual)),
    [rateGroups],
  );

  const deliveryGroups = dashboard?.entregas_transportadora ?? [];

  const kmGroups = dashboard?.km_rodado ?? [];
  const maxKm = useMemo(
    () => Math.max(1, ...kmGroups.map((entry) => entry.total_km)),
    [kmGroups],
  );

  const cityGroups = dashboard?.entregas_cidade ?? [];
  const maxCityDeliveries = useMemo(
    () => Math.max(1, ...cityGroups.map((entry) => entry.planned)),
    [cityGroups],
  );

  const accuracyGroups = useMemo(
    () => deliveryGroups
      .filter((entry) => entry.accuracy !== null)
      .sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101) || a.label.localeCompare(b.label, "pt-BR")),
    [deliveryGroups],
  );

  return <div className={cx(styles, commonStyles, "portal-page page-stack transport-dashboard-page")}>
    <header className={cx(styles, commonStyles, "page-heading-row transport-dashboard-heading")}>
      <div><p className={cx(styles, commonStyles, "eyebrow")}>INDICADORES · TRANSPORTE</p><h1>Painel Gerencial de Transportes</h1><p className={cx(styles, commonStyles, "page-lead")}>Pagamento, custo do frete, volume, ocorrências, quilômetros e acerto por transportador.</p></div>
      <div className={cx(styles, commonStyles, "transport-dashboard-actions")}>
        <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/historico")}>Histórico de fretes</button>
        {canViewPayments && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/pagamentos")}>Pagamentos</button>}
      </div>
    </header>

    <section className={cx(styles, commonStyles, "transport-dashboard-filters")} aria-label="Filtros do painel de transportes">
      <div className={cx(styles, "transport-dashboard-filter-intro")}><strong>Período de serviço</strong><small>Fretes e lançamentos enviados</small></div>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Data inicial</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label className={cx(styles, commonStyles, "filter-control")}><span>Data final</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
      <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { setFromDate(firstDayOfCurrentMonth()); setToDate(localDateValue()); }}>Mês atual</button>
      <span className={cx(styles, "transport-dashboard-filter-summary")} role="status">{loading ? "Atualizando dados…" : `${countFormat.format(dashboard?.total_fretes ?? 0)} fretes · ${countFormat.format(dashboard?.total_registros_entrega ?? 0)} registros de entrega`}</span>
    </section>

    {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>{error}</span>{fromDate && toDate && fromDate <= toDate && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReloadVersion((version) => version + 1)}>Tentar novamente</button>}</div>}

    <div className={cx(styles, "transport-dashboard-grid")}>
      <MetricPanel title="Pagamento por transportador" description="Valor líquido elegível para pagamento, conforme as regras do relatório financeiro." badge={loading ? "—" : `${paymentGroups.length} transportadores`}>
        <LoadingOrEmpty loading={loading} hasData={paymentGroups.length > 0} text="Sem pagamentos registrados neste período." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{paymentGroups.map((entry) => <DetailRow
          key={entry.key} label={entry.label} value={entry.known_count ? formatMoney(entry.total) : "—"}
          note={`${countFormat.format(entry.fretes_count)} fretes · cálculo disponível em ${countFormat.format(entry.known_count)}`}
          barWidth={entry.known_count ? (entry.total / maxPayment) * 100 : 0} tone="green" onClick={() => openCarrierDetail(entry.key, entry.label, "Pagamento por transportador", "Soma dos valores elegíveis para pagamento, com pendências de conferência excluídas conforme o relatório financeiro.")}
          ariaLabel={`${entry.label}: ${entry.known_count ? formatMoney(entry.total) : "valor não informado"}, ${entry.fretes_count} fretes. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>

      <MetricPanel title="Percentual de frete por transportadora" description="Frete bruto ÷ valor das notas, ponderado pelos valores registrados." badge="% sobre notas">
        <LoadingOrEmpty loading={loading} hasData={rateGroups.length > 0} text="Não há fretes com valor bruto e nota informados para calcular o percentual." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{rateGroups.map((entry) => <DetailRow
          key={entry.key} label={entry.label} value={`${percentFormat.format(entry.percentual)}%`}
          note={`${countFormat.format(entry.known_count)} fretes com bruto e nota informados`}
          barWidth={(entry.percentual / maxRate) * 100} tone="blue" onClick={() => openCarrierDetail(entry.key, entry.label, "Percentual de frete", "O percentual é o total de frete bruto dividido pelo total das notas dos fretes com ambos os valores informados.")}
          ariaLabel={`${entry.label}: percentual de frete ${percentFormat.format(entry.percentual)} por cento. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>

      <MetricPanel title="Entregas e ocorrências por transportadora" description="Volumes informados nos lançamentos enviados e motivos das não realizadas." badge={loading ? "—" : `${deliveryGroups.length} transportadores`}>
        <LoadingOrEmpty loading={loading} hasData={deliveryGroups.length > 0} text="Não há entregas enviadas neste período." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{deliveryGroups.map((entry) => <DetailRow
          key={entry.key} label={entry.label} value={`${countFormat.format(entry.planned)} entregas`}
          note={`${countFormat.format(entry.realized)} realizadas · ${countFormat.format(entry.not_realized)} não realizadas · ${countFormat.format(entry.occurrences)} ocorrências com motivo`}
          barWidth={entry.planned ? (entry.realized / entry.planned) * 100 : 0} barSecondaryWidth={entry.planned ? (entry.not_realized / entry.planned) * 100 : 0} tone="green" onClick={() => openCarrierDetail(entry.key, entry.label, "Entregas e ocorrências", "Volumes e motivos de entrega registrados para este transportador no período.")}
          ariaLabel={`${entry.label}: ${entry.planned} entregas, ${entry.realized} realizadas, ${entry.not_realized} não realizadas e ${entry.occurrences} ocorrências com motivo. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>

      <MetricPanel title="KM rodado por transportador" description="Hodômetro do frete ou quilometragem original preservada na planilha importada." badge={loading ? "—" : `${kmGroups.length} com KM informado`}>
        <LoadingOrEmpty loading={loading} hasData={kmGroups.length > 0} text="Não há quilometragem informada nos fretes deste período." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{kmGroups.map((entry) => <DetailRow
          key={entry.key} label={entry.label} value={`${formatNumber(entry.total_km)} km`}
          note={`${countFormat.format(entry.known_count)} fretes com hodômetro informado`}
          barWidth={(entry.total_km / maxKm) * 100} tone="blue" onClick={() => openCarrierDetail(entry.key, entry.label, "KM rodado", "Soma do campo de KM rodado informado nos fretes deste transportador.")}
          ariaLabel={`${entry.label}: ${formatNumber(entry.total_km)} quilômetros em ${entry.known_count} fretes. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>

      <MetricPanel title="Entregas por cidade / região" description="Volumes enviados, realizadas, não realizadas e ocorrências por cidade e UF." badge={loading ? "—" : `${cityGroups.length} cidades / regiões`}>
        <LoadingOrEmpty loading={loading} hasData={cityGroups.length > 0} text="Não há lançamentos enviados com cidade informada neste período." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{cityGroups.map((group) => <DetailRow
          key={group.city} label={group.city} value={`${countFormat.format(group.planned)} entregas`}
          note={`${countFormat.format(group.realized)} realizadas · ${countFormat.format(group.not_realized)} não realizadas · ${countFormat.format(group.occurrences)} ocorrências com motivo`}
          barWidth={maxCityDeliveries ? (group.realized / maxCityDeliveries) * 100 : 0} barSecondaryWidth={maxCityDeliveries ? (group.not_realized / maxCityDeliveries) * 100 : 0} tone="green" onClick={() => setDetailSelection({
            title: `Entregas por cidade / região · ${group.city}`,
            description: "Lançamentos enviados agrupados pela cidade e UF da localidade, com entregas realizadas, não realizadas e motivos.",
            slice: { kind: "city", city: group.city },
          })}
          ariaLabel={`${group.city}: ${group.planned} entregas, ${group.realized} realizadas, ${group.not_realized} não realizadas e ${group.occurrences} ocorrências com motivo. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>

      <MetricPanel title="Taxa de acerto por transportadora" description="Entregas realizadas ÷ total de entregas realizadas e não realizadas." badge="Lançamentos enviados">
        <LoadingOrEmpty loading={loading} hasData={accuracyGroups.length > 0} text="Não há entregas planejadas suficientes para calcular a taxa de acerto." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{accuracyGroups.map((entry) => <DetailRow
          key={entry.key} label={entry.label} value={`${percentFormat.format(entry.accuracy ?? 0)}%`}
          note={`${countFormat.format(entry.realized)} realizadas de ${countFormat.format(entry.planned)} · ${countFormat.format(entry.not_realized)} não realizadas`}
          barWidth={entry.accuracy ?? 0} tone={(entry.accuracy ?? 0) < 90 ? "orange" : "green"} onClick={() => openCarrierDetail(entry.key, entry.label, "Taxa de acerto", "Taxa calculada como entregas realizadas divididas pelo total de entregas planejadas registradas.")}
          ariaLabel={`${entry.label}: taxa de acerto ${percentFormat.format(entry.accuracy ?? 0)} por cento, ${entry.realized} realizadas de ${entry.planned}. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>
    </div>

    <aside className={cx(styles, "transport-dashboard-methodology")}>
      <strong>Como interpretar os indicadores</strong>
      <p>Pagamento segue a regra do relatório financeiro: líquido informado ou bruto menos avaria, excluindo fretes pendentes. Percentual compara frete bruto e valores das notas; KM vem do hodômetro ou, em históricos importados, da planilha preservada. Entregas, ocorrências e taxa de acerto usam lançamentos enviados e associam o motorista principal à transportadora registrada no lançamento. Cidade / região usa a cidade e UF da localidade de entrega. Clique em qualquer linha para abrir os registros que formam o indicador.</p>
    </aside>

    <TransportDashboardDetailDialog selection={detailSelection} fromDate={fromDate} toDate={toDate} contextLabel={contextLabel} onClose={() => setDetailSelection(null)} onNavigate={onNavigate} />
  </div>;
}
