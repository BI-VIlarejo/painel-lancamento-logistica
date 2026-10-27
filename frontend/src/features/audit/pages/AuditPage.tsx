import { useEffect, useState } from "react";
import styles from "./AuditPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { LoadingState } from "../../../shared/components/LoadingState";
import { messageFromApiError } from "../../../shared/api/apiError";
import { auditApi } from "../api";
import type { AuditEvent, AuditOrigin } from "../types";

const pageSize = 25;

function formatDateTime(value: string): string {
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

const eventLabels: Record<string, string> = {
  RASCUNHO_CRIADO: "Rascunho criado",
  RASCUNHO_ATUALIZADO: "Rascunho atualizado",
  RASCUNHO_DESCARTADO: "Rascunho descartado",
  RASCUNHO_CONFIRMADO: "Lançamento confirmado",
  CORRECAO_INICIADA: "Correção iniciada",
  LANCAMENTO_CANCELADO: "Lançamento cancelado",
  FEEDBACK_CRIADO: "Feedback registrado",
  USUARIO_CRIADO: "Usuário criado",
  USUARIO_ATUALIZADO: "Usuário atualizado",
  USUARIO_ATIVADO: "Usuário ativado",
  USUARIO_DESATIVADO: "Usuário desativado",
  USUARIO_SENHA_ALTERADA: "Senha redefinida",
  USUARIO_ESCOPO_CONCEDIDO: "Acesso concedido",
  USUARIO_ESCOPO_REVOGADO: "Acesso revogado",
  PERFIL_CRIADO: "Perfil criado",
  PERFIL_ATUALIZADO: "Perfil atualizado",
  PERFIL_ATIVADO: "Perfil ativado",
  PERFIL_DESATIVADO: "Perfil desativado",
  RECURSO_CRIADO: "Recurso criado",
  RECURSO_ATUALIZADO: "Recurso atualizado",
  RECURSO_ATIVADO: "Recurso ativado",
  RECURSO_DESATIVADO: "Recurso desativado",
  PERMISSAO_CRIADA: "Permissão criada",
  PERMISSAO_ATUALIZADA: "Permissão atualizada",
  PERMISSAO_ATIVADA: "Permissão ativada",
  PERMISSAO_DESATIVADA: "Permissão desativada",
  PERFIL_PERMISSAO_CONCEDIDA: "Permissão concedida ao perfil",
  PERFIL_PERMISSAO_REVOGADA: "Permissão removida do perfil",
  LOCALIDADE_CRIADA: "Localidade criada",
  LOCALIDADE_ATUALIZADA: "Localidade atualizada",
  LOCALIDADE_ATIVADA: "Localidade ativada",
  LOCALIDADE_DESATIVADA: "Localidade desativada",
  PESSOA_CRIADA: "Pessoa cadastrada",
  PESSOA_ATUALIZADA: "Pessoa editada",
  PESSOA_VERSIONADA: "Pessoa versionada",
  PESSOA_DESATIVADA: "Pessoa desativada",
  MOTIVO_CRIADO: "Motivo cadastrado",
  MOTIVO_ATUALIZADO: "Motivo editado",
  MOTIVO_VERSIONADO: "Motivo versionado",
  MOTIVO_DESATIVADO: "Motivo desativado",
};

function eventLabel(value: string): string {
  return eventLabels[value] ?? value.replaceAll("_", " ").toLocaleLowerCase("pt-BR");
}

const fieldLabels: Record<string, string> = {
  nome_exibicao: "Nome",
  tipo_funcao: "Função",
  tipo_transporte_entrega: "Grupo de entrega",
  descricao_motivo: "Descrição",
  grupo_motivo: "Grupo do motivo",
  nome_localidade: "Localidade",
  tipo_localidade: "Tipo de localidade",
  cidade: "Cidade",
  uf: "UF",
  ativo: "Situação",
  username: "Usuário",
  nome_completo: "Nome completo",
  nome: "Nome",
  codigo: "Código",
  id_setor: "Setor",
  id_recurso: "Recurso",
  descricao: "Descrição",
  acao: "Ação",
  tipo_escopo: "Tipo de escopo",
  estado: "Situação do lançamento",
};

function auditValue(value: string | null): string {
  if (value === null) return "—";
  const values: Record<string, string> = {
    true: "Ativo",
    false: "Inativo",
    PROPRIA: "Própria",
    TERCEIRIZADA: "Terceirizada",
    MOTORISTA: "Motorista",
    AJUDANTE: "Ajudante",
    TRANSPORTE_PROPRIO: "Transporte próprio",
    TRANSPORTE_TERCEIRIZADO: "Transporte terceirizado",
    LOJA: "Loja",
    LOGISTICA: "Logística",
    CD: "Centro de distribuição",
    OUTRO: "Outro",
  };
  return values[value] ?? value;
}

function AuditTable({ items }: { items: AuditEvent[] }) {
  return <div className={cx(styles, commonStyles, "audit-table-wrap")}><table className={cx(styles, commonStyles, "audit-table")}>
    <thead><tr><th>Quando</th><th>Origem</th><th>Ação</th><th>Quem fez</th><th>Alvo</th><th>Alterações</th></tr></thead>
    <tbody>{items.map((event) => <tr key={`${event.origem}-${event.id_evento}`}>
      <td><time dateTime={event.ocorrido_em}>{formatDateTime(event.ocorrido_em)}</time></td>
      <td><span className={cx(styles, commonStyles, `audit-origin audit-origin-${event.origem.toLowerCase()}`)}>{event.origem === "ENTREGAS" ? "Entregas" : event.origem === "ACESSOS" ? "Acessos" : "Feedback"}</span></td>
      <td><strong>{eventLabel(event.tipo_evento)}</strong></td>
      <td><span className={cx(styles, commonStyles, "audit-actor")}>{event.ator_nome ?? (event.ator_usuario_id === null ? "—" : `Usuário #${event.ator_usuario_id}`)}</span>{event.ator_username && <small className={cx(styles, commonStyles, "audit-actor-username")}>@{event.ator_username}</small>}{event.ator_nome && event.ator_usuario_id !== null && <small className={cx(styles, commonStyles, "audit-actor-id")}>ID {event.ator_usuario_id}</small>}</td>
      <td>{event.alvo ?? (event.referencia_id === null ? "—" : event.origem === "FEEDBACK" ? `Feedback #${event.referencia_id}` : `Lançamento #${event.referencia_id}`)}</td>
      <td>{event.alteracoes.length ? <ul className={cx(styles, commonStyles, "audit-changes")}>{event.alteracoes.map((change, index) => <li key={`${change.campo}-${index}`}><strong>{fieldLabels[change.campo] ?? change.campo}</strong>: {auditValue(change.anterior)} → {auditValue(change.novo)}</li>)}</ul> : "—"}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function AuditPage() {
  const [origin, setOrigin] = useState<AuditOrigin | "TODOS">("TODOS");
  const [eventType, setEventType] = useState("");
  const [actor, setActor] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void auditApi.list({
      origem: origin,
      tipo_evento: eventType || undefined,
      ator_usuario_id: actor ? Number(actor) : undefined,
      ocorrido_de: fromDate || undefined,
      ocorrido_ate: toDate || undefined,
      limit: pageSize,
      offset,
    }).then((page) => {
      if (!active) return;
      setItems(page.items);
      setTotal(page.total);
    }).catch((loadError: unknown) => {
      if (active) setError(messageFromApiError(loadError));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [actor, eventType, fromDate, offset, origin, reload, toDate]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;
  const resetOffset = () => setOffset(0);

  return <div className={cx(styles, commonStyles, "audit-page")}>
    <header className={cx(styles, commonStyles, "page-heading-row")}>
      <div><p className={cx(styles, commonStyles, "eyebrow")}>CONTROLE INTERNO</p><h1>Auditoria</h1><p className={cx(styles, commonStyles, "page-lead")}>Veja quem executou cada ação e qual cadastro, acesso ou lançamento foi afetado.</p></div>
    </header>
    <section className={cx(styles, commonStyles, "audit-card")}>
      <div className={cx(styles, commonStyles, "audit-toolbar")}>
        <label className={cx(styles, commonStyles, "filter-control")}>Origem<select value={origin} onChange={(event) => { setOrigin(event.target.value as AuditOrigin | "TODOS"); resetOffset(); }}><option value="TODOS">Todas</option><option value="ENTREGAS">Entregas</option><option value="ACESSOS">Acessos</option><option value="FEEDBACK">Feedback</option></select></label>
        <label className={cx(styles, commonStyles, "filter-control")}>Tipo do evento<input value={eventType} maxLength={40} onChange={(event) => { setEventType(event.target.value); resetOffset(); }} placeholder="Ex.: LANCAMENTO_CANCELADO" /></label>
        <label className={cx(styles, commonStyles, "filter-control")}>ID do usuário<input type="number" min="1" value={actor} onChange={(event) => { setActor(event.target.value); resetOffset(); }} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}>De<input type="date" max={toDate || undefined} value={fromDate} onChange={(event) => { setFromDate(event.target.value); resetOffset(); }} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}>Até<input type="date" min={fromDate || undefined} value={toDate} onChange={(event) => { setToDate(event.target.value); resetOffset(); }} /></label>
      </div>
      <div className={cx(styles, commonStyles, "audit-note")} role="note"><span aria-hidden="true">i</span><p>A consulta mostra somente metadados permitidos e alterações de campos seguros. Relatos, dados de clientes, credenciais e textos livres não são exibidos aqui.</p></div>
      {error && <div className={cx(styles, commonStyles, "notice notice-error audit-message")} role="alert">Não foi possível carregar a auditoria. {error}<button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReload((value) => value + 1)}>Tentar novamente</button></div>}
      {loading ? <LoadingState label="Carregando eventos de auditoria..." /> : items.length ? <AuditTable items={items} /> : <div className={cx(styles, commonStyles, "audit-empty")}>{error ? "A consulta não foi concluída." : "Nenhum evento encontrado para os filtros selecionados."}</div>}
      <footer className={cx(styles, commonStyles, "audit-footer")}><span>{total} evento{total === 1 ? "" : "s"}</span><div className={cx(styles, commonStyles, "pagination-controls")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - pageSize))}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={loading || offset + items.length >= total} onClick={() => setOffset((value) => value + pageSize)}>Próxima</button></div></footer>
    </section>
  </div>;
}
