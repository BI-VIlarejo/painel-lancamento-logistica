import styles from "./DeliveryHistoryPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { useEffect, useRef, useState } from "react";
import { deliveriesApi } from "../api";
import { catalogsApi } from "../../catalogs/api";
import { DeliveryCsvImportDialog } from "../components/DeliveryCsvImportDialog";
import { messageFromApiError } from "../../../shared/api/apiError";
import { deliveryTransportLabel, nonDeliveryReasonGroupLabel } from "../classifications";
import type { DeliveryTransportType } from "../classifications";
import type { DeliveryEvent, DeliveryHistoryFilters, DeliveryItemResponse, DeliveryLaunchDetail, DeliveryLaunchSummary, DeliveryStatus, LocalityCatalogItem, NonDeliveryReasonCatalogItem, PersonCatalogItem } from "../types";

type DeliveryHistoryPageProps = { onNavigate: (path: string) => void; canCreate: boolean; canEditDraft: boolean; canCorrect: boolean; canCancel: boolean; currentUserId: number };
const pageSizeOptions = [10, 25, 50, 100] as const;
const percentageFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const statusLabels: Record<DeliveryStatus, string> = {
  RASCUNHO: "Rascunho",
  ENVIADA: "Lançada",
  EM_REVISAO: "Em revisão (fluxo anterior)",
  DEVOLVIDA: "Devolvida (fluxo anterior)",
  APROVADA: "Aprovada (fluxo anterior)",
  CANCELADA: "Cancelada",
};

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function otifValue(item: DeliveryItemResponse): number | null {
  const legacyCollection = item.tipo_operacao === "COLETA";
  const deliveryCompleted = legacyCollection ? 0 : item.quantidade_realizada;
  const deliveryNotCompleted = legacyCollection ? 0 : item.quantidade_nao_realizada;
  const collectionCompleted = item.quantidade_coleta_realizada ?? (legacyCollection ? item.quantidade_realizada : 0);
  const collectionNotCompleted = item.quantidade_coleta_nao_realizada ?? (legacyCollection ? item.quantidade_nao_realizada : 0);
  const total = deliveryCompleted + deliveryNotCompleted + collectionCompleted + collectionNotCompleted;
  if (!total) return null;
  return (deliveryNotCompleted + collectionNotCompleted) / total * 100;
}

function itemQuantities(item: DeliveryItemResponse) {
  const legacyCollection = item.tipo_operacao === "COLETA";
  return {
    entregasRealizadas: legacyCollection ? 0 : item.quantidade_realizada,
    entregasNaoRealizadas: legacyCollection ? 0 : item.quantidade_nao_realizada,
    coletasRealizadas: item.quantidade_coleta_realizada ?? (legacyCollection ? item.quantidade_realizada : 0),
    coletasNaoRealizadas: item.quantidade_coleta_nao_realizada ?? (legacyCollection ? item.quantidade_nao_realizada : 0),
  };
}

function rateText(value: number): string {
  return `${percentageFormat.format(value)}%`;
}

function statusClass(status: DeliveryStatus): string {
  return `status-pill status-${status.toLowerCase()}`;
}

function teamDescription(item: DeliveryItemResponse): string {
  const driver = item.participantes.find((person) => person.papel_participante === "MOTORISTA");
  const helpers = item.participantes.filter((person) => person.papel_participante === "AJUDANTE");
  return [driver ? `Motorista: ${driver.nome_exibicao}` : "Motorista não informado", helpers.length ? `Ajudantes: ${helpers.map((person) => person.nome_exibicao).join(", ")}` : "Sem ajudantes"].join("; ");
}

function deliveryTypeDescription(item: DeliveryItemResponse): string {
  const types = new Set(item.participantes
    .map((person) => person.tipo_transporte_entrega)
    .filter((type): type is DeliveryTransportType => type !== null));
  if (types.size > 1) return "Equipe mista";
  if (item.participantes.some((person) => person.tipo_transporte_entrega === null)) return "Sem classificação";
  return deliveryTransportLabel([...types][0]);
}

function reasonDescription(item: DeliveryItemResponse): string {
  return item.motivos.length
    ? item.motivos.map((reason) => `${reason.tipo_operacao === "COLETA" ? "Coleta" : "Entrega"}: ${reason.descricao_motivo} [${nonDeliveryReasonGroupLabel(reason.grupo_motivo)}]`).join("; ")
    : "Sem ocorrências";
}

