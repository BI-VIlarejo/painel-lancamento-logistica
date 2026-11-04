import { useEffect, useState } from "react";
import { freightsApi } from "../api";
import { formatDate, formatMoney, formatNumber, firstDayOfCurrentMonth, localDateValue } from "../format";
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

function FreightRow({ item }: { item: FreightResponse }) {
  return <tr>
    <td><strong>{formatDate(item.data_servico)}</strong></td>
    <td><strong>{transportTypeLabel(item.tipo_transporte)}</strong><small>{transportName(item)}</small></td>
    <td><strong>{item.rota_cidade}</strong><small>{item.quantidade_entregas.toLocaleString("pt-BR")} entregas · {formatNumber(item.peso_kg)} kg</small></td>
    <td>{item.tipo_transporte === "TRANSPORTADORA" ? <span>Não se aplica</span> : <><strong>{formatNumber(item.km_rodado)} km</strong><small>Inicial {formatNumber(item.km_inicial)} · Final {formatNumber(item.km_final)}</small></>}</td>
    <td><strong>{formatMoney(item.valor_frete_bruto)}</strong><small>{item.quantidade_avarias} avarias · Valor da avaria {formatMoney(item.valor_avaria)} · Líquido {formatMoney(item.valor_frete_pago)}</small></td>
  </tr>;
}

/** Lista os lançamentos de frete com seus dados operacionais e valores. */
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
      .then((page) => { if (active) { setItems(page.items); setTotal(page.total); } })
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

  return (
    <div className={cx(styles, commonStyles, "portal-page", "page-stack", "freight-history-page")}>
      <div className={cx(styles, commonStyles, "breadcrumb")}><span>Fretes</span><span aria-hidden="true">/</span><strong>Histórico</strong></div>
      <header className={cx(styles, commonStyles, "page-heading-row", "freight-heading")}>
        <div><p className={cx(styles, commonStyles, "eyebrow")}>OPERAÇÃO DE TRANSPORTE</p><h1>Histórico de fretes</h1><p className={cx(styles, commonStyles, "page-lead")}>Consulte os serviços, responsáveis, rotas e valores registrados por modalidade.</p></div>
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
            : <div className={cx(styles, commonStyles, "data-table-scroll")} role="region" aria-label="Tabela do histórico de fretes" tabIndex={0}><table className={cx(styles, commonStyles, "data-table freight-table")}><thead><tr><th>Data</th><th>Transporte / responsável</th><th>Rota e volume</th><th>Hodômetro</th><th>Valores</th></tr></thead><tbody>{items.map((item) => <FreightRow item={item} key={item.id_frete} />)}</tbody></table></div>}
        {!loading && total > 0 && <footer className={cx(styles, "pagination")}>
          <label className={cx(styles, "page-size-control")}><span>Linhas</span><select aria-label="Fretes por página" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setOffset(0); }}>{pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <span>{offset + 1}–{Math.min(offset + items.length, total)} de {total}</span>
          <div><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</button><span>Página {currentPage} de {pageCount}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={offset + items.length >= total} onClick={() => setOffset(offset + pageSize)}>Próxima</button></div>
        </footer>}
      </section>
    </div>
  );
}
