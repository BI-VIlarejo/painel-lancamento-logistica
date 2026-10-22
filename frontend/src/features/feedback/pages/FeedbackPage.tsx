import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import styles from "./FeedbackPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { isDemoMode } from "../../../shared/api/apiClient";
import { messageFromApiError } from "../../../shared/api/apiError";
import { feedbackApi } from "../api";
import { FeedbackCsvImportDialog } from "../components/FeedbackCsvImportDialog";
import type {
  FeedbackCreateInput,
  FeedbackDeliveryItem,
  FeedbackItem,
  FeedbackLocality,
  FeedbackListFilters,
  FeedbackParticipant,
  FeedbackParticipantInput,
  FeedbackType,
} from "../types";

type Props = { permissions: string[] };
type FormState = {
  data_feedback: string;
  tipo: FeedbackType | "";
  nome_cliente: string;
  id_localidade: string;
  data_entrega: string;
  id_motorista: string;
  id_ajudante_1: string;
  id_ajudante_2: string;
  codigo_item_lancamento: string;
  relato: string;
};

const pageSize = 25;

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const emptyForm = (): FormState => ({
  data_feedback: today(),
  tipo: "",
  nome_cliente: "",
  id_localidade: "",
  data_entrega: "",
  id_motorista: "",
  id_ajudante_1: "",
  id_ajudante_2: "",
  codigo_item_lancamento: "",
  relato: "",
});

const dateLabel = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
};

const typeLabel = (type: FeedbackType) => type === "ELOGIO" ? "Elogio" : "Reclamação";
const teamLabel = (item: FeedbackItem | FeedbackDeliveryItem) => item.participantes
  .map((person) => `${person.nome_exibicao} · ${person.papel_participante === "MOTORISTA" ? "Motorista" : "Ajudante"}`)
  .join(", ");

function participantsForTeam(driverId: string, helperOneId: string, helperTwoId: string): FeedbackParticipantInput[] {
  const participants: FeedbackParticipantInput[] = [];
  if (driverId) {
    participants.push({ id_pessoa: Number(driverId), papel_participante: "MOTORISTA" });
  }
  if (helperOneId) {
    participants.push({ id_pessoa: Number(helperOneId), papel_participante: "AJUDANTE" });
  }
  if (helperTwoId) {
    participants.push({ id_pessoa: Number(helperTwoId), papel_participante: "AJUDANTE" });
  }
  return participants;
}

function deliveryMatchesTeam(item: FeedbackDeliveryItem, participants: FeedbackParticipantInput[]): boolean {
  if (!participants.length) return false;
  const selected = participants.map((person) => `${person.id_pessoa}:${person.papel_participante}`).sort();
  const actual = item.participantes.map((person) => `${person.id_pessoa}:${person.papel_participante}`).sort();
  return selected.length === actual.length && selected.every((person, index) => person === actual[index]);
}

function saveBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reclamacoes-elogios-${today()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function FeedbackTypeBadge({ type }: { type: FeedbackType }) {
  return <span className={cx(styles, commonStyles, `feedback-type feedback-type-${type.toLowerCase()}`)}>
    <i aria-hidden="true" />{typeLabel(type)}
  </span>;
}

function FeedbackDetails({ item, onClose }: { item: FeedbackItem; onClose: () => void }) {
  return <div
    className={cx(styles, commonStyles, "dialog-backdrop")}
    role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <section className={cx(styles, commonStyles, "feedback-detail-dialog")} role="dialog" aria-modal="true" aria-labelledby="feedback-detail-title">
      <div className={cx(styles, commonStyles, "detail-heading")}>
        <div><p className={cx(styles, commonStyles, "feedback-eyebrow")}>REGISTRO DE CLIENTE</p><h2 id="feedback-detail-title">Detalhes da manifestação</h2></div>
        <button className={cx(styles, commonStyles, "icon-button")} type="button" aria-label="Fechar detalhes" onClick={onClose}>×</button>
      </div>
      <div className={cx(styles, commonStyles, "detail-content")}>
        <div className={cx(styles, commonStyles, "detail-summary")}>
          <FeedbackTypeBadge type={item.tipo} /><span>{dateLabel(item.data_feedback)}</span><strong>{item.nome_localidade}</strong>
        </div>
        <dl className={cx(styles, commonStyles, "detail-facts")}>
          <div><dt>Cliente</dt><dd>{item.nome_cliente || "Não informado"}</dd></div>
          <div><dt>Entrega relacionada</dt><dd>{dateLabel(item.data_entrega)}</dd></div>
          <div><dt>Equipe relacionada</dt><dd>{teamLabel(item) || "Não informada"}</dd></div>
        </dl>
        <div className={cx(styles, commonStyles, "detail-report")}><span>Relato</span><p>{item.relato}</p></div>
      </div>
      <div className={cx(styles, commonStyles, "detail-footer")}>
        <span>Registrado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.criado_em))}</span>
        <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={onClose}>Fechar</button>
      </div>
    </section>
  </div>;
}

