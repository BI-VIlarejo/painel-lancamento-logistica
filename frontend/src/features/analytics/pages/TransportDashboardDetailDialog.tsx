import { Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./TransportDashboardDetailDialog.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { formatDate, formatMoney, formatNumber, numericValue } from "../../freights/format";
import type { FreightResponse } from "../../freights/types";
import type { TransportDeliveryRecord } from "./transportDashboardUtils";
import { cityRegionLabel, deliveryCityRegionLabel, deliveryOccurrenceCount, freightCarrier, transportKilometers, transportPaymentAmount } from "./transportDashboardUtils";

export type TransportDetailSlice =
  | { kind: "carrier"; key: string }
  | { kind: "city"; city: string };

export type TransportDetailSelection = {
  title: string;
  description: string;
  slice: TransportDetailSlice;
};

type Props = {
  selection: TransportDetailSelection | null;
  freights: FreightResponse[];
  deliveryRecords: TransportDeliveryRecord[];
  contextLabel: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
};

const numberFormat = new Intl.NumberFormat("pt-BR");
const weightFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const pageSize = 10;

function sumKnown<T>(items: T[], value: (item: T) => string | number | null | undefined) {
  let total = 0;
  let count = 0;
  for (const item of items) {
    const parsed = numericValue(value(item));
    if (parsed === null) continue;
    total += parsed;
    count += 1;
  }
  return { total, count };
}

function freightRate(items: FreightResponse[]) {
  const included = items.flatMap((item) => {
    const gross = numericValue(item.valor_frete_bruto);
    const invoice = numericValue(item.valor_nota);
    return gross !== null && invoice !== null && invoice > 0 ? [{ gross, invoice }] : [];
  });
  const gross = included.reduce((sum, item) => sum + item.gross, 0);
  const invoices = included.reduce((sum, item) => sum + item.invoice, 0);
  return { rate: invoices > 0 ? (gross / invoices) * 100 : null, count: included.length };
}

function matchesFreight(item: FreightResponse, slice: TransportDetailSlice): boolean {
  return slice.kind === "carrier"
    ? freightCarrier(item).key === slice.key
    : false;
}

function matchesDelivery(record: TransportDeliveryRecord, slice: TransportDetailSlice): boolean {
  return slice.kind === "carrier"
    ? record.carrier.key === slice.key
    : deliveryCityRegionLabel(record.item) === slice.city;
}

function Stat({ label, value, note, accent = false }: { label: string; value: string; note?: string; accent?: boolean }) {
  return <div className={cx(styles, commonStyles, `transport-detail-stat${accent ? " transport-detail-stat-accent" : ""}`)}>
    <dt>{label}</dt><dd>{value}</dd>{note && <small>{note}</small>}
  </div>;
}

function Pager({ count, page, setPage }: { count: number; page: number; setPage: (value: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const first = count ? page * pageSize + 1 : 0;
  const last = Math.min(count, (page + 1) * pageSize);
  if (count <= pageSize) return null;
  return <footer className={cx(styles, commonStyles, "transport-detail-pagination")}>
    <span>{first}–{last} de {numberFormat.format(count)}</span>
    <div>
      <button type="button" className={cx(styles, commonStyles, "button button-secondary")} disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>Anterior</button>
      <span>Página {page + 1} de {pageCount}</span>
      <button type="button" className={cx(styles, commonStyles, "button button-secondary")} disabled={page + 1 >= pageCount} onClick={() => setPage(Math.min(pageCount - 1, page + 1))}>Próxima</button>
    </div>
  </footer>;
}

function FreightExtra({ item }: { item: FreightResponse }) {
  const importValue = item.detalhe_calculo.importacao_planilha;
  const imported = typeof importValue === "object" && importValue !== null ? importValue as Record<string, unknown> : null;
  const displaySourceNumber = (stored: string | number | null, sourceKey: string) => {
    if (stored !== null) return formatNumber(stored);
    const sourceValue = imported?.[sourceKey];
    return typeof sourceValue === "string" || typeof sourceValue === "number" ? formatNumber(sourceValue) : "Não informado";
  };
  return <dl className={cx(styles, commonStyles, "transport-detail-fields")}>
    <div><dt>Nota fiscal</dt><dd>{formatMoney(item.valor_nota)}</dd></div>
    <div><dt>Percentual salvo</dt><dd>{item.percentual_frete === null ? "Não informado" : `${percentFormat.format((numericValue(item.percentual_frete) ?? 0) * 100)}%`}</dd></div>
    <div><dt>Avarias</dt><dd>{numberFormat.format(item.quantidade_avarias)} ocorrência(s) · {formatMoney(item.valor_avaria)}</dd></div>
    <div><dt>Hodômetro inicial</dt><dd>{displaySourceNumber(item.km_inicial, "km_inicial_planilha")}</dd></div>
    <div><dt>Hodômetro final</dt><dd>{displaySourceNumber(item.km_final, "km_final_planilha")}</dd></div>
    {item.km_rodado === null && transportKilometers(item) !== null && <div><dt>KM na planilha original</dt><dd>{formatNumber(transportKilometers(item))}</dd></div>}
    <div><dt>Tipo do veículo</dt><dd>{item.tipo_caminhao?.replaceAll("_", " ") || "Não informado"}</dd></div>
    <div><dt>Situação do cálculo</dt><dd>{item.status_calculo === "CALCULADO" ? "Calculado" : "Pendente de conferência"}</dd></div>
    {item.motivo_pendencia && <div className={cx(styles, commonStyles, "transport-detail-field-wide")}><dt>Conferência</dt><dd>{item.motivo_pendencia}</dd></div>}
    {item.observacao && <div className={cx(styles, commonStyles, "transport-detail-field-wide")}><dt>Observação</dt><dd>{item.observacao}</dd></div>}
  </dl>;
}

function DeliveryExtra({ record }: { record: TransportDeliveryRecord }) {
  const deliveryReasons = record.item.motivos.filter((reason) => reason.tipo_operacao === "ENTREGA");
  const participants = record.item.participantes.map((person) => `${person.nome_exibicao} · ${person.papel_participante === "MOTORISTA" ? "motorista" : "ajudante"}`);
  return <dl className={cx(styles, commonStyles, "transport-detail-fields")}>
    <div><dt>Unidade</dt><dd>{record.item.nome_localidade} · {record.item.codigo_localidade}</dd></div>
    <div><dt>Equipe</dt><dd>{participants.join(" · ") || "Não identificada"}</dd></div>
    <div><dt>Reclamações</dt><dd>{numberFormat.format(record.item.quantidade_reclamacoes ?? 0)}</dd></div>
    <div><dt>Elogios</dt><dd>{numberFormat.format(record.item.quantidade_elogios ?? 0)}</dd></div>
    <div className={cx(styles, commonStyles, "transport-detail-field-wide")}><dt>Motivos das não realizadas</dt><dd>{deliveryReasons.length
      ? deliveryReasons.map((reason) => `${reason.descricao_motivo} (${numberFormat.format(reason.quantidade)})`).join(" · ")
      : "Nenhum motivo detalhado"}</dd></div>
    {record.item.observacao && <div className={cx(styles, commonStyles, "transport-detail-field-wide")}><dt>Observação</dt><dd>{record.item.observacao}</dd></div>}
  </dl>;
}

export function TransportDashboardDetailDialog({ selection, freights, deliveryRecords, contextLabel, onClose, onNavigate }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const scrollPositionRef = useRef<{ left: number; top: number } | null>(null);
  const [freightPage, setFreightPage] = useState(0);
  const [deliveryPage, setDeliveryPage] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const restorePageScroll = useCallback((clearAfterRestore = false) => {
    const position = scrollPositionRef.current;
    if (!position) return;
    requestAnimationFrame(() => {
      window.scrollTo(position.left, position.top);
      requestAnimationFrame(() => {
        window.scrollTo(position.left, position.top);
        if (clearAfterRestore && scrollPositionRef.current === position) scrollPositionRef.current = null;
      });
    });
  }, []);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selection && !dialog.open) {
      scrollPositionRef.current = { left: window.scrollX, top: window.scrollY };
      dialog.showModal();
      closeButtonRef.current?.focus({ preventScroll: true });
      restorePageScroll();
    }
    if (!selection && dialog.open) dialog.close();
  }, [restorePageScroll, selection]);

  useLayoutEffect(() => {
    setFreightPage(0);
    setDeliveryPage(0);
    setExpandedKey(null);
  }, [selection]);

  const detailFreights = useMemo(() => selection
    ? freights.filter((item) => matchesFreight(item, selection.slice)).sort((a, b) => b.data_servico.localeCompare(a.data_servico) || b.codigo_frete.localeCompare(a.codigo_frete))
    : [], [freights, selection]);
  const detailDeliveries = useMemo(() => selection
    ? deliveryRecords.filter((record) => matchesDelivery(record, selection.slice)).sort((a, b) => b.item.data_entrega.localeCompare(a.item.data_entrega) || a.item.nome_localidade.localeCompare(b.item.nome_localidade, "pt-BR"))
    : [], [deliveryRecords, selection]);
  const totals = useMemo(() => {
    const paymentAmounts = detailFreights.flatMap((item) => {
      const amount = transportPaymentAmount(item);
      return amount === null ? [] : [amount];
    });
    const payment = { total: paymentAmounts.reduce((sum, amount) => sum + amount, 0), count: paymentAmounts.length };
    const km = sumKnown(detailFreights, transportKilometers);
    const rate = freightRate(detailFreights);
    const realized = detailDeliveries.reduce((sum, record) => sum + record.item.quantidade_realizada, 0);
    const notRealized = detailDeliveries.reduce((sum, record) => sum + record.item.quantidade_nao_realizada, 0);
    const planned = realized + notRealized;
    const occurrences = detailDeliveries.reduce((sum, record) => sum + deliveryOccurrenceCount(record), 0);
    return {
      payment, km, rate, realized, notRealized, planned, occurrences,
      accuracy: planned ? (realized / planned) * 100 : null,
    };
  }, [detailFreights, detailDeliveries]);

  const pageFreights = detailFreights.slice(freightPage * pageSize, (freightPage + 1) * pageSize);
  const pageDeliveries = detailDeliveries.slice(deliveryPage * pageSize, (deliveryPage + 1) * pageSize);

  return <dialog
    ref={dialogRef}
    className={cx(styles, commonStyles, "transport-detail-dialog")}
    aria-labelledby="transport-detail-title"
    onClose={() => { restorePageScroll(true); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
  >
    {selection && <>
      <header className={cx(styles, commonStyles, "transport-detail-header")}>
        <div><span>DETALHAMENTO DOS INDICADORES</span><h2 id="transport-detail-title">{selection.title}</h2><p>{contextLabel}</p></div>
        <button ref={closeButtonRef} className={cx(styles, commonStyles, "transport-detail-close")} type="button" aria-label="Fechar detalhamento" onClick={() => dialogRef.current?.close()}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      </header>
      <div className={cx(styles, commonStyles, "transport-detail-content")}>
        <p className={cx(styles, commonStyles, "transport-detail-intro")}>{selection.description}</p>

        <section className={cx(styles, commonStyles, "transport-detail-summary")} aria-label="Resumo do recorte">
          <dl>
            {selection.slice.kind === "city" ? <>
              <Stat label="Registros de entrega" value={numberFormat.format(detailDeliveries.length)} note="Lançamentos enviados na cidade / região" accent />
              <Stat label="Entregas planejadas" value={numberFormat.format(totals.planned)} note={`${numberFormat.format(totals.realized)} realizadas · ${numberFormat.format(totals.notRealized)} não realizadas`} />
              <Stat label="Ocorrências com motivo" value={numberFormat.format(totals.occurrences)} note="Associadas às entregas não realizadas" />
              <Stat label="Taxa de acerto" value={totals.accuracy === null ? "—" : `${percentFormat.format(totals.accuracy)}%`} note="Entregas realizadas ÷ planejadas" accent />
            </> : <>
              <Stat label="Fretes" value={numberFormat.format(detailFreights.length)} note="Registros do histórico no recorte" accent />
              <Stat label="Pagamento líquido" value={totals.payment.count ? formatMoney(totals.payment.total) : "—"} note={`${numberFormat.format(totals.payment.count)} fretes elegíveis`} />
              <Stat label="Frete bruto ÷ notas" value={totals.rate.rate === null ? "—" : `${percentFormat.format(totals.rate.rate)}%`} note={`${numberFormat.format(totals.rate.count)} fretes com os dois valores`} />
              <Stat label="KM rodado" value={totals.km.count ? `${formatNumber(totals.km.total)} km` : "—"} note={`${numberFormat.format(totals.km.count)} fretes com KM`} />
              <Stat label="Entregas planejadas" value={numberFormat.format(totals.planned)} note={`${numberFormat.format(totals.realized)} realizadas · ${numberFormat.format(totals.notRealized)} não realizadas`} accent />
              <Stat label="Ocorrências" value={numberFormat.format(totals.occurrences)} note="Motivos associados às entregas não realizadas" />
              <Stat label="Taxa de acerto" value={totals.accuracy === null ? "—" : `${percentFormat.format(totals.accuracy)}%`} note="Entregas realizadas ÷ planejadas" />
            </>}
          </dl>
        </section>

        {selection.slice.kind === "carrier" && <section className={cx(styles, commonStyles, "transport-detail-section")} aria-labelledby="transport-detail-freights-title">
          <div className={cx(styles, commonStyles, "transport-detail-section-heading")}>
            <div><h3 id="transport-detail-freights-title">Fretes que compõem o indicador</h3><p>Valores, cidade/rota e hodômetro registrados em cada frete.</p></div>
            <span>{numberFormat.format(detailFreights.length)} registro(s)</span>
          </div>
          {!detailFreights.length ? <p className={cx(styles, commonStyles, "transport-detail-empty")}>Nenhum frete corresponde a este recorte.</p> : <>
            <div className={cx(styles, commonStyles, "transport-detail-table-scroll")} role="region" aria-label="Fretes incluídos no indicador" tabIndex={0}>
              <table className={cx(styles, commonStyles, "transport-detail-table")}>
                <thead><tr><th>Data / código</th><th>Transportador</th><th>Cidade / rota</th><th>Entregas / KM</th><th>Pagamento líquido</th><th>Detalhes</th></tr></thead>
                <tbody>{pageFreights.map((item) => {
                  const rowKey = `freight:${item.codigo_frete}`;
                  const expanded = expandedKey === rowKey;
                  const carrier = freightCarrier(item);
                  return <Fragment key={rowKey}>
                    <tr>
                      <td><strong>{formatDate(item.data_servico)}</strong><small>{item.codigo_frete}</small></td>
                      <td><strong>{carrier.label}</strong><small>{carrier.driver ? `Motorista: ${carrier.driver}` : ""}</small></td>
                      <td>{cityRegionLabel(item)}</td>
                      <td>{item.quantidade_entregas === null ? "—" : numberFormat.format(item.quantidade_entregas)}<small>{transportKilometers(item) === null ? "KM não informado" : `${formatNumber(transportKilometers(item))} km`}</small></td>
                      <td><strong>{transportPaymentAmount(item) === null ? "—" : formatMoney(transportPaymentAmount(item))}</strong><small>Bruto {formatMoney(item.valor_frete_bruto)}</small></td>
                      <td><button className={cx(styles, commonStyles, "transport-detail-toggle")} type="button" aria-expanded={expanded} onClick={() => setExpandedKey(expanded ? null : rowKey)}>{expanded ? "Ocultar" : "Ver detalhes"}</button></td>
                    </tr>
                    {expanded && <tr className={cx(styles, commonStyles, "transport-detail-expanded-row")}><td colSpan={6}><FreightExtra item={item} /></td></tr>}
                  </Fragment>;
                })}</tbody>
              </table>
            </div>
            <Pager count={detailFreights.length} page={freightPage} setPage={(value) => { setFreightPage(value); setExpandedKey(null); }} />
          </>}
        </section>}

        <section className={cx(styles, commonStyles, "transport-detail-section")} aria-labelledby="transport-detail-deliveries-title">
          <div className={cx(styles, commonStyles, "transport-detail-section-heading")}>
            <div><h3 id="transport-detail-deliveries-title">Entregas e ocorrências que compõem o indicador</h3><p>{selection.slice.kind === "carrier" ? "O motorista principal define a transportadora do registro. Coletas ficam fora desta análise." : "Lançamentos enviados agrupados pela cidade e UF da localidade."}</p></div>
            <span>{numberFormat.format(detailDeliveries.length)} registro(s)</span>
          </div>
          {!detailDeliveries.length ? <p className={cx(styles, commonStyles, "transport-detail-empty")}>{selection.slice.kind === "carrier" ? "Nenhum lançamento de entrega corresponde a este transportador no período." : "Nenhum lançamento enviado corresponde a esta cidade / região no período."}</p> : <>
            <div className={cx(styles, commonStyles, "transport-detail-table-scroll")} role="region" aria-label="Lançamentos de entrega incluídos no indicador" tabIndex={0}>
              <table className={cx(styles, commonStyles, "transport-detail-table")}>
                <thead><tr><th>Data / lançamento</th><th>Transportador / motorista</th><th>Loja / cidade</th><th>Realizadas</th><th>Ocorrências</th><th>Detalhes</th></tr></thead>
                <tbody>{pageDeliveries.map((record) => {
                  const rowKey = `delivery:${record.launchCode}:${record.item.codigo_item_lancamento}`;
                  const expanded = expandedKey === rowKey;
                  const reasonCount = deliveryOccurrenceCount(record);
                  return <Fragment key={rowKey}>
                    <tr>
                      <td><strong>{formatDate(record.item.data_entrega)}</strong><small>{record.launchCode.slice(0, 12)}</small></td>
                      <td><strong>{record.carrier.label}</strong><small>{record.driver || "Motorista não informado"}</small></td>
                      <td><strong>{deliveryCityRegionLabel(record.item)}</strong><small>{record.item.nome_localidade}</small></td>
                      <td><strong>{numberFormat.format(record.item.quantidade_realizada)}</strong><small>{numberFormat.format(record.item.quantidade_nao_realizada)} não realizada(s)</small></td>
                      <td><strong>{numberFormat.format(reasonCount)}</strong><small>Reclamações {numberFormat.format(record.item.quantidade_reclamacoes ?? 0)} · elogios {numberFormat.format(record.item.quantidade_elogios ?? 0)}</small></td>
                      <td><button className={cx(styles, commonStyles, "transport-detail-toggle")} type="button" aria-expanded={expanded} onClick={() => setExpandedKey(expanded ? null : rowKey)}>{expanded ? "Ocultar" : "Ver detalhes"}</button></td>
                    </tr>
                    {expanded && <tr className={cx(styles, commonStyles, "transport-detail-expanded-row")}><td colSpan={6}><DeliveryExtra record={record} /></td></tr>}
                  </Fragment>;
                })}</tbody>
              </table>
            </div>
            <Pager count={detailDeliveries.length} page={deliveryPage} setPage={(value) => { setDeliveryPage(value); setExpandedKey(null); }} />
          </>}
        </section>

        <aside className={cx(styles, commonStyles, "transport-detail-methodology")}>
          <strong>Critérios de cálculo</strong>
          <p>Pagamento usa o valor líquido informado ou frete bruto menos avaria e segue a elegibilidade do relatório financeiro; pendências de conferência não entram na soma. Percentual de frete é frete bruto ÷ valor das notas com os dois campos informados. Entregas e acerto consideram lançamentos enviados: realizadas ÷ (realizadas + não realizadas). Ocorrências são os motivos vinculados a entregas não realizadas. KM usa o hodômetro salvo ou a quilometragem original da planilha nos históricos importados. Registros sem valores ficam na contagem e são sinalizados como não informados.</p>
        </aside>
      </div>
      <footer className={cx(styles, commonStyles, "transport-detail-footer")}>
        <span>Este detalhamento respeita o período selecionado no painel.</span>
        <div><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { dialogRef.current?.close(); onNavigate("/fretes/historico"); }}>Abrir histórico de fretes</button><button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={() => dialogRef.current?.close()}>Fechar</button></div>
      </footer>
    </>}
  </dialog>;
}
