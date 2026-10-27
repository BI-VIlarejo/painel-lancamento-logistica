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
import type { DeliveryEvent, DeliveryHistoryFilters, DeliveryItemResponse, DeliveryLaunchDetail, DeliveryLaunchSummary, DeliveryStatus, LocalityCatalogItem } from "../types";

type DeliveryHistoryPageProps = { onNavigate: (path: string) => void; canCreate: boolean; canEditDraft: boolean; canCorrect: boolean; canCancel: boolean; currentUserId: number };
const pageSize = 25;
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
  const total = item.quantidade_realizada + item.quantidade_nao_realizada;
  if (!total) return null;
  return (item.quantidade_nao_realizada / total) * 100;
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
    ? item.motivos.map((reason) => `${reason.descricao_motivo} [${nonDeliveryReasonGroupLabel(reason.grupo_motivo)}]`).join("; ")
    : "Sem ocorrências";
}

function operationName(item: DeliveryItemResponse): string {
  return item.tipo_operacao === "COLETA" ? "Coleta" : "Entrega";
}

function reasonObservationDescription(item: DeliveryItemResponse): string {
  return item.motivos
    .flatMap((reason) => {
      const observation = reason.observacao?.trim();
      return observation ? [`${reason.descricao_motivo}: ${observation}`] : [];
    })
    .join("; ");
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
        <div className={cx(styles, commonStyles, "dialog-meta")}><span className={cx(styles, commonStyles, statusClass(detail.estado))}><i />{statusLabels[detail.estado]}</span><span>Criado em {formatDateTime(detail.criado_em)}</span></div>
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
              <div className={cx(styles, commonStyles, "detail-item-heading")}><span className={cx(styles, commonStyles, "delivery-index")}>{String(index + 1).padStart(2, "0")}</span><div><strong>{operationName(item)} · {item.nome_localidade}</strong><small>{formatDate(item.data_entrega)}</small></div></div>
              <div className={cx(styles, commonStyles, "detail-metrics")}><div><strong>{item.quantidade_realizada}</strong><span>{item.tipo_operacao === "COLETA" ? "coletas realizadas" : "entregas realizadas"}</span></div><div><strong>{item.quantidade_nao_realizada}</strong><span>{item.tipo_operacao === "COLETA" ? "coletas não realizadas" : "entregas não realizadas"}</span></div></div>
              {(() => { const otif = otifValue(item); const total = item.quantidade_realizada + item.quantidade_nao_realizada; return <div className={cx(styles, commonStyles, "detail-otif")}><strong>OTIF</strong>{otif === null ? <span>Sem entregas registradas para calcular</span> : <span>{rateText(otif)} · {item.quantidade_nao_realizada.toLocaleString("pt-BR")} não realizadas de {total.toLocaleString("pt-BR")}</span>}</div>; })()}
              <div className={cx(styles, commonStyles, "detail-team")}><span>Equipe · {deliveryTypeDescription(item)}</span>{item.participantes.map((person) => <span className={cx(styles, commonStyles, "team-chip")} key={`${person.id_pessoa}-${person.papel_participante}`}>{person.nome_exibicao}<small>{person.papel_participante === "MOTORISTA" ? "Motorista" : "Ajudante"} · {deliveryTransportLabel(person.tipo_transporte_entrega)}</small></span>)}</div>
              {item.motivos.length > 0 && <div className={cx(styles, commonStyles, "detail-reasons")}><span>Motivos e observações, um por item não realizado</span>{item.motivos.map((reason, reasonIndex) => <div className={cx(styles, commonStyles, "detail-reason")} key={`${reason.id_motivo_nao_entrega}-${reasonIndex}`}><span>{reason.descricao_motivo} · {nonDeliveryReasonGroupLabel(reason.grupo_motivo)}</span>{reason.observacao && <small>Observação: {reason.observacao}</small>}</div>)}</div>}
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
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<DeliveryStatus | "TODOS">("TODOS");
  const [localityId, setLocalityId] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [offset, setOffset] = useState(0);
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
    setLoading(true);
    setError("");
    setFailedDetail(null);
    void deliveriesApi.list({ estado: status, id_localidade: localityId ? Number(localityId) : undefined, criado_por: mineOnly ? currentUserId : undefined, data_de: fromDate || undefined, data_ate: toDate || undefined, limit: pageSize, offset })
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
  }, [status, localityId, mineOnly, currentUserId, fromDate, toDate, offset, reloadVersion]);

  const activeFilterCount = [localityId, mineOnly, fromDate, toDate].filter(Boolean).length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;
  const pageDeliveryCount = items.reduce((sum, launch) => sum + launch.itens.length, 0);

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
      const exportRows: ExportRow[] = allItems.flatMap((launch) => launch.itens.map((delivery) => ({ launch, delivery })));
      const columns: Array<[string, (row: ExportRow) => string | number]> = [
        ["data", (row) => row.delivery.data_entrega],
        ["loja", (row) => row.delivery.nome_localidade],
        ["equipe", (row) => teamDescription(row.delivery)],
        ["operacao", (row) => operationName(row.delivery)],
        ["tipo_transporte", (row) => deliveryTypeDescription(row.delivery)],
        ["realizadas", (row) => row.delivery.quantidade_realizada],
        ["nao_realizadas", (row) => row.delivery.quantidade_nao_realizada],
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
    <div className={cx(styles, commonStyles, "page-stack")}>
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
            <label className={cx(styles, commonStyles, "filter-control")}><span>Status</span><select value={status} onChange={(event) => { setStatus(event.target.value as DeliveryStatus | "TODOS"); setOffset(0); }}><option value="TODOS">Todos os status</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <button className={cx(styles, commonStyles, "button button-secondary filter-toggle")} type="button" aria-expanded={advancedFiltersOpen} aria-controls="history-advanced-filters" onClick={() => setAdvancedFiltersOpen((open) => !open)}>
              Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}<span aria-hidden="true">{advancedFiltersOpen ? "−" : "+"}</span>
            </button>
          </div>
        </div>

        {advancedFiltersOpen && <div className={cx(styles, commonStyles, "advanced-filters")} id="history-advanced-filters">
          <label className={cx(styles, commonStyles, "filter-control")}><span>Loja / localidade</span><select value={localityId} disabled={localitiesLoading || Boolean(localitiesError)} onChange={(event) => { setLocalityId(event.target.value); setOffset(0); }}><option value="">Todas</option>{localities.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}</select>{localitiesError && <small className={cx(styles, commonStyles, "field-hint")}>Filtro indisponível: {localitiesError}</small>}</label>
          <label className={cx(styles, commonStyles, "filter-control")}><span>Autor</span><select value={mineOnly ? "meus" : "todos"} onChange={(event) => { setMineOnly(event.target.value === "meus"); setOffset(0); }}><option value="todos">Todos</option><option value="meus">Meus lançamentos</option></select></label>
          <label className={cx(styles, commonStyles, "filter-control")}><span>Data inicial</span><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setOffset(0); }} /></label>
          <label className={cx(styles, commonStyles, "filter-control")}><span>Data final</span><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setOffset(0); }} /></label>
          {activeFilterCount > 0 && <button className={cx(styles, commonStyles, "text-button clear-filters")} type="button" onClick={() => { setLocalityId(""); setMineOnly(false); setFromDate(""); setToDate(""); setOffset(0); }}>Limpar filtros</button>}
        </div>}

        <div className={cx(styles, commonStyles, "notice notice-info history-otif-note")} role="note">
          <span className={cx(styles, commonStyles, "otif-note-icon")} aria-hidden="true">i</span>
        <div><strong>OTIF:</strong> entregas e coletas não realizadas ÷ total registrado nas duas operações.</div>
        </div>

        {error && <div className={cx(styles, commonStyles, "notice notice-error history-error")} role="alert">{error}<button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => failedDetail ? void openDetail(failedDetail) : setReloadVersion((value) => value + 1)}>Tentar novamente</button></div>}
        {loading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando lançamentos...</div> : items.length === 0 ? (
          <div className={cx(styles, commonStyles, "history-empty")}><div className={cx(styles, commonStyles, "empty-state-icon")}>⌕</div><h3>Nenhum lançamento encontrado</h3><p>{canCreate ? "Ajuste os filtros ou crie um novo lançamento de Entregas." : "Ajuste os filtros para localizar outros lançamentos."}</p><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => { setStatus("TODOS"); setLocalityId(""); setMineOnly(false); setFromDate(""); setToDate(""); setOffset(0); }}>Limpar filtros</button></div>
        ) : (
          <div className={cx(styles, commonStyles, "table-scroll")}><table className={cx(styles, commonStyles, "history-table")}><thead><tr><th>Data</th><th>Operação</th><th>Loja</th><th>Equipe</th><th>Realizadas</th><th>Não realizadas</th><th><span title="Não realizadas ÷ total registrado nesta operação">OTIF</span></th><th>Lançamento</th><th>Motivos e observações</th><th>Observação geral (legado)</th><th>Ações</th></tr></thead><tbody>
          {items.flatMap((launch) => launch.itens.map((delivery) => {
              const driver = delivery.participantes.find((person) => person.papel_participante === "MOTORISTA");
              const helpers = delivery.participantes.filter((person) => person.papel_participante === "AJUDANTE");
              const canEdit = canEditDraft && launch.estado === "RASCUNHO";
              return <tr key={`${launch.codigo_lancamento}-${delivery.codigo_item_lancamento}`}>
                <td><strong>{formatDate(delivery.data_entrega)}</strong></td>
                <td>{operationName(delivery)}</td>
                <td><strong>{delivery.nome_localidade}</strong><small>{launch.nome_setor}</small></td>
                <td><div className={cx(styles, commonStyles, "history-team-cell")}>
                  <span><b>Motorista</b>{driver?.nome_exibicao ?? "Não informado"}</span>
                  <span><b>Ajudantes</b>{helpers.length ? helpers.map((person) => person.nome_exibicao).join(", ") : "Nenhum"}</span>
                  <span><b>Tipo do transporte</b>{deliveryTypeDescription(delivery)}</span>
                </div></td>
                <td><span className={cx(styles, commonStyles, "table-count count-positive")}>{delivery.quantidade_realizada}</span></td>
                <td><span className={cx(styles, commonStyles, `table-count${delivery.quantidade_nao_realizada > 0 ? " count-muted" : ""}`)}>{delivery.quantidade_nao_realizada}</span></td>
                <td>{(() => { const otif = otifValue(delivery); return otif === null
                  ? <span className={cx(styles, commonStyles, "history-muted-cell")}>—</span>
                  : <span className={cx(styles, commonStyles, "history-otif-values")}>{rateText(otif)}</span>; })()}</td>
                <td><div className={cx(styles, commonStyles, "history-launch-cell")}><strong title={launch.codigo_lancamento}>{launch.codigo_lancamento.slice(0, 8).toUpperCase()}</strong><span className={cx(styles, commonStyles, statusClass(launch.estado))}><i />{statusLabels[launch.estado]}</span><small>Versão {launch.numero_revisao}</small></div></td>
                <td>{delivery.motivos.length ? <ul className={cx(styles, commonStyles, "history-reasons")}>{delivery.motivos.map((reason, reasonIndex) => <li key={`${reason.id_motivo_nao_entrega}-${reasonIndex}`}>{reason.descricao_motivo} · {nonDeliveryReasonGroupLabel(reason.grupo_motivo)}{reason.observacao && <small>Observação: {reason.observacao}</small>}</li>)}</ul> : <span className={cx(styles, commonStyles, "history-muted-cell")}>Sem ocorrências</span>}</td>
                <td><span className={cx(styles, commonStyles, "history-observation")}>{delivery.observacao || "Sem observações"}</span></td>
                <td><div className={cx(styles, commonStyles, "history-row-actions")}>
                  <button className={cx(styles, commonStyles, "table-action")} type="button" onClick={() => void openDetail(launch)} disabled={detailLoading || discardingId === launch.codigo_lancamento}>{detailLoading ? "Abrindo..." : "Detalhes"}</button>
                  {canEdit && <button className={cx(styles, commonStyles, "table-action")} type="button" disabled={discardingId === launch.codigo_lancamento} onClick={() => onNavigate(`/entregas/${launch.codigo_lancamento}`)}>Editar lançamento</button>}
                  {canEdit && <button className={cx(styles, commonStyles, "table-action table-action-danger")} type="button" disabled={discardingId === launch.codigo_lancamento} onClick={() => void discardDraft(launch)}>{discardingId === launch.codigo_lancamento ? "Excluindo..." : "Excluir rascunho"}</button>}
                  {canCorrect && (launch.estado === "ENVIADA" || launch.estado === "APROVADA") && <button className={cx(styles, commonStyles, "table-action")} type="button" disabled={discardingId === launch.codigo_lancamento} onClick={() => void startCorrection(launch)}>Editar lançamento</button>}
                  {canCancel && ((launch.estado === "ENVIADA" || launch.estado === "APROVADA") || (launch.estado === "RASCUNHO" && launch.numero_revisao > 1)) && <button className={cx(styles, commonStyles, "table-action table-action-danger")} type="button" disabled={discardingId === launch.codigo_lancamento} onClick={() => void cancelConfirmed(launch)}>Cancelar lançamento</button>}
                </div></td>
              </tr>;
            }))}
          </tbody></table></div>
        )}
        <div className={cx(styles, commonStyles, "table-footer")}><span>{pageDeliveryCount} entregas em {items.length} lançamentos nesta página · {total} lançamentos no histórico</span><div className={cx(styles, commonStyles, "pagination-controls")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={loading || offset + items.length >= total} onClick={() => setOffset((value) => value + pageSize)}>Próxima</button></div><span className={cx(styles, commonStyles, "table-footer-note")}>A lista respeita seu escopo de acesso.</span></div>
      </section>
      {selected && <DetailDialog detail={selected} events={selectedEvents} onClose={() => setSelected(null)} onEdit={canEditDraft && selected.estado === "RASCUNHO" ? () => onNavigate(`/entregas/${selected.codigo_lancamento}`) : undefined} onCorrect={canCorrect && (selected.estado === "ENVIADA" || selected.estado === "APROVADA") ? () => void startCorrection(selected) : undefined} onCancel={canCancel && ((selected.estado === "ENVIADA" || selected.estado === "APROVADA") || (selected.estado === "RASCUNHO" && selected.numero_revisao > 1)) ? () => void cancelConfirmed(selected) : undefined} />}
      {importOpen && <DeliveryCsvImportDialog onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); setNotice("CSV importado como rascunho. O registro já aparece no histórico."); setOffset(0); setStatus("TODOS"); setLocalityId(""); setMineOnly(false); setFromDate(""); setToDate(""); setReloadVersion((value) => value + 1); }} />}
    </div>
  );
}