function operationName(item: DeliveryItemResponse): string {
  const quantities = itemQuantities(item);
  const hasDelivery = quantities.entregasRealizadas + quantities.entregasNaoRealizadas > 0;
  const hasCollection = quantities.coletasRealizadas + quantities.coletasNaoRealizadas > 0;
  return hasDelivery && hasCollection ? "Entrega + coleta" : hasCollection ? "Coleta" : "Entrega";
}

function itemMatchesFilters(
  item: DeliveryItemResponse,
  filters: Pick<DeliveryHistoryFilters, "id_localidade" | "id_motorista" | "id_motivo_nao_entrega" | "tipo_operacao" | "data_de" | "data_ate">,
): boolean {
  if (filters.id_localidade !== undefined && item.id_localidade !== filters.id_localidade) return false;
  if (filters.data_de && item.data_entrega < filters.data_de) return false;
  if (filters.data_ate && item.data_entrega > filters.data_ate) return false;
  if (filters.id_motorista !== undefined && !item.participantes.some((person) => person.papel_participante === "MOTORISTA" && person.id_pessoa === filters.id_motorista)) return false;
  if (filters.id_motivo_nao_entrega !== undefined && !item.motivos.some((reason) => reason.id_motivo_nao_entrega === filters.id_motivo_nao_entrega && (!filters.tipo_operacao || reason.tipo_operacao === filters.tipo_operacao))) return false;
  const quantities = itemQuantities(item);
  if (filters.tipo_operacao === "ENTREGA" && quantities.entregasRealizadas + quantities.entregasNaoRealizadas === 0) return false;
  if (filters.tipo_operacao === "COLETA" && quantities.coletasRealizadas + quantities.coletasNaoRealizadas === 0) return false;
  return true;
}

function reasonObservationDescription(item: DeliveryItemResponse): string {
  return item.motivos
    .flatMap((reason) => {
      const observation = reason.observacao?.trim();
      return observation ? [`${reason.tipo_operacao === "COLETA" ? "Coleta" : "Entrega"} · ${reason.descricao_motivo}: ${observation}`] : [];
    })
    .join("; ");
}

function HistoryReasonCell({ reasons }: { reasons: DeliveryItemResponse["motivos"] }) {
  if (!reasons.length) return <span className={cx(styles, commonStyles, "history-muted-cell")}>Sem ocorrências</span>;

  const shouldCollapse = reasons.length > 1 || reasons.some((reason) =>
    reason.descricao_motivo.length > 84 || (reason.observacao?.trim().length ?? 0) > 84,
  );
  const reasonList = <ul className={cx(styles, commonStyles, "history-reasons")}>{reasons.map((reason, reasonIndex) => <li key={`${reason.id_motivo_nao_entrega}-${reasonIndex}`}>{reason.descricao_motivo} · {nonDeliveryReasonGroupLabel(reason.grupo_motivo)}{reason.observacao && <small>Observação: {reason.observacao}</small>}</li>)}</ul>;

  if (!shouldCollapse) return reasonList;

  const firstReason = reasons[0];
  const preview = `${firstReason.descricao_motivo} · ${nonDeliveryReasonGroupLabel(firstReason.grupo_motivo)}${firstReason.observacao ? ` · ${firstReason.observacao}` : ""}`;
  return <details className={cx(styles, commonStyles, "history-reasons-disclosure")}>
    <summary>
      <span className={cx(styles, commonStyles, "history-reason-preview")}>{preview}</span>
      <span className={cx(styles, commonStyles, "history-reason-count")}>{reasons.length > 1 ? `${reasons.length} motivos` : "Ver detalhes"}</span>
      <span className={cx(styles, commonStyles, "history-reason-chevron")} aria-hidden="true" />
    </summary>
    {reasonList}
  </details>;
}

