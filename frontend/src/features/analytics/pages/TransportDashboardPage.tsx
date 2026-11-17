import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import styles from "./TransportDashboardPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { messageFromApiError } from "../../../shared/api/apiError";
import { freightsApi } from "../../freights/api";
import { deliveriesApi } from "../../deliveries/api";
import type { DeliveryLaunchSummary } from "../../deliveries/types";
import { firstDayOfCurrentMonth, formatDate, formatMoney, formatNumber, localDateValue, numericValue } from "../../freights/format";
import type { FreightResponse } from "../../freights/types";
import { TransportDashboardDetailDialog } from "./TransportDashboardDetailDialog";
import type { TransportDetailSelection } from "./TransportDashboardDetailDialog";
import { deliveryCarrier, deliveryCityRegionLabel, deliveryOccurrenceCount, freightCarrier, transportKilometers, transportPaymentAmount } from "./transportDashboardUtils";
import type { CarrierDescriptor, TransportDeliveryRecord } from "./transportDashboardUtils";

type Props = { onNavigate: (path: string) => void; canViewPayments: boolean };
type CarrierGroup = CarrierDescriptor & { freights: FreightResponse[]; deliveries: TransportDeliveryRecord[] };
type CityGroup = { city: string; records: TransportDeliveryRecord[]; planned: number; realized: number; notRealized: number; occurrences: number };

const countFormat = new Intl.NumberFormat("pt-BR");
const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function sumKnown(items: FreightResponse[], value: (item: FreightResponse) => string | number | null) {
  let total = 0;
  let known = 0;
  for (const item of items) {
    const parsed = numericValue(value(item));
    if (parsed === null) continue;
    total += parsed;
    known += 1;
  }
  return { total, known };
}

function freightPercent(items: FreightResponse[]) {
  let gross = 0;
  let invoice = 0;
  let known = 0;
  for (const item of items) {
    const grossValue = numericValue(item.valor_frete_bruto);
    const invoiceValue = numericValue(item.valor_nota);
    if (grossValue === null || invoiceValue === null || invoiceValue <= 0) continue;
    gross += grossValue;
    invoice += invoiceValue;
    known += 1;
  }
  return { value: invoice ? (gross / invoice) * 100 : null, known };
}

function deliveryTotals(records: TransportDeliveryRecord[]) {
  const realized = records.reduce((sum, record) => sum + record.item.quantidade_realizada, 0);
  const notRealized = records.reduce((sum, record) => sum + record.item.quantidade_nao_realizada, 0);
  const planned = realized + notRealized;
  const occurrences = records.reduce((sum, record) => sum + deliveryOccurrenceCount(record), 0);
  return { realized, notRealized, planned, occurrences, accuracy: planned ? (realized / planned) * 100 : null };
}

