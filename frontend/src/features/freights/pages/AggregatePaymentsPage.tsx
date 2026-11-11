import { useEffect, useState } from "react";
import { freightsApi } from "../api";
import { firstDayOfCurrentMonth, formatDate, formatMoney, localDateValue } from "../format";
import { messageFromApiError } from "../../../shared/api/apiError";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import type {
  FreightPaymentFilters,
  FreightPaymentOptions,
  FreightPaymentReport,
  FreightPaymentTransportType,
} from "../types";
import styles from "./AggregatePaymentsPage.module.css";

type Props = { canExport: boolean; canViewFreights: boolean; canEditFreights: boolean; onNavigate: (path: string) => void };
const UNIDENTIFIED = "__SEM_IDENTIFICACAO__";

function compactDate(value: string): string {
  return value.replaceAll("-", "");
}

function safeFilePart(value: string): string {
  return value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function responsibleList(options: FreightPaymentOptions | null, type: FreightPaymentTransportType): string[] {
  if (!options) return [];
  return type === "AGREGADO" ? options.agregados : options.transportadoras;
}

function responsibleLabel(
  selection: string,
  type: FreightPaymentTransportType,
): string {
  if (selection === UNIDENTIFIED) return "Sem identificação";
  if (selection) return selection;
  return type === "AGREGADO" ? "Todos os agregados" : "Todas as transportadoras";
}

/** Consolida pagamentos de agregados ou transportadoras pelo responsável selecionado. */
export function AggregatePaymentsPage({ canExport, canViewFreights, canEditFreights, onNavigate }: Props) {
  const [fromDate, setFromDate] = useState(firstDayOfCurrentMonth());
  const [toDate, setToDate] = useState(localDateValue());
  const [transportType, setTransportType] = useState<FreightPaymentTransportType>("AGREGADO");
  const [responsible, setResponsible] = useState("");
  const [options, setOptions] = useState<FreightPaymentOptions | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [report, setReport] = useState<FreightPaymentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let active = true;
    if (!fromDate || !toDate || fromDate > toDate) {
      setOptions(null);
      setOptionsLoading(false);
      setOptionsError("");
      return () => { active = false; };
    }
    setOptionsLoading(true);
    setOptions(null);
    setOptionsError("");
    void freightsApi.paymentOptions(fromDate, toDate)
      .then((result) => {
        if (!active) return;
        setOptions(result);
        setResponsible((current) => {
          if (current === UNIDENTIFIED) {
            return transportType === "AGREGADO" && result.agregados_sem_identificacao ? current : "";
          }
          return current && responsibleList(result, transportType).includes(current) ? current : "";
        });
      })
      .catch((loadError: unknown) => { if (active) setOptionsError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setOptionsLoading(false); });
    return () => { active = false; };
  }, [fromDate, toDate, transportType]);

  useEffect(() => {
    let active = true;
    if (!fromDate || !toDate || fromDate > toDate) {
      setError(fromDate && toDate ? "A data inicial deve ser anterior à data final." : "Informe a data inicial e a data final.");
      setLoading(false);
      setReport(null);
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    setReport(null);
    const filters: FreightPaymentFilters = {
      data_de: fromDate,
      data_ate: toDate,
      tipo_transporte: transportType,
      ...(responsible === UNIDENTIFIED
        ? { sem_identificacao: true }
        : responsible ? { nome_transportador: responsible } : {}),
    };
    void freightsApi.paymentReport(filters)
      .then((result) => { if (active) setReport(result); })
      .catch((loadError: unknown) => { if (active) setError(messageFromApiError(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fromDate, toDate, transportType, responsible, reloadVersion]);

  const hasPending = Boolean(report?.quantidade_pendentes);
  const canDownload = Boolean(report) && canExport && !loading && !optionsLoading && !hasPending;
  const selectedResponsibleLabel = responsibleLabel(responsible, transportType);

  async function exportReport() {
    if (!canDownload || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const filters: FreightPaymentFilters = {
        data_de: fromDate,
        data_ate: toDate,
        tipo_transporte: transportType,
        ...(responsible === UNIDENTIFIED
          ? { sem_identificacao: true }
          : responsible ? { nome_transportador: responsible } : {}),
      };
      const blob = await freightsApi.exportPaymentReport(filters);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      const typePart = transportType === "AGREGADO" ? "agregados" : "transportadoras";
      const responsiblePart = safeFilePart(selectedResponsibleLabel);
      link.download = `solicitacao-pagamento-${typePart}-${responsiblePart}-${compactDate(fromDate)}-${compactDate(toDate)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (exportFailure: unknown) {
      setExportError(messageFromApiError(exportFailure));
    } finally {
      setExporting(false);
    }
  }

  const responsibleOptions = responsibleList(options, transportType);
  const transportTypeLabel = transportType === "AGREGADO" ? "Agregado" : "Transportadora independente";

  return (
    <div className={cx(styles, commonStyles, "portal-page", "page-stack", "aggregate-payments-page")}>
      <div className={cx(styles, commonStyles, "breadcrumb")}><span>Fretes</span><span aria-hidden="true">/</span><strong>Pagamentos</strong></div>
      <header className={cx(styles, commonStyles, "page-heading-row", "aggregate-heading")}>
        <div><p className={cx(styles, commonStyles, "eyebrow")}>FECHAMENTO FINANCEIRO</p><h1>Pagamentos de transporte</h1><p className={cx(styles, commonStyles, "page-lead")}>Consulte e exporte o fechamento de cada agregado ou transportadora independente.</p></div>
        <div className={cx(styles, "heading-actions")}>
          {canViewFreights && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => onNavigate("/fretes/historico")}>Histórico de fretes</button>}
          {canExport && <button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={() => { void exportReport(); }} disabled={!canDownload || exporting}>{exporting ? "Gerando XLSX..." : "Baixar solicitação XLSX"}</button>}
        </div>
      </header>

      <section className={cx(styles, "report-filter")} aria-label="Filtros do relatório">
        <div><span className={cx(styles, "filter-mark")}>⌁</span><div><strong>Fechamento por responsável</strong><small>Os valores consideram a data do serviço e o responsável selecionado.</small></div></div>
        <label className={cx(styles, commonStyles, "filter-control")}>Data inicial<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setResponsible(""); }} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}>Data final<input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setResponsible(""); }} /></label>
        <label className={cx(styles, commonStyles, "filter-control")}>Tipo de transporte
          <select value={transportType} onChange={(event) => { setTransportType(event.target.value as FreightPaymentTransportType); setResponsible(""); }}>
            <option value="AGREGADO">Agregados</option>
            <option value="TRANSPORTADORA">Transportadoras independentes</option>
          </select>
        </label>
        <label className={cx(styles, commonStyles, "filter-control")}>{transportType === "AGREGADO" ? "Agregado" : "Transportadora"}
          <select value={responsible} onChange={(event) => setResponsible(event.target.value)} disabled={optionsLoading}>
            <option value="">{transportType === "AGREGADO" ? "Todos os agregados" : "Todas as transportadoras"}</option>
            {transportType === "AGREGADO" && options?.agregados_sem_identificacao && <option value={UNIDENTIFIED}>Sem identificação</option>}
            {responsibleOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </section>

      {optionsError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{optionsError}</div>}
      {error && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert"><span>{error}</span>{fromDate && toDate && fromDate <= toDate && <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={() => setReloadVersion((version) => version + 1)}>Tentar novamente</button>}</div>}
      {exportError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">{exportError}</div>}
      {hasPending && <div className={cx(styles, commonStyles, "notice notice-warning")} role="status">Resolva os {report?.quantidade_pendentes.toLocaleString("pt-BR")} fretes pendentes antes de exportar o pagamento. Os valores mostrados não incluem esses fretes.</div>}
      {hasPending && report?.pendencias && <section className={cx(styles, "pending-card")} aria-labelledby="payment-pending-heading">
        <h2 id="payment-pending-heading">Fretes que precisam de correção</h2>
        <p>Confira o motivo e os valores de cada lançamento antes de exportar.</p>
        <div className={cx(styles, commonStyles, "data-table-scroll")} role="region" aria-label="Detalhes dos fretes pendentes" tabIndex={0}>
          <table className={cx(styles, commonStyles, "data-table", "pending-table")}>
            <thead><tr><th>Data</th><th>Responsável / rota</th><th>Motivo da pendência</th><th>Valores do frete</th>{canEditFreights && <th>Ação</th>}</tr></thead>
            <tbody>{report.pendencias.map((item) => <tr key={item.codigo_frete}>
              <td>{formatDate(item.data_servico)}</td>
              <td><strong>{item.nome_transportador || "Sem identificação"}</strong><small>{item.rota_cidade || "Rota não informada"}</small></td>
              <td>{item.motivo_pendencia}</td>
              <td><small>Bruto: {item.valor_frete_bruto === null ? "Não informado" : formatMoney(item.valor_frete_bruto)}</small><small>Avaria: {formatMoney(item.valor_avaria)}</small><small>Líquido: {item.valor_frete_pago === null ? "Não informado" : formatMoney(item.valor_frete_pago)}</small></td>
              {canEditFreights && <td><button type="button" className={cx(styles, commonStyles, "button button-secondary", "warning-action")} onClick={() => onNavigate(`/fretes/${encodeURIComponent(item.codigo_frete)}`)}>Corrigir</button></td>}
            </tr>)}</tbody>
          </table>
        </div>
      </section>}
      {Boolean(report?.avisos?.length) && <section className={cx(styles, "informational-card")} aria-labelledby="payment-warning-heading">
        <h2 id="payment-warning-heading">Dados ausentes no histórico · não bloqueiam a exportação</h2>
        <p>Os valores calculados ou líquidos informados são mantidos. Os campos abaixo só serão necessários se for preciso recalcular o frete pela tarifa.</p>
        <div className={cx(styles, commonStyles, "data-table-scroll")} role="region" aria-label="Dados informativos ausentes" tabIndex={0}>
          <table className={cx(styles, commonStyles, "data-table", "pending-table")}>
            <thead><tr><th>Data</th><th>Responsável / rota</th><th>Campos não informados</th><th>Observação</th>{canEditFreights && <th>Ação</th>}</tr></thead>
            <tbody>{report?.avisos?.map((item) => <tr key={item.codigo_frete}>
              <td>{formatDate(item.data_servico)}</td>
              <td><strong>{item.nome_transportador || "Sem identificação"}</strong><small>{item.rota_cidade || "Rota não informada"}</small></td>
              <td>{item.campos_ausentes.join(", ")}</td>
              <td>{item.motivo_aviso}</td>
              {canEditFreights && <td><button type="button" className={cx(styles, commonStyles, "button button-secondary", "warning-action")} onClick={() => onNavigate(`/fretes/${encodeURIComponent(item.codigo_frete)}`)}>Corrigir</button></td>}
            </tr>)}</tbody>
          </table>
        </div>
      </section>}
      {loading ? <div className={cx(styles, commonStyles, "loading-card")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />Calculando o relatório...</div>
        : report && !error && <>
          <section className={cx(styles, "summary-grid")} aria-label="Resumo do período">
            <article className={cx(styles, "summary-card")}><span>Fretes no período</span><strong>{report.quantidade_fretes.toLocaleString("pt-BR")}</strong><small>{report.quantidade_pendentes ? `${report.quantidade_pendentes.toLocaleString("pt-BR")} bloqueiam o envio` : "Valores disponíveis para o pagamento"}</small></article>
            <article className={cx(styles, "summary-card")}><span>Frete bruto informado</span><strong>{formatMoney(report.valor_frete_bruto)}</strong><small>Veja os avisos se faltar valor bruto histórico</small></article>
            <article className={cx(styles, "summary-card")}><span>Valor das avarias (R$)</span><strong>{formatMoney(report.valor_avarias)}</strong><small>Descontos registrados no período</small></article>
            <article className={cx(styles, "summary-card", "summary-payable")}><span>Total a pagar</span><strong>{formatMoney(report.valor_a_pagar)}</strong><small>Após os descontos por avaria</small></article>
          </section>
          <section className={cx(styles, "report-card")} aria-label={`Resumo de pagamento: ${selectedResponsibleLabel}`}>
            <header><div><h2>{transportTypeLabel} · {selectedResponsibleLabel}</h2><p>Consolidado pela data do serviço para exportação individual do responsável.</p></div>{canExport && hasPending && <span className={cx(styles, "export-blocked")}>XLSX indisponível até resolver as pendências</span>}</header>
            {report.quantidade_fretes === 0 ? <div className={cx(styles, "empty-report")}><span className={cx(styles, commonStyles, "empty-state-icon")}>＋</span><div><strong>Sem fretes para este filtro no período</strong><p>Altere o período, a modalidade ou o responsável.</p></div></div>
              : <div className={cx(styles, commonStyles, "data-table-scroll")} role="region" aria-label="Resumo de pagamentos por responsável" tabIndex={0}><table className={cx(styles, commonStyles, "data-table report-table")}><thead><tr><th>Tipo de transporte / responsável</th><th>Fretes</th><th>Frete bruto calculado</th><th>Valor das avarias (R$)</th><th>Total a pagar</th></tr></thead><tbody><tr><td><strong>{transportTypeLabel}</strong><small>{selectedResponsibleLabel}</small></td><td>{report.quantidade_fretes.toLocaleString("pt-BR")}{report.quantidade_pendentes > 0 && <small>{report.quantidade_pendentes.toLocaleString("pt-BR")} pendentes</small>}</td><td>{formatMoney(report.valor_frete_bruto)}</td><td>{formatMoney(report.valor_avarias)}</td><td><strong>{formatMoney(report.valor_a_pagar)}</strong></td></tr></tbody></table></div>}
          </section>
        </>}
    </div>
  );
}