function DetailDialog({ detail, events, onClose, onEdit, onCorrect, onCancel }: { detail: DeliveryLaunchDetail; events: DeliveryEvent[]; onClose: () => void; onEdit?: () => void; onCorrect?: () => void; onCancel?: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className={cx(styles, commonStyles, "dialog-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={cx(styles, commonStyles, "detail-dialog")} role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className={cx(styles, commonStyles, "dialog-heading")}>
          <div><p className={cx(styles, commonStyles, "eyebrow")}>DETALHES DO LANÇAMENTO</p><h2 id="detail-title">{detail.nome_setor} <span>· Versão {detail.numero_revisao}</span></h2></div>
          <button ref={closeButton} className={cx(styles, commonStyles, "icon-button dialog-close")} type="button" aria-label="Fechar detalhes" onClick={onClose}>×</button>
        </div>
        <div className={cx(styles, commonStyles, "dialog-meta")}><span className={cx(styles, commonStyles, statusClass(detail.estado))}><i />{statusLabels[detail.estado]}</span><span className={cx(styles, commonStyles, "detail-launch-code")}>Código · {detail.codigo_lancamento}</span><span>Criado em {formatDateTime(detail.criado_em)}</span></div>
        <section className={cx(styles, commonStyles, "detail-audit")} aria-label="Histórico de alterações">
          <h3>Histórico de alterações</h3>
          {events.length ? <ol>{events.map((event) => <li key={event.id_evento}>
            <strong>Versão {event.numero_revisao} · {event.tipo_evento.replaceAll("_", " ").toLocaleLowerCase("pt-BR")}</strong>
            <time dateTime={event.ocorrido_em}>{formatDateTime(event.ocorrido_em)}</time>
            {event.comentario && <p>{event.comentario}</p>}
          </li>)}</ol> : <p>Nenhum evento disponível.</p>}
        </section>
        <div className={cx(styles, commonStyles, "detail-items")}>
          {detail.itens.map((item, index) => (
            <article className={cx(styles, commonStyles, "detail-item")} key={item.codigo_item_lancamento}>
              <div className={cx(styles, commonStyles, "detail-item-heading")}><span className={cx(styles, commonStyles, "delivery-index")}>{String(index + 1).padStart(2, "0")}</span><div><strong>Registro · {item.nome_localidade}</strong><small>{formatDate(item.data_entrega)}</small></div></div>
              {(() => { const q = itemQuantities(item); return <div className={cx(styles, commonStyles, "detail-metrics")}><div><strong>{q.entregasRealizadas}</strong><span>entregas realizadas</span></div><div><strong>{q.entregasNaoRealizadas}</strong><span>entregas não realizadas</span></div><div><strong>{q.coletasRealizadas}</strong><span>coletas realizadas</span></div><div><strong>{q.coletasNaoRealizadas}</strong><span>coletas não realizadas</span></div></div>; })()}
              {(() => { const otif = otifValue(item); const q = itemQuantities(item); const notCompleted = q.entregasNaoRealizadas + q.coletasNaoRealizadas; const total = q.entregasRealizadas + q.entregasNaoRealizadas + q.coletasRealizadas + q.coletasNaoRealizadas; return <div className={cx(styles, commonStyles, "detail-otif")}><strong>OTIF combinado</strong>{otif === null ? <span>Sem entregas ou coletas registradas para calcular</span> : <span>{rateText(otif)} · {notCompleted.toLocaleString("pt-BR")} não realizadas de {total.toLocaleString("pt-BR")}</span>}</div>; })()}
              <div className={cx(styles, commonStyles, "detail-team")}><span>Equipe · {deliveryTypeDescription(item)}</span>{item.participantes.map((person) => <span className={cx(styles, commonStyles, "team-chip")} key={`${person.id_pessoa}-${person.papel_participante}`}>{person.nome_exibicao}<small>{person.papel_participante === "MOTORISTA" ? "Motorista" : "Ajudante"} · {deliveryTransportLabel(person.tipo_transporte_entrega)}</small></span>)}</div>
              {item.motivos.length > 0 && <div className={cx(styles, commonStyles, "detail-reasons")}><span>Motivos e observações, um por item não realizado</span>{item.motivos.map((reason, reasonIndex) => <div className={cx(styles, commonStyles, "detail-reason")} key={`${reason.id_motivo_nao_entrega}-${reasonIndex}`}><span>{reason.tipo_operacao === "COLETA" ? "Coleta" : "Entrega"} · {reason.descricao_motivo} · {nonDeliveryReasonGroupLabel(reason.grupo_motivo)}</span>{reason.observacao && <small>Observação: {reason.observacao}</small>}</div>)}</div>}
              {item.observacao && <p className={cx(styles, commonStyles, "detail-observation")}><strong>Observação geral (registro antigo):</strong> {item.observacao}</p>}
            </article>
          ))}
        </div>
        <div className={cx(styles, commonStyles, "dialog-footer")}><span>{onEdit || onCorrect ? "O lançamento pode ser editado pelo histórico." : "Este registro está em modo de consulta."}</span><div className={cx(styles, commonStyles, "dialog-actions")}>{onEdit && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={onEdit}>Editar lançamento</button>}{onCorrect && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={onCorrect}>Editar lançamento</button>}{onCancel && <button className={cx(styles, commonStyles, "button button-secondary table-action-danger")} type="button" onClick={onCancel}>Cancelar lançamento</button>}<button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={onClose}>Fechar</button></div></div>
      </section>
    </div>
  );
}

export function DeliveryHistoryPage({ onNavigate, canCreate, canEditDraft, canCorrect, canCancel, currentUserId }: DeliveryHistoryPageProps) {
  const [items, setItems] = useState<DeliveryLaunchSummary[]>([]);
  const [localities, setLocalities] = useState<LocalityCatalogItem[]>([]);
  const [drivers, setDrivers] = useState<PersonCatalogItem[]>([]);
  const [reasons, setReasons] = useState<NonDeliveryReasonCatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<DeliveryStatus | "TODOS" | "LANÇADO">("TODOS");
  const [localityId, setLocalityId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [reasonId, setReasonId] = useState("");
  const [operation, setOperation] = useState<"" | "ENTREGA" | "COLETA">("");
  const [mineOnly, setMineOnly] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<DeliveryLaunchDetail | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<DeliveryEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [failedDetail, setFailedDetail] = useState<DeliveryLaunchSummary | null>(null);
  const [notice, setNotice] = useState("");
  const [localitiesLoading, setLocalitiesLoading] = useState(true);
  const [localitiesError, setLocalitiesError] = useState("");
  const [filterCatalogsLoading, setFilterCatalogsLoading] = useState(true);
  const [filterCatalogsError, setFilterCatalogsError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);

  useEffect(() => {
    const messageType = window.sessionStorage.getItem("lancamento-logistica:show-saved-message");
    if (messageType) {
      setNotice(messageType === "launched" || messageType === "submitted" ? "Lançamento registrado e já disponível nos indicadores." : messageType === "updated" ? "Rascunho atualizado." : "Rascunho salvo. Você pode consultá-lo nesta lista.");
      window.sessionStorage.removeItem("lancamento-logistica:show-saved-message");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void catalogsApi.localities()
      .then((page) => { if (active) setLocalities(page.items); })
      .catch((loadError: unknown) => { if (active) setLocalitiesError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLocalitiesLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([catalogsApi.people("MOTORISTA"), catalogsApi.reasons()])
      .then(([driverPage, reasonPage]) => {
        if (!active) return;
        setDrivers(driverPage.items);
        setReasons(reasonPage.items);
        setFilterCatalogsError("");
      })
      .catch((loadError: unknown) => { if (active) setFilterCatalogsError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setFilterCatalogsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setFailedDetail(null);
    void deliveriesApi.list({ estado: status, id_localidade: localityId ? Number(localityId) : undefined, id_motorista: driverId ? Number(driverId) : undefined, id_motivo_nao_entrega: reasonId ? Number(reasonId) : undefined, tipo_operacao: operation || undefined, criado_por: mineOnly ? currentUserId : undefined, data_de: fromDate || undefined, data_ate: toDate || undefined, limit: pageSize, offset })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((loadError: unknown) => {
        if (active) setError(messageFromApiError(loadError));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [status, localityId, driverId, reasonId, operation, mineOnly, currentUserId, fromDate, toDate, pageSize, offset, reloadVersion]);

  const activeFilterCount = [localityId, driverId, reasonId, operation, mineOnly, fromDate, toDate].filter(Boolean).length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;
  const selectedItemFilters = {
    id_localidade: localityId ? Number(localityId) : undefined,
    id_motorista: driverId ? Number(driverId) : undefined,
    id_motivo_nao_entrega: reasonId ? Number(reasonId) : undefined,
    tipo_operacao: operation || undefined,
    data_de: fromDate || undefined,
    data_ate: toDate || undefined,
  } as const;
  const visibleRows = items.flatMap((launch) => launch.itens
    .filter((delivery) => itemMatchesFilters(delivery, selectedItemFilters))
    .map((delivery) => ({ launch, delivery })));
  const pageDeliveryCount = visibleRows.length;

  async function openDetail(item: DeliveryLaunchSummary) {
    setDetailLoading(true);
    setSelected(null);
    setSelectedEvents([]);
    setFailedDetail(item);
    setError("");
    try {
      const [detail, events] = await Promise.all([
        deliveriesApi.get(item.codigo_lancamento),
        deliveriesApi.events(item.codigo_lancamento),
      ]);
      setSelected(detail);
      setSelectedEvents(events);
      setFailedDetail(null);
    } catch (detailError) {
      setError(messageFromApiError(detailError));
    } finally {
      setDetailLoading(false);
    }
  }

  async function startCorrection(item: DeliveryLaunchSummary | DeliveryLaunchDetail) {
    setDiscardingId(item.codigo_lancamento);
    setError("");
    try {
      await deliveriesApi.startCorrection(item.codigo_lancamento, crypto.randomUUID());
      setNotice("Edição aberta. Ao salvar, a nova revisão substituirá a anterior nos indicadores.");
      onNavigate(`/entregas/${item.codigo_lancamento}`);
    } catch (correctionError) {
      setError(messageFromApiError(correctionError));
      setReloadVersion((value) => value + 1);
    } finally {
      setDiscardingId(null);
    }
  }

  async function cancelConfirmed(item: DeliveryLaunchSummary | DeliveryLaunchDetail) {
    const justification = window.prompt("Informe a justificativa obrigatória para cancelar este lançamento:");
    if (justification === null || justification.trim().length < 5) return;
    if (!window.confirm("Cancelar este lançamento? Ele deixará de compor os indicadores e permanecerá no histórico de auditoria.")) return;
    setDiscardingId(item.codigo_lancamento);
    setError("");
    try {
      await deliveriesApi.cancel(item.codigo_lancamento, justification.trim(), crypto.randomUUID());
      setSelected(null);
      setNotice("Lançamento cancelado e preservado no histórico.");
      setReloadVersion((value) => value + 1);
    } catch (cancelError) {
      setError(messageFromApiError(cancelError));
      setReloadVersion((value) => value + 1);
    } finally {
      setDiscardingId(null);
    }
  }

  async function discardDraft(item: DeliveryLaunchSummary) {
    const confirmed = window.confirm("Excluir este rascunho? Ele será marcado como cancelado e continuará no histórico para auditoria.");
    if (!confirmed) return;
    setDiscardingId(item.codigo_lancamento);
    setError("");
    setFailedDetail(null);
    try {
      await deliveriesApi.discardDraft(item.codigo_lancamento, crypto.randomUUID());
      setNotice("Rascunho descartado e mantido no histórico para auditoria.");
      setFailedDetail(null);
      setReloadVersion((value) => value + 1);
    } catch (discardError) {
      setError(messageFromApiError(discardError));
    } finally {
      setDiscardingId(null);
    }
  }

  async function exportCsv() {
    setExporting(true);
    setExportError("");
    try {
      const filters: DeliveryHistoryFilters = {
        estado: status,
        id_localidade: localityId ? Number(localityId) : undefined,
        id_motorista: driverId ? Number(driverId) : undefined,
        id_motivo_nao_entrega: reasonId ? Number(reasonId) : undefined,
        tipo_operacao: operation || undefined,
        criado_por: mineOnly ? currentUserId : undefined,
        data_de: fromDate || undefined,
        data_ate: toDate || undefined,
        limit: 100,
        offset: 0,
      };
      const firstPage = await deliveriesApi.list(filters);
      const allItems = [...firstPage.items];
      let nextOffset = allItems.length;
      while (nextOffset < firstPage.total) {
        const nextPage = await deliveriesApi.list({ ...filters, offset: nextOffset });
        if (nextPage.items.length === 0) break;
        allItems.push(...nextPage.items);
        nextOffset += nextPage.items.length;
      }

      type ExportRow = { launch: DeliveryLaunchSummary; delivery: DeliveryItemResponse };
      const exportRows: ExportRow[] = allItems.flatMap((launch) => launch.itens
        .filter((delivery) => itemMatchesFilters(delivery, selectedItemFilters))
        .map((delivery) => ({ launch, delivery })));
      const columns: Array<[string, (row: ExportRow) => string | number]> = [
        ["data", (row) => row.delivery.data_entrega],
        ["loja", (row) => row.delivery.nome_localidade],
        ["equipe", (row) => teamDescription(row.delivery)],
        ["operacao", (row) => operationName(row.delivery)],
        ["tipo_transporte", (row) => deliveryTypeDescription(row.delivery)],
        ["entregas_realizadas", (row) => itemQuantities(row.delivery).entregasRealizadas],
        ["entregas_nao_realizadas", (row) => itemQuantities(row.delivery).entregasNaoRealizadas],
        ["coletas_realizadas", (row) => itemQuantities(row.delivery).coletasRealizadas],
        ["coletas_nao_realizadas", (row) => itemQuantities(row.delivery).coletasNaoRealizadas],
        ["otif_percentual", (row) => { const value = otifValue(row.delivery); return value === null ? "" : rateText(value); }],
        ["lancamento", (row) => row.launch.codigo_lancamento],
        ["status", (row) => statusLabels[row.launch.estado]],
        ["motivos_das_ocorrencias", (row) => reasonDescription(row.delivery)],
        ["observacoes_dos_motivos", (row) => reasonObservationDescription(row.delivery)],
        ["observacao_geral_legada", (row) => row.delivery.observacao ?? ""],
      ];
      const csvCell = (value: string | number) => {
        const text = String(value);
        const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safeText.replaceAll('"', '""')}"`;
      };
      const csv = [
        columns.map(([name]) => csvCell(name)).join(";"),
        ...exportRows.map((row) => columns.map(([, value]) => csvCell(value(row))).join(";")),
      ].join("\r\n");
      const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `historico-entregas-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (exportFailure) {
      setExportError(messageFromApiError(exportFailure));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={cx(styles, commonStyles, "portal-page", "page-stack")}>
      <div className={cx(styles, commonStyles, "page-heading-row history-heading-row")}>
        <div><h1>Histórico de entregas</h1><p className={cx(styles, commonStyles, "page-lead")}>Consulte, filtre e exporte os lançamentos.</p></div>
        <div className={cx(styles, commonStyles, "history-heading-actions")}>
          <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => void exportCsv()} disabled={exporting || loading}>{exporting ? "Preparando CSV..." : "Exportar CSV"}</button>
          {canCreate && <><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setImportOpen(true)}>Importar CSV</button><button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={() => onNavigate("/entregas")}><span aria-hidden="true">＋</span> Novo lançamento</button></>}
        </div>
      </div>

      {notice && <div className={cx(styles, commonStyles, "notice notice-success")} role="status"><span aria-hidden="true">✓</span>{notice}<button type="button" aria-label="Dispensar mensagem" onClick={() => setNotice("")}>×</button></div>}
      {exportError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">Não foi possível exportar o histórico: {exportError}<button type="button" aria-label="Dispensar erro" onClick={() => setExportError("")}>×</button></div>}

      <section className={cx(styles, commonStyles, "history-card")}>
        <div className={cx(styles, commonStyles, "history-toolbar")}>
          <div className={cx(styles, commonStyles, "history-toolbar-heading")}><h2>Lançamentos</h2><span>{total} {total === 1 ? "lançamento" : "lançamentos"}</span></div>
          <div className={cx(styles, commonStyles, "history-filters")}>
            <label className={cx(styles, commonStyles, "filter-control")}><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value as DeliveryStatus | "TODOS" | "LANÇADO"); setOffset(0); }}><option value="TODOS">Todos</option><option value="LANÇADO">Lançado</option><option value="CANCELADA">Cancelado</option></select></label>
            <button className={cx(styles, commonStyles, "button button-secondary filter-toggle")} type="button" aria-expanded={advancedFiltersOpen} aria-controls="history-advanced-filters" onClick={() => setAdvancedFiltersOpen((open) => !open)}>
              Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}<span aria-hidden="true">{advancedFiltersOpen ? "−" : "+"}</span>
            </button>
          </div>
        </div>

        {advancedFiltersOpen && <div className={cx(styles, commonStyles, "advanced-filters")} id="history-advanced-filters">
          <label className={cx(styles, commonStyles, "filter-control")}><span>Loja / localidade</span><select value={localityId} disabled={localitiesLoading || Boolean(localitiesError)} onChange={(event) => { setLocalityId(event.target.value); setOffset(0); }}><option value="">Todas as localidades ativas</option>{localities.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}</select>{localitiesError && <small className={cx(styles, commonStyles, "field-hint")}>Filtro indisponível: {localitiesError}</small>}</label>
          <label className={cx(styles, commonStyles, "filter-control")}><span>Equipe (motorista)</span><select value={driverId} disabled={filterCatalogsLoading || Boolean(filterCatalogsError)} onChange={(event) => { setDriverId(event.target.value); setOffset(0); }}><option value="">Todas</option>{drivers.map((driver) => <option key={driver.id_pessoa} value={driver.id_pessoa}>{driver.nome_exibicao}</option>)}</select>{filterCatalogsError && <small className={cx(styles, commonStyles, "field-hint")}>Filtros de equipe e motivo indisponíveis: {filterCatalogsError}</small>}</label>
          <label className={cx(styles, commonStyles, "filter-control")}><span>Motivo</span><select value={reasonId} disabled={filterCatalogsLoading || Boolean(filterCatalogsError)} onChange={(event) => { setReasonId(event.target.value); setOffset(0); }}><option value="">Todos</option>{reasons.map((reason) => <option key={reason.id_motivo_nao_entrega} value={reason.id_motivo_nao_entrega}>{reason.descricao_motivo}</option>)}</select></label>
          <label className={cx(styles, commonStyles, "filter-control")}><span>Operação</span><select value={operation} onChange={(event) => { setOperation(event.target.value as "" | "ENTREGA" | "COLETA"); setOffset(0); }}><option value="">Todas</option><option value="ENTREGA">Entrega</option><option value="COLETA">Coleta</option></select></label>
          <label className={cx(styles, commonStyles, "filter-control")}><span>Autor</span><select value={mineOnly ? "meus" : "todos"} onChange={(event) => { setMineOnly(event.target.value === "meus"); setOffset(0); }}><option value="todos">Todos</option><option value="meus">Meus lançamentos</option></select></label>
          <label className={cx(styles, commonStyles, "filter-control")}><span>Data inicial</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setOffset(0); }} /></label>
          <label className={cx(styles, commonStyles, "filter-control")}><span>Data final</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setOffset(0); }} /></label>
          {activeFilterCount > 0 && <button className={cx(styles, commonStyles, "clear-filters")} type="button" onClick={() => { setLocalityId(""); setDriverId(""); setReasonId(""); setOperation(""); setMineOnly(false); setFromDate(""); setToDate(""); setOffset(0); }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6.5A6.5 6.5 0 1 1 3.6 11" /><path d="M4 3.8v3.5h3.5" /></svg><span>Limpar filtros</span></button>}
        </div>}

        <div className={cx(styles, commonStyles, "notice notice-info history-otif-note")} role="note">
          <span className={cx(styles, commonStyles, "otif-note-icon")} aria-hidden="true">i</span>
        <div><strong>OTIF:</strong> entregas e coletas não realizadas ÷ total registrado nas duas operações.</div>
        </div>

        {error && <div className={cx(styles, commonStyles, "notice notice-error history-error")} role="alert">{error}<button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => failedDetail ? void openDetail(failedDetail) : setReloadVersion((value) => value + 1)}>Tentar novamente</button></div>}
        {loading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando lançamentos...</div> : visibleRows.length === 0 ? (
          <div className={cx(styles, commonStyles, "history-empty")}><div className={cx(styles, commonStyles, "empty-state-icon")}>⌕</div><h3>Nenhum lançamento encontrado</h3><p>{canCreate ? "Ajuste os filtros ou crie um novo lançamento de Entregas." : "Ajuste os filtros para localizar outros lançamentos."}</p><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { setStatus("TODOS"); setLocalityId(""); setDriverId(""); setReasonId(""); setOperation(""); setMineOnly(false); setFromDate(""); setToDate(""); setOffset(0); }}>Limpar filtros</button></div>
        ) : (
          <div className={cx(styles, commonStyles, "data-table-scroll")} role="region" aria-label="Tabela do histórico de entregas" tabIndex={0}><table className={cx(styles, commonStyles, "data-table history-table")}><thead><tr><th>Data / operação</th><th>Loja</th><th>Equipe</th><th>Transporte</th><th>Entregas R/NR</th><th>Coletas R/NR</th><th><span title="Entregas e coletas não realizadas ÷ total registrado nas duas operações">OTIF</span></th><th>Motivos e observações</th><th>Ações</th></tr></thead><tbody>
          {visibleRows.map(({ launch, delivery }) => {
              const driver = delivery.participantes.find((person) => person.papel_participante === "MOTORISTA");
              const helpers = delivery.participantes.filter((person) => person.papel_participante === "AJUDANTE");
              const canEdit = canEditDraft && launch.estado === "RASCUNHO";
              const canCorrectLaunch = canCorrect && (launch.estado === "ENVIADA" || launch.estado === "APROVADA");
              const canCancelLaunch = canCancel && ((launch.estado === "ENVIADA" || launch.estado === "APROVADA") || (launch.estado === "RASCUNHO" && launch.numero_revisao > 1));
              return <tr key={`${launch.codigo_lancamento}-${delivery.codigo_item_lancamento}`}>
                <td><div className={cx(styles, commonStyles, "history-date-operation")}><strong>{formatDate(delivery.data_entrega)}</strong><span className={cx(styles, commonStyles, "history-operation-badge")}>{operationName(delivery)}</span></div></td>
                <td><strong>{delivery.nome_localidade}</strong><small>{launch.nome_setor}</small></td>
                <td><div className={cx(styles, commonStyles, "history-team-cell")}>
                  <span><b>Motorista</b>{driver?.nome_exibicao ?? "Não informado"}</span>
                  <span><b>Ajudantes</b>{helpers.length ? helpers.map((person) => person.nome_exibicao).join(", ") : "Nenhum"}</span>
                </div></td>
                <td className={cx(styles, commonStyles, "history-transport-cell")}><span className={cx(styles, commonStyles, "history-transport-badge")}>{deliveryTypeDescription(delivery)}</span></td>
                <td className={cx(styles, commonStyles, "history-metric-cell")}>{(() => { const q = itemQuantities(delivery); return <span className={cx(styles, commonStyles, "history-dual-counts")}><b className={cx(styles, commonStyles, "table-count count-positive")}>{q.entregasRealizadas}</b> / <b className={cx(styles, commonStyles, `table-count${q.entregasNaoRealizadas > 0 ? " count-muted" : ""}`)}>{q.entregasNaoRealizadas}</b></span>; })()}</td>
                <td className={cx(styles, commonStyles, "history-metric-cell")}>{(() => { const q = itemQuantities(delivery); return <span className={cx(styles, commonStyles, "history-dual-counts")}><b className={cx(styles, commonStyles, "table-count count-positive")}>{q.coletasRealizadas}</b> / <b className={cx(styles, commonStyles, `table-count${q.coletasNaoRealizadas > 0 ? " count-muted" : ""}`)}>{q.coletasNaoRealizadas}</b></span>; })()}</td>
                <td className={cx(styles, commonStyles, "history-metric-cell")}>{(() => { const otif = otifValue(delivery); return otif === null
                  ? <span className={cx(styles, commonStyles, "history-muted-cell")}>—</span>
                  : <span className={cx(styles, commonStyles, "history-otif-values")}>{rateText(otif)}</span>; })()}</td>
                <td><HistoryReasonCell reasons={delivery.motivos} /></td>
                <td><div className={cx(styles, commonStyles, "history-row-actions")}>
                  <span className={cx(styles, commonStyles, "history-main-actions")}>
                  <button className={cx(styles, commonStyles, "table-action")} type="button" onClick={() => void openDetail(launch)} disabled={detailLoading || discardingId === launch.codigo_lancamento}>{detailLoading ? "Abrindo..." : "Detalhes"}</button>
                  {(canEdit || canCorrectLaunch) && <button className={cx(styles, commonStyles, "table-action")} type="button" disabled={discardingId === launch.codigo_lancamento} onClick={() => canEdit ? onNavigate(`/entregas/${launch.codigo_lancamento}`) : void startCorrection(launch)}>Editar</button>}
                  {canCancelLaunch && <button className={cx(styles, commonStyles, "table-action table-action-danger")} type="button" disabled={discardingId === launch.codigo_lancamento} onClick={() => void cancelConfirmed(launch)}>Cancelar</button>}
                  </span>
                  {canEdit && <button className={cx(styles, commonStyles, "table-action table-action-danger history-delete-action")} type="button" disabled={discardingId === launch.codigo_lancamento} onClick={() => void discardDraft(launch)}>{discardingId === launch.codigo_lancamento ? "Excluindo..." : "Excluir rascunho"}</button>}
                </div></td>
              </tr>;
            })}
          </tbody></table></div>
        )}
        <div className={cx(styles, commonStyles, "table-footer")}>
          <span>{pageDeliveryCount} registros com entregas e coletas em {items.length} lançamentos nesta página · {total} lançamentos no histórico</span>
          <label className={cx(styles, commonStyles, "page-size-control")}><span>Lançamentos</span><select aria-label="Lançamentos por página" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setOffset(0); }}>{pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <div className={cx(styles, commonStyles, "pagination-controls")} role="group" aria-label="Paginação do histórico"><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={loading || offset + items.length >= total} onClick={() => setOffset((value) => value + pageSize)}>Próxima</button></div>
          <span className={cx(styles, commonStyles, "table-footer-note")}>A lista respeita seu escopo de acesso.</span>
        </div>
      </section>
      {selected && <DetailDialog detail={selected} events={selectedEvents} onClose={() => setSelected(null)} onEdit={canEditDraft && selected.estado === "RASCUNHO" ? () => onNavigate(`/entregas/${selected.codigo_lancamento}`) : undefined} onCorrect={canCorrect && (selected.estado === "ENVIADA" || selected.estado === "APROVADA") ? () => void startCorrection(selected) : undefined} onCancel={canCancel && ((selected.estado === "ENVIADA" || selected.estado === "APROVADA") || (selected.estado === "RASCUNHO" && selected.numero_revisao > 1)) ? () => void cancelConfirmed(selected) : undefined} />}
      {importOpen && <DeliveryCsvImportDialog onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); setNotice("CSV importado como rascunho. O registro já aparece no histórico."); setOffset(0); setStatus("TODOS"); setLocalityId(""); setDriverId(""); setReasonId(""); setOperation(""); setMineOnly(false); setFromDate(""); setToDate(""); setReloadVersion((value) => value + 1); }} />}
    </div>
  );
}
