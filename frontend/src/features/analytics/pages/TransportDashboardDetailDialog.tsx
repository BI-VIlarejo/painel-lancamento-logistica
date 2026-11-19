import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./TransportDashboardDetailDialog.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { messageFromApiError } from "../../../shared/api/apiError";
import { analyticsApi } from "../api";
import type { TransportDashboardDetailResponse, TransportDetailDeliveryItem } from "../types";
import { formatDate, formatMoney, formatNumber, numericValue } from "../../freights/format";
import type { FreightResponse } from "../../freights/types";
import { cityRegionLabel, freightCarrier, transportKilometers, transportPaymentAmount } from "./transportDashboardUtils";

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
  fromDate: string;
  toDate: string;
  contextLabel: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
};

const numberFormat = new Intl.NumberFormat("pt-BR");
const percentFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const pageSize = 10;

function Stat({ label, value, note, accent = false }: { label: string; value: string; note?: string; accent?: boolean }) {
  return <div className={cx(styles, commonStyles, `transport-detail-stat${accent ? " transport-detail-stat-accent" : ""}`)}>
    <dt>{label}</dt><dd>{value}</dd>{note && <small>{note}</small>}
  </div>;
}

function Pager({ count, page, setPage, disabled = false }: { count: number; page: number; setPage: (value: number) => void; disabled?: boolean }) {
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const first = count ? page * pageSize + 1 : 0;
  const last = Math.min(count, (page + 1) * pageSize);
  if (count <= pageSize) return null;
  return <footer className={cx(styles, commonStyles, "transport-detail-pagination")}>
    <span>{first}–{last} de {numberFormat.format(count)}</span>
    <div>
      <button type="button" className={cx(styles, commonStyles, "button button-secondary")} disabled={disabled || page === 0} onClick={() => setPage(Math.max(0, page - 1))}>Anterior</button>
      <span>Página {page + 1} de {pageCount}</span>
      <button type="button" className={cx(styles, commonStyles, "button button-secondary")} disabled={disabled || page + 1 >= pageCount} onClick={() => setPage(Math.min(pageCount - 1, page + 1))}>Próxima</button>
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

function deliveryItemCityRegion(item: TransportDetailDeliveryItem): string {
  const city = item.cidade?.trim();
  const uf = item.uf?.trim();
  if (city && uf) return `${city} / ${uf}`;
  if (city) return city;
  return item.nome_localidade?.trim() || "Cidade não informada";
}

function DeliveryExtra({ item }: { item: TransportDetailDeliveryItem }) {
  const participants = item.participantes.map((person) => `${person.nome_exibicao} · ${person.papel_participante === "MOTORISTA" ? "motorista" : "ajudante"}`);
  return <dl className={cx(styles, commonStyles, "transport-detail-fields")}>
    <div><dt>Unidade</dt><dd>{item.nome_localidade} · {item.codigo_localidade}</dd></div>
    <div><dt>Equipe</dt><dd>{participants.join(" · ") || "Não identificada"}</dd></div>
    <div><dt>Reclamações</dt><dd>{numberFormat.format(item.quantidade_reclamacoes ?? 0)}</dd></div>
    <div><dt>Elogios</dt><dd>{numberFormat.format(item.quantidade_elogios ?? 0)}</dd></div>
    <div className={cx(styles, commonStyles, "transport-detail-field-wide")}><dt>Motivos das não realizadas</dt><dd>{item.motivos.length
      ? item.motivos.map((reason) => `${reason.descricao_motivo} (${numberFormat.format(reason.quantidade)})`).join(" · ")
      : "Nenhum motivo detalhado"}</dd></div>
    {item.observacao && <div className={cx(styles, commonStyles, "transport-detail-field-wide")}><dt>Observação</dt><dd>{item.observacao}</dd></div>}
  </dl>;
}

export function TransportDashboardDetailDialog({ selection, fromDate, toDate, contextLabel, onClose, onNavigate }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const scrollPositionRef = useRef<{ left: number; top: number } | null>(null);
  const [pagination, setPagination] = useState<{ selection: TransportDetailSelection | null; freightPage: number; deliveryPage: number }>({
    selection: null,
    freightPage: 0,
    deliveryPage: 0,
  });
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<TransportDashboardDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retryToken, setRetryToken] = useState(0);

  const freightPage = pagination.selection === selection ? pagination.freightPage : 0;
  const deliveryPage = pagination.selection === selection ? pagination.deliveryPage : 0;
  const selectionSliceKey = selection
    ? (selection.slice.kind === "carrier" ? selection.slice.key : selection.slice.city)
    : "";
  const selectionKind = selection?.slice.kind ?? null;

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

  useEffect(() => {
    setExpandedKey(null);
  }, [selection]);

  useEffect(() => {
    if (!selection || !selectionKind || !selectionSliceKey) {
      setDetailData(null);
      setLoading(false);
      setError("");
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    setDetailData((current) => (
      current
      && current.kind === selectionKind
      && current.key === selectionSliceKey
      && (current.data_de ?? "") === fromDate
      && (current.data_ate ?? "") === toDate
        ? current
        : null
    ));

    void analyticsApi.transportDetails({
      kind: selectionKind,
      key: selectionSliceKey,
      data_de: fromDate || undefined,
      data_ate: toDate || undefined,
      freight_limit: pageSize,
      freight_offset: freightPage * pageSize,
      delivery_limit: pageSize,
      delivery_offset: deliveryPage * pageSize,
    }, controller.signal)
      .then((response) => {
        if (!active || controller.signal.aborted) return;
        setDetailData(response);
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
  }, [selection, selectionKind, selectionSliceKey, fromDate, toDate, freightPage, deliveryPage, retryToken]);

  const totals = detailData?.totals;
  const pageFreights = detailData?.fretes.items ?? [];
  const totalFreights = detailData?.fretes.total ?? 0;
  const pageDeliveries = detailData?.entregas.items ?? [];
  const totalDeliveries = detailData?.entregas.total ?? 0;

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

        {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>{error}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setRetryToken((t) => t + 1)}>Tentar novamente</button></div>}

        {loading && !detailData ? (
          <p className={cx(styles, commonStyles, "transport-detail-empty")} role="status">Carregando detalhamento…</p>
        ) : totals && <>
          <section className={cx(styles, commonStyles, "transport-detail-summary")} aria-label="Resumo do recorte">
            <dl>
              {selection.slice.kind === "city" ? <>
                <Stat label="Registros de entrega" value={numberFormat.format(totals.registros_entrega)} note="Lançamentos enviados na cidade / região" accent />
                <Stat label="Entregas planejadas" value={numberFormat.format(totals.entregas_planejadas)} note={`${numberFormat.format(totals.entregas_realizadas)} realizadas · ${numberFormat.format(totals.entregas_nao_realizadas)} não realizadas`} />
                <Stat label="Ocorrências com motivo" value={numberFormat.format(totals.ocorrencias)} note="Associadas às entregas não realizadas" />
                <Stat label="Taxa de acerto" value={totals.taxa_acerto === null ? "—" : `${percentFormat.format(totals.taxa_acerto)}%`} note="Entregas realizadas ÷ planejadas" accent />
              </> : <>
                <Stat label="Fretes" value={numberFormat.format(totals.fretes_count)} note="Registros do histórico no recorte" accent />
                <Stat label="Pagamento líquido" value={totals.pagamento_count ? formatMoney(totals.pagamento_total) : "—"} note={`${numberFormat.format(totals.pagamento_count)} fretes elegíveis`} />
                <Stat label="Frete bruto ÷ notas" value={totals.percentual_frete === null ? "—" : `${percentFormat.format(totals.percentual_frete)}%`} note={`${numberFormat.format(totals.percentual_count)} fretes com os dois valores`} />
                <Stat label="KM rodado" value={totals.km_count ? `${formatNumber(totals.km_total)} km` : "—"} note={`${numberFormat.format(totals.km_count)} fretes com KM`} />
                <Stat label="Entregas planejadas" value={numberFormat.format(totals.entregas_planejadas)} note={`${numberFormat.format(totals.entregas_realizadas)} realizadas · ${numberFormat.format(totals.entregas_nao_realizadas)} não realizadas`} accent />
                <Stat label="Ocorrências" value={numberFormat.format(totals.ocorrencias)} note="Motivos associados às entregas não realizadas" />
                <Stat label="Taxa de acerto" value={totals.taxa_acerto === null ? "—" : `${percentFormat.format(totals.taxa_acerto)}%`} note="Entregas realizadas ÷ planejadas" />
              </>}
            </dl>
          </section>

          {selection.slice.kind === "carrier" && <section className={cx(styles, commonStyles, "transport-detail-section")} aria-labelledby="transport-detail-freights-title">
            <div className={cx(styles, commonStyles, "transport-detail-section-heading")}>
              <div><h3 id="transport-detail-freights-title">Fretes que compõem o indicador</h3><p>Valores, cidade/rota e hodômetro registrados em cada frete.</p></div>
              <span>{numberFormat.format(totalFreights)} registro(s)</span>
            </div>
            {!totalFreights ? <p className={cx(styles, commonStyles, "transport-detail-empty")}>Nenhum frete corresponde a este recorte.</p> : <>
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
              <Pager count={totalFreights} page={freightPage} disabled={loading} setPage={(value) => { setPagination({ selection, freightPage: value, deliveryPage }); setExpandedKey(null); }} />
            </>}
          </section>}

          <section className={cx(styles, commonStyles, "transport-detail-section")} aria-labelledby="transport-detail-deliveries-title">
            <div className={cx(styles, commonStyles, "transport-detail-section-heading")}>
              <div><h3 id="transport-detail-deliveries-title">Entregas e ocorrências que compõem o indicador</h3><p>{selection.slice.kind === "carrier" ? "O motorista principal define a transportadora do registro. Coletas ficam fora desta análise." : "Lançamentos enviados agrupados pela cidade e UF da localidade."}</p></div>
              <span>{numberFormat.format(totalDeliveries)} registro(s)</span>
            </div>
            {!totalDeliveries ? <p className={cx(styles, commonStyles, "transport-detail-empty")}>{selection.slice.kind === "carrier" ? "Nenhum lançamento de entrega corresponde a este transportador no período." : "Nenhum lançamento enviado corresponde a esta cidade / região no período."}</p> : <>
              <div className={cx(styles, commonStyles, "transport-detail-table-scroll")} role="region" aria-label="Lançamentos de entrega incluídos no indicador" tabIndex={0}>
                <table className={cx(styles, commonStyles, "transport-detail-table")}>
                  <thead><tr><th>Data / lançamento</th><th>Transportador / motorista</th><th>Loja / cidade</th><th>Realizadas</th><th>Ocorrências</th><th>Detalhes</th></tr></thead>
                  <tbody>{pageDeliveries.map((item) => {
                    const rowKey = `delivery:${item.codigo_lancamento}:${item.codigo_item_lancamento}`;
                    const expanded = expandedKey === rowKey;
                    return <Fragment key={rowKey}>
                      <tr>
                        <td><strong>{formatDate(item.data_entrega)}</strong><small>{item.codigo_lancamento.slice(0, 12)}</small></td>
                        <td><strong>{item.carrier_label}</strong><small>{item.driver || "Motorista não informado"}</small></td>
                        <td><strong>{deliveryItemCityRegion(item)}</strong><small>{item.nome_localidade}</small></td>
                        <td><strong>{numberFormat.format(item.quantidade_realizada)}</strong><small>{numberFormat.format(item.quantidade_nao_realizada)} não realizada(s)</small></td>
                        <td><strong>{numberFormat.format(item.ocorrencias)}</strong><small>Reclamações {numberFormat.format(item.quantidade_reclamacoes ?? 0)} · elogios {numberFormat.format(item.quantidade_elogios ?? 0)}</small></td>
                        <td><button className={cx(styles, commonStyles, "transport-detail-toggle")} type="button" aria-expanded={expanded} onClick={() => setExpandedKey(expanded ? null : rowKey)}>{expanded ? "Ocultar" : "Ver detalhes"}</button></td>
                      </tr>
                      {expanded && <tr className={cx(styles, commonStyles, "transport-detail-expanded-row")}><td colSpan={6}><DeliveryExtra item={item} /></td></tr>}
                    </Fragment>;
                  })}</tbody>
                </table>
              </div>
              <Pager count={totalDeliveries} page={deliveryPage} disabled={loading} setPage={(value) => { setPagination({ selection, freightPage, deliveryPage: value }); setExpandedKey(null); }} />
            </>}
          </section>
        </>}

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
