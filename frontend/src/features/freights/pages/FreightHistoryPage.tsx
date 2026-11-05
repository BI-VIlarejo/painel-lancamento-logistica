import { useEffect, useRef, useState } from "react";
import { freightsApi } from "../api";
import { formatDate, formatMoney, formatNumber, firstDayOfCurrentMonth, localDateValue, numericValue, tariffSourceLabel } from "../format";
import { messageFromApiError } from "../../../shared/api/apiError";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import type { FreightRecordedTransportType, FreightResponse } from "../types";
import styles from "./FreightHistoryPage.module.css";

type Props = { onNavigate: (path: string) => void; canCreate: boolean; canViewPayments: boolean };
const pageSizeOptions = [10, 25, 50, 100];

function transportTypeLabel(type: FreightRecordedTransportType): string {
  if (type === "PROPRIO") return "Frota própria";
  if (type === "AGREGADO") return "Agregado";
  return "Transportadora independente";
}

function transportName(item: FreightResponse): string {
  if (item.tipo_transporte === "AGREGADO") return item.nome_transportador || "Agregado sem identificação";
  if (item.tipo_transporte === "PROPRIO") return item.nome_transportador || "Frota própria";
  return item.nome_transportador || "Transportadora não informada";
}

function formatDateTime(value: string | null): string {
  if (!value) return "Não informado";
  const timestamp = value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatPercentage(value: string | number | null): string {
  const parsed = numericValue(value);
  return parsed === null ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(parsed * 100)}%`;
}

function truckLabel(type: FreightResponse["tipo_caminhao"]): string {
  if (type === "SAVEIRO") return "Saveiro";
  if (type === "KIA_BONGO") return "Kia Bongo";
  if (type === "CAMINHAO_3_4") return "Caminhão 3/4";
  if (type === "CAMINHAO_TOCO") return "Caminhão toco";
  return "Não se aplica";
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className={cx(styles, "detail-field")}><dt>{label}</dt><dd>{value || "Não informado"}</dd></div>;
}

function FreightDetailsDialog({
  item,
  busy,
  error,
  onClose,
  onEdit,
  onCancel,
}: {
  item: FreightResponse;
  busy: boolean;
  error: string;
  onClose: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const sections: Array<{ title: string; fields: Array<[string, string]> }> = [
    {
      title: "Dados do serviço",
      fields: [
        ["Tipo de transporte", transportTypeLabel(item.tipo_transporte)],
        ["Responsável", transportName(item)],
        ["Rota / cidade", item.rota_cidade],
        ["Fonte tarifária", item.codigo_fonte_tarifa ? tariffSourceLabel(item.codigo_fonte_tarifa) : "Não informada"],
      ],
    },
    {
      title: "Operação",
      fields: [
        ["KM inicial", formatNumber(item.km_inicial)],
        ["KM final", formatNumber(item.km_final)],
        ["KM rodado", item.km_rodado === null ? "Não se aplica" : `${formatNumber(item.km_rodado)} km`],
        ["Quantidade de entregas", item.quantidade_entregas.toLocaleString("pt-BR")],
        ["Peso", `${formatNumber(item.peso_kg)} kg`],
        ["Tipo de caminhão", truckLabel(item.tipo_caminhao)],
        ["Zona JUST IN TIME", item.codigo_zona_jit ?? "Não se aplica"],
        ["Adicionais", item.adicionais_jit.length ? item.adicionais_jit.join(", ") : "Nenhum"],
      ],
    },
    {
      title: "Valores e conferência",
      fields: [
        ["Valor da nota", formatMoney(item.valor_nota)],
        ["Quantidade de avarias", item.quantidade_avarias.toLocaleString("pt-BR")],
        ["Valor da avaria", formatMoney(item.valor_avaria)],
        ["Frete bruto", formatMoney(item.valor_frete_bruto)],
        ["Percentual calculado", formatPercentage(item.percentual_frete)],
        ["Total líquido", formatMoney(item.valor_frete_pago)],
        ["Status do cálculo", item.status_calculo === "CALCULADO" ? "Calculado" : "Pendente de conferência"],
        ["Motivo da pendência", item.motivo_pendencia ?? "Nenhum"],
      ],
    },
    {
      title: "Registro",
      fields: [
        ["Criado pelo usuário", String(item.criado_por)],
        ["Criado em", formatDateTime(item.criado_em)],
      ],
    },
  ];

  return (
    <div className={cx(styles, commonStyles, "dialog-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={cx(styles, commonStyles, "detail-dialog", "freight-detail-dialog")} role="dialog" aria-modal="true" aria-labelledby="freight-detail-title">
        <div className={cx(styles, commonStyles, "dialog-heading")}>
          <div><p className={cx(styles, commonStyles, "eyebrow")}>DETALHES DO FRETE</p><h2 id="freight-detail-title">{transportName(item)} <span>· {formatDate(item.data_servico)}</span></h2></div>
          <button ref={closeButton} className={cx(styles, commonStyles, "icon-button", "dialog-close")} type="button" aria-label="Fechar detalhes" onClick={onClose}>×</button>
        </div>
        <div className={cx(styles, commonStyles, "dialog-meta", "freight-dialog-meta")}>
          <span className={cx(styles, "freight-status", item.cancelado ? "freight-status-cancelled" : "freight-status-active")}>{item.cancelado ? "Cancelado" : item.status_calculo === "CALCULADO" ? "Calculado" : "Pendente de conferência"}</span>
        </div>
        {item.cancelado && <div className={cx(styles, "cancellation-summary")}><strong>Cancelado em {formatDateTime(item.cancelado_em)}</strong><span>Usuário #{item.cancelado_por ?? "não informado"}</span><p>{item.justificativa_cancelamento || "Justificativa não informada."}</p></div>}
        {error && <div className={cx(styles, commonStyles, "notice notice-error", "freight-dialog-error")} role="alert">{error}</div>}
        <div className={cx(styles, "freight-detail-content")}>
          {sections.map((section) => <section className={cx(styles, "detail-section")} key={section.title}>
            <h3>{section.title}</h3>
            <dl className={cx(styles, "detail-fields")}>
              {section.fields.map(([label, value]) => <DetailField key={label} label={label} value={value} />)}
            </dl>
          </section>)}
        </div>
        <div className={cx(styles, commonStyles, "dialog-footer")}>
          <span>{item.cancelado ? "Este lançamento está cancelado e não compõe o pagamento." : "Ações ficam registradas na auditoria do frete."}</span>
          <div className={cx(styles, commonStyles, "dialog-actions")}>
            {onEdit && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={onEdit}>Editar lançamento</button>}
            {onCancel && <button className={cx(styles, commonStyles, "button button-secondary", "table-action-danger")} type="button" onClick={onCancel} disabled={busy}>{busy ? "Cancelando..." : "Cancelar lançamento"}</button>}
            <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function FreightRow({
  item,
  canManage,
  busy,
  onDetails,
  onEdit,
  onCancel,
}: {
  item: FreightResponse;
  canManage: boolean;
  busy: boolean;
  onDetails: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const canEdit = canManage && !item.cancelado && item.tipo_transporte !== "PROPRIO";
  const canCancel = canManage && !item.cancelado;
  return <tr>
    <td><strong>{formatDate(item.data_servico)}</strong>{item.cancelado && <small className={cx(styles, "cancelled-row-label")}>Cancelado</small>}</td>
    <td><strong>{transportTypeLabel(item.tipo_transporte)}</strong><small>{transportName(item)}</small></td>
    <td><strong>{item.rota_cidade}</strong><small>{item.quantidade_entregas.toLocaleString("pt-BR")} entregas · {formatNumber(item.peso_kg)} kg</small></td>
    <td>{item.tipo_transporte === "TRANSPORTADORA" ? <span>Não se aplica</span> : <><strong>{formatNumber(item.km_rodado)} km</strong><small>Inicial {formatNumber(item.km_inicial)} · Final {formatNumber(item.km_final)}</small></>}</td>
    <td><strong>{formatMoney(item.valor_frete_bruto)}</strong><small>{item.quantidade_avarias} avarias · Valor da avaria {formatMoney(item.valor_avaria)} · Líquido {formatMoney(item.valor_frete_pago)}</small></td>
    <td><div className={cx(styles, commonStyles, "history-row-actions")}>
      <span className={cx(styles, commonStyles, "history-main-actions")}>
        <button className={cx(styles, commonStyles, "table-action")} type="button" onClick={onDetails}>Detalhes</button>
        {canEdit && <button className={cx(styles, commonStyles, "table-action")} type="button" onClick={onEdit}>Editar</button>}
        {canCancel && <button className={cx(styles, commonStyles, "table-action", "table-action-danger")} type="button" onClick={onCancel} disabled={busy}>{busy ? "Cancelando..." : "Cancelar"}</button>}
      </span>
    </div></td>
  </tr>;
}

/** Histórico de fretes com consulta completa e ações auditáveis. */
export function FreightHistoryPage({ onNavigate, canCreate, canViewPayments }: Props) {
  const [items, setItems] = useState<FreightResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [fromDate, setFromDate] = useState(firstDayOfCurrentMonth());
  const [toDate, setToDate] = useState(localDateValue());
  const [transportType, setTransportType] = useState<FreightRecordedTransportType | "TODOS">("TODOS");
  const [pageSize, setPageSize] = useState(25);
  const [offset, setOffset] = useState(0);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<FreightResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const savedMessage = window.sessionStorage.getItem("lancamento-logistica:freight-saved");
    if (savedMessage) {
      setNotice(savedMessage);
      window.sessionStorage.removeItem("lancamento-logistica:freight-saved");
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void freightsApi.list({ data_de: fromDate || undefined, data_ate: toDate || undefined, tipo_transporte: transportType, limit: pageSize, offset })
      .then((page) => {
        if (active) {
          setItems(page.items);
          setTotal(page.total);
          setSelected((current) => current
            ? page.items.find((item) => item.codigo_frete === current.codigo_frete) ?? current
            : null);
        }
      })
      .catch((loadError: unknown) => { if (active) setError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fromDate, toDate, transportType, pageSize, offset, reloadVersion]);

  const currentPage = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  function changeFilter<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setOffset(0);
  }

  function startEdit(item: FreightResponse) {
    setSelected(null);
    onNavigate(`/fretes/${encodeURIComponent(item.codigo_frete)}`);
  }

  async function cancelFreight(item: FreightResponse) {
    const justification = window.prompt("Informe a justificativa obrigatória para cancelar este lançamento:");
    if (justification === null) return;
    if (justification.trim().length < 5) {
      window.alert("A justificativa precisa ter pelo menos 5 caracteres.");
      return;
    }
    if (!window.confirm("Cancelar este frete? Ele permanecerá no histórico de auditoria e deixará de compor os pagamentos.")) return;
    setBusyId(item.codigo_frete);
    setError("");
    try {
      await freightsApi.cancel(item.codigo_frete, justification.trim(), crypto.randomUUID());
      setSelected(null);
      setNotice("Frete cancelado e preservado no histórico.");
      setReloadVersion((version) => version + 1);
    } catch (cancelError: unknown) {
      setError(messageFromApiError(cancelError));
      setReloadVersion((version) => version + 1);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={cx(styles, commonStyles, "portal-page", "page-stack", "freight-history-page")}>
      <div className={cx(styles, commonStyles, "breadcrumb")}><span>Fretes</span><span aria-hidden="true">/</span><strong>Histórico</strong></div>
      <header className={cx(styles, commonStyles, "page-heading-row", "freight-heading")}>
        <div><p className={cx(styles, commonStyles, "eyebrow")}>OPERAÇÃO DE TRANSPORTE</p><h1>Histórico de fretes</h1><p className={cx(styles, commonStyles, "page-lead")}>Consulte, edite, cancele ou abra os dados completos dos serviços registrados.</p></div>
        <div className={cx(styles, "heading-actions")}>
          {canViewPayments && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/pagamentos")}>Pagamentos</button>}
          {canCreate && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={() => onNavigate("/fretes")}>+ Lançar frete</button>}
        </div>
      </header>

      {notice && <div className={cx(styles, commonStyles, "notice notice-success")} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Fechar aviso">×</button></div>}

      <section className={cx(styles, "filter-panel")} aria-label="Filtros do histórico">
        <label className={cx(styles, commonStyles, "filter-control")}>Data inicial<input type="date" value={fromDate} onChange={(event) => changeFilter(setFromDate, event.target.value)} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}>Data final<input type="date" value={toDate} onChange={(event) => changeFilter(setToDate, event.target.value)} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}>Tipo de transporte<select value={transportType} onChange={(event) => changeFilter(setTransportType, event.target.value as FreightRecordedTransportType | "TODOS")}><option value="TODOS">Todos</option><option value="AGREGADO">Agregados</option><option value="TRANSPORTADORA">Transportadoras</option></select></label>
        <span className={cx(styles, "result-count")}>{total.toLocaleString("pt-BR")} {total === 1 ? "lançamento" : "lançamentos"}</span>
      </section>

      {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>{error}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReloadVersion((version) => version + 1)}>Tentar novamente</button></div>}

      <section className={cx(styles, "table-card")} aria-label="Lançamentos de frete">
        {loading ? <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />Carregando histórico...</div>
          : items.length === 0 ? <div className={cx(styles, "empty-state")}><span className={cx(styles, commonStyles, "empty-state-icon")}>↗</span><h2>Nenhum frete neste período</h2><p>Altere as datas ou registre um novo serviço.</p>{canCreate && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes")}>Lançar frete</button>}</div>
            : <div className={cx(styles, commonStyles, "data-table-scroll")} role="region" aria-label="Tabela do histórico de fretes" tabIndex={0}><table className={cx(styles, commonStyles, "data-table", "freight-table")}><thead><tr><th>Data</th><th>Transporte / responsável</th><th>Rota e volume</th><th>Hodômetro</th><th>Valores</th><th>Ações</th></tr></thead><tbody>{items.map((item) => <FreightRow
              item={item}
              key={item.id_frete}
              canManage={canCreate}
              busy={busyId === item.codigo_frete}
              onDetails={() => setSelected(item)}
              onEdit={() => startEdit(item)}
              onCancel={() => void cancelFreight(item)}
            />)}</tbody></table></div>}
        {!loading && total > 0 && <footer className={cx(styles, "pagination")}>
          <label className={cx(styles, "page-size-control")}><span>Linhas</span><select aria-label="Fretes por página" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setOffset(0); }}>{pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <span>{offset + 1}–{Math.min(offset + items.length, total)} de {total}</span>
          <div><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={offset + items.length >= total} onClick={() => setOffset(offset + pageSize)}>Próxima</button></div>
        </footer>}
      </section>

      {selected && <FreightDetailsDialog
        item={selected}
        busy={busyId === selected.codigo_frete}
        error={error}
        onClose={() => setSelected(null)}
        onEdit={canCreate && !selected.cancelado && selected.tipo_transporte !== "PROPRIO" ? () => startEdit(selected) : undefined}
        onCancel={canCreate && !selected.cancelado ? () => void cancelFreight(selected) : undefined}
      />}
    </div>
  );
}