async function loadAllFreights(fromDate: string, toDate: string): Promise<FreightResponse[]> {
  const filters = { data_de: fromDate, data_ate: toDate, limit: 100, offset: 0 } as const;
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

async function loadAllDeliveryLaunches(fromDate: string, toDate: string): Promise<DeliveryLaunchSummary[]> {
  const filters = { estado: "LANÇADO" as const, data_de: fromDate, data_ate: toDate, limit: 100, offset: 0 };
  const firstPage = await deliveriesApi.list(filters);
  const records = [...firstPage.items];
  let offset = records.length;
  while (offset < firstPage.total) {
    const page = await deliveriesApi.list({ ...filters, offset });
    if (!page.items.length) break;
    records.push(...page.items);
    offset += page.items.length;
  }
  return records;
}

function toDeliveryRecords(launches: DeliveryLaunchSummary[], fromDate: string, toDate: string): TransportDeliveryRecord[] {
  return launches.flatMap((launch) => launch.itens
    .filter((item) => item.data_entrega >= fromDate && item.data_entrega <= toDate)
    .filter((item) => item.quantidade_realizada + item.quantidade_nao_realizada > 0)
    .map((item) => {
      const driver = item.participantes.find((person) => person.papel_participante === "MOTORISTA");
      return {
        launchCode: launch.codigo_lancamento,
        item,
        carrier: deliveryCarrier(driver),
        driver: driver?.nome_exibicao ?? null,
      };
    }));
}

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

/** Indicadores gerenciais do transporte, cruzando o histórico de fretes e as entregas enviadas. */
export function TransportDashboardPage({ onNavigate, canViewPayments }: Props) {
  const [fromDate, setFromDate] = useState(firstDayOfCurrentMonth());
  const [toDate, setToDate] = useState(localDateValue());
  const [freights, setFreights] = useState<FreightResponse[]>([]);
  const [deliveryRecords, setDeliveryRecords] = useState<TransportDeliveryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [detailSelection, setDetailSelection] = useState<TransportDetailSelection | null>(null);

  useEffect(() => {
    let active = true;
    if (!fromDate || !toDate || fromDate > toDate) {
      setFreights([]);
      setDeliveryRecords([]);
      setError(fromDate && toDate ? "A data inicial deve ser anterior à data final." : "Informe as duas datas do período.");
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    setFreights([]);
    setDeliveryRecords([]);
    void Promise.all([loadAllFreights(fromDate, toDate), loadAllDeliveryLaunches(fromDate, toDate)])
      .then(([freightRows, launches]) => {
        if (!active) return;
        setFreights(freightRows);
        setDeliveryRecords(toDeliveryRecords(launches, fromDate, toDate));
      })
      .catch((loadError: unknown) => { if (active) setError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fromDate, toDate, reloadVersion]);

  const carrierGroups = useMemo(() => {
    const groups = new Map<string, CarrierGroup>();
    const getGroup = (carrier: CarrierDescriptor) => {
      const group = groups.get(carrier.key) ?? { ...carrier, freights: [], deliveries: [] };
      groups.set(carrier.key, group);
      return group;
    };
    for (const freight of freights) {
      const carrier = freightCarrier(freight);
      getGroup(carrier).freights.push(freight);
    }
    for (const record of deliveryRecords) getGroup(record.carrier).deliveries.push(record);
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [freights, deliveryRecords]);

  const cityGroups = useMemo(() => {
    const groups = new Map<string, CityGroup>();
    for (const record of deliveryRecords) {
      const city = deliveryCityRegionLabel(record.item);
      const group = groups.get(city) ?? { city, records: [], planned: 0, realized: 0, notRealized: 0, occurrences: 0 };
      group.records.push(record);
      group.planned += record.item.quantidade_realizada + record.item.quantidade_nao_realizada;
      group.realized += record.item.quantidade_realizada;
      group.notRealized += record.item.quantidade_nao_realizada;
      group.occurrences += deliveryOccurrenceCount(record);
      groups.set(city, group);
    }
    return [...groups.values()].sort((a, b) => b.planned - a.planned || a.city.localeCompare(b.city, "pt-BR"));
  }, [deliveryRecords]);

  const contextLabel = `${formatDate(fromDate)} a ${formatDate(toDate)}`;
  const openCarrierDetail = (group: CarrierGroup, title: string, description: string) => setDetailSelection({
    title: `${title} · ${group.label}`,
    description,
    slice: { kind: "carrier", key: group.key },
  });

  const paymentGroups = carrierGroups.map((group) => {
    const amounts = group.freights.flatMap((item) => {
      const amount = transportPaymentAmount(item);
      return amount === null ? [] : [amount];
    });
    return { group, total: amounts.reduce((sum, amount) => sum + amount, 0), known: amounts.length };
  })
    .filter((entry) => entry.group.freights.length)
    .sort((a, b) => b.total - a.total || a.group.label.localeCompare(b.group.label, "pt-BR"));
  const maxPayment = Math.max(1, ...paymentGroups.map((entry) => entry.total));

  const rateGroups = carrierGroups.map((group) => ({ group, ...freightPercent(group.freights) }))
    .filter((entry) => entry.value !== null)
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  const maxRate = Math.max(1, ...rateGroups.map((entry) => entry.value ?? 0));

  const deliveryGroups = carrierGroups.map((group) => ({ group, ...deliveryTotals(group.deliveries) }))
    .filter((entry) => entry.group.deliveries.length)
    .sort((a, b) => b.planned - a.planned || a.group.label.localeCompare(b.group.label, "pt-BR"));
  const maxDeliveries = Math.max(1, ...deliveryGroups.map((entry) => entry.planned));

  const kmGroups = carrierGroups.map((group) => ({ group, ...sumKnown(group.freights, transportKilometers) }))
    .filter((entry) => entry.known)
    .sort((a, b) => b.total - a.total || a.group.label.localeCompare(b.group.label, "pt-BR"));
  const maxKm = Math.max(1, ...kmGroups.map((entry) => entry.total));

  const accuracyGroups = deliveryGroups.filter((entry) => entry.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101) || a.group.label.localeCompare(b.group.label, "pt-BR"));

  const maxCityDeliveries = Math.max(1, ...cityGroups.map((entry) => entry.planned));

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
      <span className={cx(styles, "transport-dashboard-filter-summary")} role="status">{loading ? "Atualizando dados…" : `${countFormat.format(freights.length)} fretes · ${countFormat.format(deliveryRecords.length)} registros de entrega`}</span>
    </section>

    {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>{error}</span>{fromDate && toDate && fromDate <= toDate && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReloadVersion((version) => version + 1)}>Tentar novamente</button>}</div>}

    <div className={cx(styles, "transport-dashboard-grid")}>
      <MetricPanel title="Pagamento por transportador" description="Valor líquido elegível para pagamento, conforme as regras do relatório financeiro." badge={loading ? "—" : `${paymentGroups.length} transportadores`}>
        <LoadingOrEmpty loading={loading} hasData={paymentGroups.length > 0} text="Sem pagamentos registrados neste período." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{paymentGroups.map(({ group, total, known }) => <DetailRow
          key={group.key} label={group.label} value={known ? formatMoney(total) : "—"}
          note={`${countFormat.format(group.freights.length)} fretes · cálculo disponível em ${countFormat.format(known)}`}
          barWidth={known ? (total / maxPayment) * 100 : 0} tone="green" onClick={() => openCarrierDetail(group, "Pagamento por transportador", "Soma dos valores elegíveis para pagamento, com pendências de conferência excluídas conforme o relatório financeiro.")}
          ariaLabel={`${group.label}: ${known ? formatMoney(total) : "valor não informado"}, ${group.freights.length} fretes. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>

      <MetricPanel title="Percentual de frete por transportadora" description="Frete bruto ÷ valor das notas, ponderado pelos valores registrados." badge="% sobre notas">
        <LoadingOrEmpty loading={loading} hasData={rateGroups.length > 0} text="Não há fretes com valor bruto e nota informados para calcular o percentual." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{rateGroups.map(({ group, value, known }) => <DetailRow
          key={group.key} label={group.label} value={`${percentFormat.format(value ?? 0)}%`}
          note={`${countFormat.format(known)} fretes com bruto e nota informados`}
          barWidth={((value ?? 0) / maxRate) * 100} tone="blue" onClick={() => openCarrierDetail(group, "Percentual de frete", "O percentual é o total de frete bruto dividido pelo total das notas dos fretes com ambos os valores informados.")}
          ariaLabel={`${group.label}: percentual de frete ${percentFormat.format(value ?? 0)} por cento. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>

      <MetricPanel title="Entregas e ocorrências por transportadora" description="Volumes informados nos lançamentos enviados e motivos das não realizadas." badge={loading ? "—" : `${deliveryGroups.length} transportadores`}>
        <LoadingOrEmpty loading={loading} hasData={deliveryGroups.length > 0} text="Não há entregas enviadas neste período." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{deliveryGroups.map(({ group, planned, realized, notRealized, occurrences }) => <DetailRow
          key={group.key} label={group.label} value={`${countFormat.format(planned)} entregas`}
          note={`${countFormat.format(realized)} realizadas · ${countFormat.format(notRealized)} não realizadas · ${countFormat.format(occurrences)} ocorrências com motivo`}
          barWidth={planned ? (realized / planned) * 100 : 0} barSecondaryWidth={planned ? (notRealized / planned) * 100 : 0} tone="green" onClick={() => openCarrierDetail(group, "Entregas e ocorrências", "Volumes e motivos de entrega registrados para este transportador no período.")}
          ariaLabel={`${group.label}: ${planned} entregas, ${realized} realizadas, ${notRealized} não realizadas e ${occurrences} ocorrências com motivo. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>

      <MetricPanel title="KM rodado por transportador" description="Hodômetro do frete ou quilometragem original preservada na planilha importada." badge={loading ? "—" : `${kmGroups.length} com KM informado`}>
        <LoadingOrEmpty loading={loading} hasData={kmGroups.length > 0} text="Não há quilometragem informada nos fretes deste período." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{kmGroups.map(({ group, total, known }) => <DetailRow
          key={group.key} label={group.label} value={`${formatNumber(total)} km`}
          note={`${countFormat.format(known)} fretes com hodômetro informado`}
          barWidth={(total / maxKm) * 100} tone="blue" onClick={() => openCarrierDetail(group, "KM rodado", "Soma do campo de KM rodado informado nos fretes deste transportador.")}
          ariaLabel={`${group.label}: ${formatNumber(total)} quilômetros em ${known} fretes. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>

      <MetricPanel title="Entregas por cidade / região" description="Volumes enviados, realizadas, não realizadas e ocorrências por cidade e UF." badge={loading ? "—" : `${cityGroups.length} cidades / regiões`}>
        <LoadingOrEmpty loading={loading} hasData={cityGroups.length > 0} text="Não há lançamentos enviados com cidade informada neste período." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{cityGroups.map((group) => <DetailRow
          key={group.city} label={group.city} value={`${countFormat.format(group.planned)} entregas`}
          note={`${countFormat.format(group.realized)} realizadas · ${countFormat.format(group.notRealized)} não realizadas · ${countFormat.format(group.occurrences)} ocorrências com motivo`}
          barWidth={maxCityDeliveries ? (group.realized / maxCityDeliveries) * 100 : 0} barSecondaryWidth={maxCityDeliveries ? (group.notRealized / maxCityDeliveries) * 100 : 0} tone="green" onClick={() => setDetailSelection({
            title: `Entregas por cidade / região · ${group.city}`,
            description: "Lançamentos enviados agrupados pela cidade e UF da localidade, com entregas realizadas, não realizadas e motivos.",
            slice: { kind: "city", city: group.city },
          })}
          ariaLabel={`${group.city}: ${group.planned} entregas, ${group.realized} realizadas, ${group.notRealized} não realizadas e ${group.occurrences} ocorrências com motivo. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>

      <MetricPanel title="Taxa de acerto por transportadora" description="Entregas realizadas ÷ total de entregas realizadas e não realizadas." badge="Lançamentos enviados">
        <LoadingOrEmpty loading={loading} hasData={accuracyGroups.length > 0} text="Não há entregas planejadas suficientes para calcular a taxa de acerto." />
        {!loading && <div className={cx(styles, "transport-dashboard-list")}>{accuracyGroups.map(({ group, accuracy, planned, realized, notRealized }) => <DetailRow
          key={group.key} label={group.label} value={`${percentFormat.format(accuracy ?? 0)}%`}
          note={`${countFormat.format(realized)} realizadas de ${countFormat.format(planned)} · ${countFormat.format(notRealized)} não realizadas`}
          barWidth={accuracy ?? 0} tone={(accuracy ?? 0) < 90 ? "orange" : "green"} onClick={() => openCarrierDetail(group, "Taxa de acerto", "Taxa calculada como entregas realizadas divididas pelo total de entregas planejadas registradas.")}
          ariaLabel={`${group.label}: taxa de acerto ${percentFormat.format(accuracy ?? 0)} por cento, ${realized} realizadas de ${planned}. Abrir detalhamento.`}
        />)}</div>}
      </MetricPanel>
    </div>

    <aside className={cx(styles, "transport-dashboard-methodology")}>
      <strong>Como interpretar os indicadores</strong>
      <p>Pagamento segue a regra do relatório financeiro: líquido informado ou bruto menos avaria, excluindo fretes pendentes. Percentual compara frete bruto e valores das notas; KM vem do hodômetro ou, em históricos importados, da planilha preservada. Entregas, ocorrências e taxa de acerto usam lançamentos enviados e associam o motorista principal à transportadora registrada no lançamento. Cidade / região usa a cidade e UF da localidade de entrega. Clique em qualquer linha para abrir os registros que formam o indicador.</p>
    </aside>

    <TransportDashboardDetailDialog selection={detailSelection} freights={freights} deliveryRecords={deliveryRecords} contextLabel={contextLabel} onClose={() => setDetailSelection(null)} onNavigate={onNavigate} />
  </div>;
}