export function FeedbackPage({ permissions }: Props) {
  const canView = permissions.includes("FEEDBACK_CLIENTES:VER");
  const canCreate = permissions.includes("FEEDBACK_CLIENTES:CRIAR");
  const canExport = permissions.includes("FEEDBACK_CLIENTES:EXPORTAR");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [localities, setLocalities] = useState<FeedbackLocality[]>([]);
  const [deliveryItems, setDeliveryItems] = useState<FeedbackDeliveryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(canView);
  const [catalogsLoading, setCatalogsLoading] = useState(canCreate || canView);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [deliveryError, setDeliveryError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [offset, setOffset] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detail, setDetail] = useState<FeedbackItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const feedbackIdempotencyKey = useRef<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FeedbackType | "TODOS">("TODOS");
  const [localityFilter, setLocalityFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const availablePeople = useMemo(() => {
    const drivers = new Map<number, FeedbackParticipant>();
    const helpers = new Map<number, FeedbackParticipant>();
    for (const item of deliveryItems) {
      for (const participant of item.participantes) {
        if (participant.papel_participante === "MOTORISTA") drivers.set(participant.id_pessoa, participant);
        else helpers.set(participant.id_pessoa, participant);
      }
    }
    return { drivers: Array.from(drivers.values()), helpers: Array.from(helpers.values()) };
  }, [deliveryItems]);
  const { drivers, helpers } = availablePeople;
  const selectedTeam = useMemo(
    () => participantsForTeam(form.id_motorista, form.id_ajudante_1, form.id_ajudante_2),
    [form.id_motorista, form.id_ajudante_1, form.id_ajudante_2],
  );
  const matchingDeliveryItems = useMemo(
    () => deliveryItems.filter((item) => deliveryMatchesTeam(item, selectedTeam)),
    [deliveryItems, selectedTeam],
  );
  const selectedDelivery = matchingDeliveryItems.find((item) => item.codigo_item_lancamento === form.codigo_item_lancamento);
  const listFilters: FeedbackListFilters = {
    q: search.trim() || undefined,
    tipo: typeFilter,
    id_localidade: localityFilter ? Number(localityFilter) : undefined,
    data_de: fromDate || undefined,
    data_ate: toDate || undefined,
    limit: pageSize,
    offset,
  };
  const currentPage = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const complaintCount = items.filter((item) => item.tipo === "RECLAMACAO").length;
  const praiseCount = items.length - complaintCount;
  const firstResult = total ? offset + 1 : 0;
  const lastResult = Math.min(offset + items.length, total);

  useEffect(() => {
    if (!canCreate && !canView) {
      setCatalogsLoading(false);
      return;
    }
    let active = true;
    setCatalogsLoading(true);
    void feedbackApi.localities()
      .then((items) => { if (active) setLocalities(items); })
      .catch((loadError: unknown) => { if (active) setCatalogError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setCatalogsLoading(false); });
    return () => { active = false; };
  }, [canCreate, canView]);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void feedbackApi.list(listFilters)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((loadError: unknown) => { if (active) setError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canView, fromDate, localityFilter, offset, reloadVersion, search, toDate, typeFilter]);

  useEffect(() => {
    if (!formOpen || !form.id_localidade || !form.data_entrega) {
      setDeliveryItems([]);
      setDeliveryError("");
      setDeliveriesLoading(false);
      return;
    }
    let active = true;
    setDeliveriesLoading(true);
    setDeliveryError("");
    setDeliveryItems([]);
    setForm((current) => ({
      ...current,
      id_motorista: "",
      id_ajudante_1: "",
      id_ajudante_2: "",
      codigo_item_lancamento: "",
    }));
    void feedbackApi.deliveryItems(form.data_entrega, Number(form.id_localidade))
      .then((options) => { if (active) setDeliveryItems(options); })
      .catch((loadError: unknown) => { if (active) setDeliveryError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setDeliveriesLoading(false); });
    return () => { active = false; };
  }, [form.data_entrega, form.id_localidade, formOpen]);

  const resetOffset = () => setOffset(0);
  const startCreate = () => {
    feedbackIdempotencyKey.current = crypto.randomUUID();
    setForm(emptyForm());
    setDeliveryItems([]);
    setDeliveryError("");
    setError("");
    setNotice("");
    setFormOpen(true);
  };

  const saveFeedback = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.tipo || !form.id_localidade || !form.data_entrega) {
      setError("Selecione o tipo, a loja e a data da entrega relacionada.");
      return;
    }
    if (!form.id_motorista) {
      setError("Selecione o motorista.");
      return;
    }
    if (form.id_ajudante_1 && form.id_ajudante_1 === form.id_ajudante_2) {
      setError("Selecione pessoas diferentes nos campos de ajudante.");
      return;
    }
    if (!selectedDelivery) {
      setError("Selecione uma entrega confirmada que corresponda à equipe informada.");
      return;
    }
    if (form.data_feedback < form.data_entrega) {
      setError("A data da manifestação não pode anteceder a data da entrega.");
      return;
    }
    if (!form.nome_cliente.trim()) {
      setError("Informe o nome do cliente.");
      return;
    }
    const payload: FeedbackCreateInput = {
      data_feedback: form.data_feedback,
      tipo: form.tipo,
      nome_cliente: form.nome_cliente.trim(),
      codigo_lancamento: selectedDelivery.codigo_lancamento,
      codigo_revisao: selectedDelivery.codigo_revisao,
      codigo_item_lancamento: selectedDelivery.codigo_item_lancamento,
      participantes: selectedTeam,
      relato: form.relato.trim(),
    };
    const idempotencyKey = feedbackIdempotencyKey.current ?? crypto.randomUUID();
    feedbackIdempotencyKey.current = idempotencyKey;
    setSaving(true);
    setError("");
    void feedbackApi.create(payload, idempotencyKey)
      .then((created) => {
        setNotice(`${typeLabel(created.tipo)} registrada com sucesso.`);
        setFormOpen(false);
        setForm(emptyForm());
        if (canView) {
          setOffset(0);
          setReloadVersion((version) => version + 1);
        }
      })
      .catch((saveError: unknown) => setError(messageFromApiError(saveError)))
      .finally(() => setSaving(false));
  };

  const exportFiltered = () => {
    setExporting(true);
    setError("");
    void feedbackApi.export({ ...listFilters, limit: undefined, offset: undefined })
      .then(saveBlob)
      .catch((exportError: unknown) => setError(messageFromApiError(exportError)))
      .finally(() => setExporting(false));
  };

  const onFilterChange = (action: () => void) => {
    action();
    resetOffset();
  };

  return <div className={cx(styles, commonStyles, "feedback-page")}>
    <header className={cx(styles, commonStyles, "feedback-heading")}>
      <div>
        <p className={cx(styles, commonStyles, "feedback-eyebrow")}>EXPERIÊNCIA DO CLIENTE</p>
        <h1>Reclamações e elogios</h1>
        <p className={cx(styles, commonStyles, "feedback-lead")}>Registre manifestações vinculadas a uma entrega confirmada e consulte o histórico por loja e equipe.</p>
      </div>
      <div className={cx(styles, commonStyles, "heading-actions")}>
        {isDemoMode && <span className={cx(styles, commonStyles, "preview-label")}><i /> Prévia interativa</span>}
        {canExport && canView && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={!total || exporting} onClick={exportFiltered}>{exporting ? "Preparando CSV..." : <><span className={cx(styles, "heading-action-icon")} aria-hidden="true">↓</span> Exportar CSV</>}</button>}
        {canCreate && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setImportOpen(true)}><span className={cx(styles, "heading-action-icon")} aria-hidden="true">↑</span> Importar CSV</button>}
        {canCreate && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={startCreate}><span className={cx(styles, "heading-action-icon")} aria-hidden="true">+</span> Registrar manifestação</button>}
      </div>
    </header>

    {error && !formOpen && <div className={cx(styles, commonStyles, "notice notice-error page-notice")} role="alert">{error}{canView && <button type="button" onClick={() => setReloadVersion((version) => version + 1)}>Tentar novamente</button>}</div>}
    {notice && <div className={cx(styles, commonStyles, "notice notice-success page-notice")} role="status"><span>✓</span>{notice}<button type="button" aria-label="Fechar mensagem" onClick={() => setNotice("")}>×</button></div>}
    {catalogError && <div className={cx(styles, commonStyles, "notice notice-error page-notice")} role="alert">Não foi possível carregar os cadastros necessários para o formulário. {catalogError}</div>}

    {canView && <>
      <section className={cx(styles, commonStyles, "feedback-summary")} aria-label="Resumo de manifestações">
        <article className={cx(styles, commonStyles, "summary-card")}><span className={cx(styles, commonStyles, "summary-mark")}>Σ</span><div><span>Resultados com filtros</span><strong>{loading ? "—" : total}</strong></div></article>
        <article className={cx(styles, commonStyles, "summary-card")}><span className={cx(styles, commonStyles, "summary-mark summary-mark-complaint")}>!</span><div><span>Reclamações nesta página</span><strong>{loading ? "—" : complaintCount}</strong></div></article>
        <article className={cx(styles, commonStyles, "summary-card")}><span className={cx(styles, commonStyles, "summary-mark summary-mark-praise")}>✦</span><div><span>Elogios nesta página</span><strong>{loading ? "—" : praiseCount}</strong></div></article>
      </section>

      <section className={cx(styles, commonStyles, "feedback-panel")}>
        <div className={cx(styles, commonStyles, "panel-heading")}><div><h2>Histórico de manifestações</h2><p>{loading ? "Carregando registros" : `${firstResult}–${lastResult} de ${total}`}</p></div></div>
        <div className={cx(styles, commonStyles, "feedback-filters")}>
          <label className={cx(styles, commonStyles, "search-field")}><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => onFilterChange(() => setSearch(event.target.value))} placeholder="Buscar cliente, loja, pessoa ou relato" aria-label="Buscar manifestações" /></label>
          <label className={cx(styles, commonStyles, "filter-control")}>Tipo<select value={typeFilter} onChange={(event) => onFilterChange(() => setTypeFilter(event.target.value as FeedbackType | "TODOS"))}><option value="TODOS">Todos</option><option value="RECLAMACAO">Reclamação</option><option value="ELOGIO">Elogio</option></select></label>
          <label className={cx(styles, commonStyles, "filter-control")}>Loja<select value={localityFilter} onChange={(event) => onFilterChange(() => setLocalityFilter(event.target.value))}><option value="">Todas</option>{localities.map((locality) => <option value={locality.id_localidade} key={locality.id_localidade}>{locality.nome_localidade}</option>)}</select></label>
          <label className={cx(styles, commonStyles, "filter-control")}>De<input type="date" max={toDate || undefined} value={fromDate} onChange={(event) => onFilterChange(() => setFromDate(event.target.value))} /></label>
          <label className={cx(styles, commonStyles, "filter-control")}>Até<input type="date" min={fromDate || undefined} value={toDate} onChange={(event) => onFilterChange(() => setToDate(event.target.value))} /></label>
        </div>
        {error && <div className={cx(styles, commonStyles, "notice notice-error page-notice")} role="alert">{error}</div>}
        {loading ? <div className={cx(styles, commonStyles, "feedback-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />Carregando manifestações...</div>
          : items.length ? <div className={cx(styles, commonStyles, "table-scroll")}><table className={cx(styles, commonStyles, "feedback-table")}><thead><tr><th>Data</th><th>Tipo</th><th>Cliente</th><th>Loja</th><th>Entrega</th><th>Equipe</th><th>Relato</th><th aria-label="Ações" /></tr></thead><tbody>
            {items.map((item) => <tr key={item.id_feedback}>
              <td><time dateTime={item.data_feedback}>{dateLabel(item.data_feedback)}</time></td>
              <td><FeedbackTypeBadge type={item.tipo} /></td>
              <td><strong>{item.nome_cliente || "—"}</strong></td>
              <td><strong>{item.nome_localidade}</strong></td>
              <td><time dateTime={item.data_entrega}>{dateLabel(item.data_entrega)}</time></td>
              <td><span className={cx(styles, commonStyles, "team-cell")}>{item.participantes.map((person) => person.nome_exibicao).join(", ") || "—"}</span></td>
              <td><span className={cx(styles, commonStyles, "report-preview")}>{item.relato}</span></td>
              <td><button className={cx(styles, commonStyles, "row-action")} type="button" onClick={() => setDetail(item)}>Ver detalhes <span aria-hidden="true">↗</span></button></td>
            </tr>)}
          </tbody></table></div>
          : <div className={cx(styles, commonStyles, "feedback-empty")}><span aria-hidden="true">✳</span><h3>{total ? "Nenhuma manifestação nesta página" : "Nenhuma manifestação registrada"}</h3><p>{total ? "Altere os filtros ou consulte outra página." : "Quando houver uma reclamação ou elogio vinculado a uma entrega, o registro aparecerá aqui."}</p>{canCreate && !total && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={startCreate}>Registrar primeira manifestação</button>}</div>}
        <div className={cx(styles, commonStyles, "privacy-note")}><span aria-hidden="true">i</span><p>O nome do cliente é usado para identificar a manifestação. Não registre telefone, documento ou outros identificadores; evite incluir dados pessoais no relato.</p></div>
        <footer className={cx(styles, commonStyles, "feedback-filters")}><span>{total} registro{total === 1 ? "" : "s"}</span><div className={cx(styles, commonStyles, "pagination-controls")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={loading || offset + items.length >= total} onClick={() => setOffset((value) => value + pageSize)}>Próxima</button></div></footer>
      </section>
    </>}

    {!canView && canCreate && <section className={cx(styles, commonStyles, "create-only-card")}><span>✓</span><h2>Acesso para registrar manifestações</h2><p>Seu perfil pode registrar manifestações vinculadas a entregas confirmadas. A consulta ao histórico é liberada separadamente.</p><button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={startCreate}>Registrar manifestação</button></section>}
    {!canView && !canCreate && <section className={cx(styles, commonStyles, "create-only-card")}><span>i</span><h2>Acesso não disponível</h2><p>Peça à administração para liberar o acesso ao módulo de reclamações e elogios.</p></section>}

    {formOpen && <div className={cx(styles, commonStyles, "dialog-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setFormOpen(false); }}><section className={cx(styles, commonStyles, "feedback-form-dialog")} role="dialog" aria-modal="true" aria-labelledby="feedback-form-title">
      <div className={cx(styles, commonStyles, "detail-heading")}><div><p className={cx(styles, commonStyles, "feedback-eyebrow")}>NOVO REGISTRO</p><h2 id="feedback-form-title">Registrar manifestação</h2></div><button className={cx(styles, commonStyles, "icon-button")} type="button" aria-label="Fechar formulário" disabled={saving} onClick={() => setFormOpen(false)}>×</button></div>
      <form className={cx(styles, commonStyles, "feedback-form")} onSubmit={saveFeedback}>
        <div className={cx(styles, commonStyles, "type-picker")} role="group" aria-label="Tipo de manifestação">
          <button type="button" className={cx(styles, commonStyles, `type-option${form.tipo === "RECLAMACAO" ? " type-option-selected" : ""}`)} aria-pressed={form.tipo === "RECLAMACAO"} onClick={() => setForm((current) => ({ ...current, tipo: "RECLAMACAO" }))}><span className={cx(styles, commonStyles, "type-icon type-icon-complaint")}>!</span><span><strong>Reclamação</strong><small>Algo precisa de atenção</small></span></button>
          <button type="button" className={cx(styles, commonStyles, `type-option${form.tipo === "ELOGIO" ? " type-option-selected" : ""}`)} aria-pressed={form.tipo === "ELOGIO"} onClick={() => setForm((current) => ({ ...current, tipo: "ELOGIO" }))}><span className={cx(styles, commonStyles, "type-icon type-icon-praise")}>✦</span><span><strong>Elogio</strong><small>Uma experiência positiva</small></span></button>
        </div>
        <div className={cx(styles, commonStyles, "form-grid-two")}>
          <label>Data da manifestação<input type="date" required value={form.data_feedback} onChange={(event) => setForm((current) => ({ ...current, data_feedback: event.target.value }))} /></label>
          <label>Data da entrega relacionada<input type="date" required value={form.data_entrega} max={form.data_feedback} onChange={(event) => setForm((current) => ({ ...current, data_entrega: event.target.value, id_motorista: "", id_ajudante_1: "", id_ajudante_2: "", codigo_item_lancamento: "" }))} /></label>
        </div>
        <label>Nome do cliente<input type="text" required maxLength={160} autoComplete="off" value={form.nome_cliente} onChange={(event) => setForm((current) => ({ ...current, nome_cliente: event.target.value }))} /></label>
        <label>Loja<select required value={form.id_localidade} onChange={(event) => setForm((current) => ({ ...current, id_localidade: event.target.value, id_motorista: "", id_ajudante_1: "", id_ajudante_2: "", codigo_item_lancamento: "" }))} disabled={catalogsLoading}><option value="">{catalogsLoading ? "Carregando lojas..." : "Selecione a loja"}</option>{localities.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}</select></label>
        <fieldset className={cx(styles, commonStyles, "team-fieldset")}>
          <legend>Motorista e ajudantes</legend>
          <div className={cx(styles, commonStyles, "form-grid-two")}>
            <label>Motorista<select required value={form.id_motorista} onChange={(event) => setForm((current) => ({ ...current, id_motorista: event.target.value, codigo_item_lancamento: "" }))} disabled={catalogsLoading || deliveriesLoading || !deliveryItems.length}><option value="">{deliveriesLoading ? "Buscando motoristas..." : "Selecione o motorista"}</option>{drivers.map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao}</option>)}</select></label>
            <label>Ajudante 1 <span className={cx(styles, commonStyles, "optional-label")}>(opcional)</span><select value={form.id_ajudante_1} onChange={(event) => setForm((current) => ({ ...current, id_ajudante_1: event.target.value, codigo_item_lancamento: "" }))} disabled={catalogsLoading || deliveriesLoading || !deliveryItems.length}><option value="">Sem ajudante 1</option>{helpers.map((person) => <option key={person.id_pessoa} value={person.id_pessoa} disabled={String(person.id_pessoa) === form.id_ajudante_2}>{person.nome_exibicao}</option>)}</select></label>
            <label>Ajudante 2 <span className={cx(styles, commonStyles, "optional-label")}>(opcional)</span><select value={form.id_ajudante_2} onChange={(event) => setForm((current) => ({ ...current, id_ajudante_2: event.target.value, codigo_item_lancamento: "" }))} disabled={catalogsLoading || deliveriesLoading || !deliveryItems.length}><option value="">Sem ajudante 2</option>{helpers.map((person) => <option key={person.id_pessoa} value={person.id_pessoa} disabled={String(person.id_pessoa) === form.id_ajudante_1}>{person.nome_exibicao}</option>)}</select></label>
          </div>
        </fieldset>
        {(!form.data_entrega || !form.id_localidade) && <div className={cx(styles, commonStyles, "form-privacy-note")}><span aria-hidden="true">i</span>Selecione a data da entrega e a loja para carregar os motoristas e ajudantes disponíveis.</div>}
        <label>Entrega confirmada relacionada<select required value={form.codigo_item_lancamento} onChange={(event) => setForm((current) => ({ ...current, codigo_item_lancamento: event.target.value }))} disabled={!form.data_entrega || !form.id_localidade || !form.id_motorista || deliveriesLoading || !matchingDeliveryItems.length}><option value="">{deliveriesLoading ? "Buscando entregas..." : "Selecione a entrega da equipe"}</option>{matchingDeliveryItems.map((item) => <option key={item.codigo_item_lancamento} value={item.codigo_item_lancamento}>{item.participantes.map((person) => person.nome_exibicao).join(", ") || "Equipe sem nome"} · {item.quantidade_realizada} realizadas / {item.quantidade_nao_realizada} não realizadas</option>)}</select></label>
        {deliveryError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{deliveryError}</div>}
        {!deliveriesLoading && form.data_entrega && form.id_localidade && !deliveryError && !deliveryItems.length && <div className={cx(styles, commonStyles, "notice notice-error")} role="status">Não há entrega confirmada para essa loja e data. Confira os dados ou escolha outro dia.</div>}
        {!deliveriesLoading && form.data_entrega && form.id_localidade && form.id_motorista && deliveryItems.length > 0 && !matchingDeliveryItems.length && <div className={cx(styles, commonStyles, "notice notice-error")} role="status">Não há entrega confirmada para a equipe selecionada nessa loja e data. Confira o motorista e os ajudantes.</div>}
        {selectedDelivery && <div className={cx(styles, commonStyles, "form-privacy-note")}><span aria-hidden="true">i</span>Equipe selecionada: {teamLabel(selectedDelivery)}. A manifestação ficará vinculada a essa equipe e à entrega confirmada.</div>}
        <label>Relato<textarea required minLength={5} maxLength={5000} rows={5} value={form.relato} onChange={(event) => setForm((current) => ({ ...current, relato: event.target.value }))} placeholder="Descreva com clareza o que aconteceu ou o que o cliente elogiou." /></label>
        {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{error}</div>}
        <div className={cx(styles, commonStyles, "form-privacy-note")}><span aria-hidden="true">i</span>Informe o nome do cliente. Não registre telefone, documento ou outro identificador. Evite incluir dados pessoais no relato livre.</div>
        {isDemoMode && <div className={cx(styles, commonStyles, "form-privacy-note")}><span aria-hidden="true">i</span>Na prévia, os registros ficam salvos apenas neste navegador. Não use dados reais de clientes.</div>}
        <div className={cx(styles, commonStyles, "form-actions")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</button><button className={cx(styles, commonStyles, "button button-primary")} type="submit" disabled={saving || catalogsLoading || deliveriesLoading || !localities.length || !drivers.length}>{saving ? "Salvando..." : "Salvar manifestação"}</button></div>
      </form>
    </section></div>}
    {importOpen && <FeedbackCsvImportDialog
      onClose={() => setImportOpen(false)}
      onImported={(count) => {
        setImportOpen(false);
        setNotice(`${count} manifestações importadas com sucesso.`);
        if (canView) {
          setOffset(0);
          setReloadVersion((version) => version + 1);
        }
      }}
    />}
    {detail && <FeedbackDetails item={detail} onClose={() => setDetail(null)} />}
  </div>;
}
