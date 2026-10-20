import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import styles from "./FeedbackPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { isDemoMode } from "../../../shared/api/apiClient";
import { ApiError, messageFromApiError } from "../../../shared/api/apiError";
import { catalogsApi } from "../../catalogs/api";
import { feedbackApi } from "../api";
import type { FeedbackCreateInput, FeedbackItem, FeedbackType } from "../types";
import type { LocalityCatalogItem, PersonCatalogItem } from "../../deliveries/types";

type Props = { permissions: string[] };
type FormState = {
  data_feedback: string;
  tipo: FeedbackType | "";
  id_localidade: string;
  nome_cliente: string;
  id_motorista: string;
  id_ajudante_1: string;
  id_ajudante_2: string;
  relato: string;
};

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const emptyForm = (): FormState => ({ data_feedback: today(), tipo: "", id_localidade: "", nome_cliente: "", id_motorista: "", id_ajudante_1: "", id_ajudante_2: "", relato: "" });
const dateLabel = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(year, month - 1, day));
};
const typeLabel = (type: FeedbackType) => type === "ELOGIO" ? "Elogio" : "Reclamação";

function csvCell(value: string): string {
  const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadCsv(items: FeedbackItem[]): void {
  const rows = [
    ["data", "tipo", "cliente", "loja", "motorista", "entregador1", "entregador2", "descricao"],
    ...items.map((item) => [
      item.data_feedback,
      item.tipo,
      item.nome_cliente ?? "",
      item.nome_localidade,
      item.participantes.find((person) => person.papel_participante === "MOTORISTA")?.nome_exibicao ?? "",
      item.participantes.filter((person) => person.papel_participante === "AJUDANTE")[0]?.nome_exibicao ?? "",
      item.participantes.filter((person) => person.papel_participante === "AJUDANTE")[1]?.nome_exibicao ?? "",
      item.relato,
    ]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reclamacoes-elogios-${today()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function FeedbackTypeBadge({ type }: { type: FeedbackType }) {
  return <span className={cx(styles, commonStyles, `feedback-type feedback-type-${type.toLowerCase()}`)}><i aria-hidden="true" />{typeLabel(type)}</span>;
}

function FeedbackDetails({ item, onClose }: { item: FeedbackItem; onClose: () => void }) {
  return <div className={cx(styles, commonStyles, "dialog-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={cx(styles, commonStyles, "feedback-detail-dialog")} role="dialog" aria-modal="true" aria-labelledby="feedback-detail-title">
      <div className={cx(styles, commonStyles, "detail-heading")}><div><p className={cx(styles, commonStyles, "feedback-eyebrow")}>REGISTRO DE CLIENTE</p><h2 id="feedback-detail-title">Detalhes da manifestação</h2></div><button className={cx(styles, commonStyles, "icon-button")} type="button" aria-label="Fechar detalhes" onClick={onClose}>×</button></div>
      <div className={cx(styles, commonStyles, "detail-content")}>
        <div className={cx(styles, commonStyles, "detail-summary")}><FeedbackTypeBadge type={item.tipo} /><span>{dateLabel(item.data_feedback)}</span><strong>{item.nome_localidade}</strong></div>
        <dl className={cx(styles, commonStyles, "detail-facts")}>
          <div><dt>Cliente</dt><dd>{item.nome_cliente || "Não informado"}</dd></div>
          <div><dt>Equipe relacionada</dt><dd>{item.participantes.map((person) => `${person.nome_exibicao} · ${person.papel_participante === "MOTORISTA" ? "Motorista" : "Ajudante"}`).join(", ") || "Não informada"}</dd></div>
        </dl>
        <div className={cx(styles, commonStyles, "detail-report")}><span>Relato</span><p>{item.relato}</p></div>
      </div>
      <div className={cx(styles, commonStyles, "detail-footer")}><span>Registrado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.criado_em))}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={onClose}>Fechar</button></div>
    </section>
  </div>;
}

export function FeedbackPage({ permissions }: Props) {
  const canView = permissions.includes("FEEDBACK_CLIENTES:VER");
  const canCreate = permissions.includes("FEEDBACK_CLIENTES:CRIAR");
  const canExport = permissions.includes("FEEDBACK_CLIENTES:EXPORTAR");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [localities, setLocalities] = useState<LocalityCatalogItem[]>([]);
  const [drivers, setDrivers] = useState<PersonCatalogItem[]>([]);
  const [helpers, setHelpers] = useState<PersonCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<FeedbackItem | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FeedbackType | "TODOS">("TODOS");
  const [localityFilter, setLocalityFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    let active = true;
    setCatalogsLoading(true);
    void Promise.all([catalogsApi.localities(), catalogsApi.people("MOTORISTA"), catalogsApi.people("AJUDANTE")])
      .then(([localityPage, driverPage, helperPage]) => {
        if (!active) return;
        setLocalities(localityPage.items);
        setDrivers(driverPage.items);
        setHelpers(helperPage.items);
      })
      .catch((loadError: unknown) => { if (active) setCatalogError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setCatalogsLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    void feedbackApi.list()
      .then((result) => { if (active) setItems(result.items); })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof ApiError && loadError.status === 404
          ? "A API ainda não disponibiliza a consulta de manifestações. Nenhum dado real foi alterado."
          : messageFromApiError(loadError));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canView, reloadVersion]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    return items.filter((item) => (!needle || [item.nome_cliente ?? "", item.nome_localidade, item.relato, ...item.participantes.map((person) => person.nome_exibicao)].join(" ").toLocaleLowerCase("pt-BR").includes(needle)))
      .filter((item) => typeFilter === "TODOS" || item.tipo === typeFilter)
      .filter((item) => !localityFilter || item.id_localidade === Number(localityFilter))
      .filter((item) => !fromDate || item.data_feedback >= fromDate)
      .filter((item) => !toDate || item.data_feedback <= toDate)
      .sort((a, b) => b.data_feedback.localeCompare(a.data_feedback) || b.criado_em.localeCompare(a.criado_em));
  }, [fromDate, items, localityFilter, search, toDate, typeFilter]);
  const complaintCount = filteredItems.filter((item) => item.tipo === "RECLAMACAO").length;
  const praiseCount = filteredItems.length - complaintCount;

  const startCreate = () => {
    setForm(emptyForm());
    setError("");
    setNotice("");
    setFormOpen(true);
  };
  const saveFeedback = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.tipo || !form.id_localidade || !form.id_motorista) {
      setError("Preencha o tipo, a loja e o motorista para registrar a manifestação.");
      return;
    }
    const participantes: FeedbackCreateInput["participantes"] = [
      { id_pessoa: Number(form.id_motorista), papel_participante: "MOTORISTA" },
      ...[form.id_ajudante_1, form.id_ajudante_2].filter(Boolean).map((id) => ({ id_pessoa: Number(id), papel_participante: "AJUDANTE" as const })),
    ];
    if (new Set(participantes.map((person) => person.id_pessoa)).size !== participantes.length) {
      setError("Selecione pessoas diferentes para motorista e ajudantes.");
      return;
    }
    const payload: FeedbackCreateInput = {
      data_feedback: form.data_feedback,
      tipo: form.tipo,
      id_localidade: Number(form.id_localidade),
      nome_cliente: form.nome_cliente.trim() || null,
      participantes,
      relato: form.relato.trim(),
    };
    setSaving(true);
    setError("");
    void feedbackApi.create(payload)
      .then((created) => {
        setItems((current) => [created, ...current.filter((item) => item.id_feedback !== created.id_feedback)]);
        setNotice(`${typeLabel(created.tipo)} registrado${created.tipo === "ELOGIO" ? "" : "a"} com sucesso.`);
        setFormOpen(false);
        setForm(emptyForm());
        if (!canView) setItems([]);
        else setReloadVersion((version) => version + 1);
      })
      .catch((saveError: unknown) => setError(saveError instanceof ApiError && saveError.status === 404
        ? "A API ainda não disponibiliza o cadastro de manifestações. O registro não foi salvo."
        : messageFromApiError(saveError)))
      .finally(() => setSaving(false));
  };

  return <div className={cx(styles, commonStyles, "feedback-page")}>
    <header className={cx(styles, commonStyles, "feedback-heading")}>
      <div><p className={cx(styles, commonStyles, "feedback-eyebrow")}>EXPERIÊNCIA DO CLIENTE</p><h1>Reclamações e elogios</h1><p className={cx(styles, commonStyles, "feedback-lead")}>Registre manifestações dos clientes e consulte o histórico por loja e equipe.</p></div>
      <div className={cx(styles, commonStyles, "heading-actions")}>
        {isDemoMode && <span className={cx(styles, commonStyles, "preview-label")}><i /> Prévia interativa</span>}
        {canExport && canView && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={!filteredItems.length} onClick={() => downloadCsv(filteredItems)}><span aria-hidden="true">↓</span> Exportar CSV</button>}
        {canCreate && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={startCreate}><span aria-hidden="true">＋</span> Registrar manifestação</button>}
      </div>
    </header>

    {error && !formOpen && <div className={cx(styles, commonStyles, "notice notice-error page-notice")} role="alert">{error}{canView && <button type="button" onClick={() => setReloadVersion((version) => version + 1)}>Tentar novamente</button>}</div>}
    {notice && <div className={cx(styles, commonStyles, "notice notice-success page-notice")} role="status"><span>✓</span>{notice}<button type="button" aria-label="Fechar mensagem" onClick={() => setNotice("")}>×</button></div>}
    {catalogError && <div className={cx(styles, commonStyles, "notice notice-error page-notice")} role="alert">Não foi possível carregar lojas e equipe. {catalogError}</div>}

    {canView && <>
      <section className={cx(styles, commonStyles, "feedback-summary")} aria-label="Resumo de manifestações">
        <article className={cx(styles, commonStyles, "summary-card")}><span className={cx(styles, commonStyles, "summary-mark")}>Σ</span><div><span>Manifestações no filtro</span><strong>{loading ? "—" : filteredItems.length}</strong></div></article>
        <article className={cx(styles, commonStyles, "summary-card")}><span className={cx(styles, commonStyles, "summary-mark summary-mark-complaint")}>!</span><div><span>Reclamações</span><strong>{loading ? "—" : complaintCount}</strong></div></article>
        <article className={cx(styles, commonStyles, "summary-card")}><span className={cx(styles, commonStyles, "summary-mark summary-mark-praise")}>✦</span><div><span>Elogios</span><strong>{loading ? "—" : praiseCount}</strong></div></article>
      </section>

      <section className={cx(styles, commonStyles, "feedback-panel")}>
        <div className={cx(styles, commonStyles, "panel-heading")}><div><h2>Histórico de manifestações</h2><p>{filteredItems.length} registro{filteredItems.length === 1 ? "" : "s"} encontrado{filteredItems.length === 1 ? "" : "s"}</p></div></div>
        <div className={cx(styles, commonStyles, "feedback-filters")}>
          <label className={cx(styles, commonStyles, "search-field")}><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, loja, pessoa ou relato" aria-label="Buscar manifestações" /></label>
          <label className={cx(styles, commonStyles, "filter-control")}>Tipo<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as FeedbackType | "TODOS")}><option value="TODOS">Todos</option><option value="RECLAMACAO">Reclamação</option><option value="ELOGIO">Elogio</option></select></label>
          <label className={cx(styles, commonStyles, "filter-control")}>Loja<select value={localityFilter} onChange={(event) => setLocalityFilter(event.target.value)}><option value="">Todas</option>{localities.map((locality) => <option value={locality.id_localidade} key={locality.id_localidade}>{locality.nome_localidade}</option>)}</select></label>
          <label className={cx(styles, commonStyles, "filter-control")}>De<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label className={cx(styles, commonStyles, "filter-control")}>Até<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        </div>
        {loading ? <div className={cx(styles, commonStyles, "feedback-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />Carregando manifestações...</div>
          : error && !items.length ? <div className={cx(styles, commonStyles, "feedback-load-error")}><span aria-hidden="true">!</span><h3>Histórico indisponível</h3><p>{error}</p></div>
          : filteredItems.length ? <div className={cx(styles, commonStyles, "table-scroll")}><table className={cx(styles, commonStyles, "feedback-table")}><thead><tr><th>Data</th><th>Tipo</th><th>Loja</th><th>Cliente</th><th>Equipe</th><th>Relato</th><th aria-label="Ações" /></tr></thead><tbody>
            {filteredItems.map((item) => <tr key={item.id_feedback}><td><time dateTime={item.data_feedback}>{dateLabel(item.data_feedback)}</time></td><td><FeedbackTypeBadge type={item.tipo} /></td><td><strong>{item.nome_localidade}</strong></td><td>{item.nome_cliente || <span className={cx(styles, commonStyles, "muted-value")}>Não informado</span>}</td><td><span className={cx(styles, commonStyles, "team-cell")}>{item.participantes.map((person) => person.nome_exibicao).join(", ") || "—"}</span></td><td><span className={cx(styles, commonStyles, "report-preview")}>{item.relato}</span></td><td><button className={cx(styles, commonStyles, "row-action")} type="button" onClick={() => setDetail(item)}>Ver detalhes <span aria-hidden="true">↗</span></button></td></tr>)}
          </tbody></table></div>
          : <div className={cx(styles, commonStyles, "feedback-empty")}><span aria-hidden="true">✳</span><h3>{items.length ? "Nenhuma manifestação neste filtro" : "Nenhuma manifestação registrada"}</h3><p>{items.length ? "Altere os filtros para consultar outros registros." : "Quando houver uma reclamação ou elogio, os registros aparecerão aqui."}</p>{canCreate && !items.length && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={startCreate}>Registrar primeira manifestação</button>}</div>}
        <div className={cx(styles, commonStyles, "privacy-note")}><span aria-hidden="true">i</span><p>Relatos e nomes de clientes são informações restritas. Compartilhe exportações somente com pessoas autorizadas.</p></div>
      </section>
    </>}

    {!canView && canCreate && <section className={cx(styles, commonStyles, "create-only-card")}><span>✓</span><h2>Acesso para registrar manifestações</h2><p>Seu perfil pode cadastrar reclamações e elogios. A consulta ao histórico é liberada separadamente.</p><button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={startCreate}>Registrar manifestação</button></section>}
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
          <label>Loja<select required value={form.id_localidade} onChange={(event) => setForm((current) => ({ ...current, id_localidade: event.target.value }))} disabled={catalogsLoading}><option value="">{catalogsLoading ? "Carregando lojas..." : "Selecione a loja"}</option>{localities.map((locality) => <option key={locality.id_localidade} value={locality.id_localidade}>{locality.nome_localidade}</option>)}</select></label>
        </div>
        <label>Nome do cliente <span className={cx(styles, commonStyles, "optional-label")}>opcional</span><input maxLength={160} value={form.nome_cliente} onChange={(event) => setForm((current) => ({ ...current, nome_cliente: event.target.value }))} autoComplete="off" placeholder="Informe apenas se necessário para entender o caso" /></label>
        <fieldset className={cx(styles, commonStyles, "team-fieldset")}><legend>Equipe relacionada</legend><div className={cx(styles, commonStyles, "form-grid-two")}>
          <label>Motorista<select required value={form.id_motorista} onChange={(event) => setForm((current) => ({ ...current, id_motorista: event.target.value }))} disabled={catalogsLoading}><option value="">Selecione o motorista</option>{drivers.map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao}</option>)}</select></label>
          <label>Ajudante 1 <span className={cx(styles, commonStyles, "optional-label")}>opcional</span><select value={form.id_ajudante_1} onChange={(event) => setForm((current) => ({ ...current, id_ajudante_1: event.target.value }))} disabled={catalogsLoading}><option value="">Nenhum</option>{helpers.map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao}</option>)}</select></label>
          <label>Ajudante 2 <span className={cx(styles, commonStyles, "optional-label")}>opcional</span><select value={form.id_ajudante_2} onChange={(event) => setForm((current) => ({ ...current, id_ajudante_2: event.target.value }))} disabled={catalogsLoading}><option value="">Nenhum</option>{helpers.map((person) => <option key={person.id_pessoa} value={person.id_pessoa}>{person.nome_exibicao}</option>)}</select></label>
        </div></fieldset>
        <label>Relato <textarea required minLength={5} maxLength={5000} rows={5} value={form.relato} onChange={(event) => setForm((current) => ({ ...current, relato: event.target.value }))} placeholder="Descreva com clareza o que aconteceu ou o que o cliente elogiou." /></label>
        {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{error}</div>}
        <div className={cx(styles, commonStyles, "form-privacy-note")}><span aria-hidden="true">i</span>Evite registrar dados pessoais do cliente que não sejam necessários para tratar a manifestação.</div>
        {isDemoMode && <div className={cx(styles, commonStyles, "form-privacy-note")}><span aria-hidden="true">i</span>Na prévia, os registros ficam salvos apenas neste navegador. Não use dados reais de clientes.</div>}
        <div className={cx(styles, commonStyles, "form-actions")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</button><button className={cx(styles, commonStyles, "button button-primary")} type="submit" disabled={saving || catalogsLoading || !drivers.length || !localities.length}>{saving ? "Salvando..." : "Salvar manifestação"}</button></div>
      </form>
    </section></div>}
    {detail && <FeedbackDetails item={detail} onClose={() => setDetail(null)} />}
  </div>;
}
