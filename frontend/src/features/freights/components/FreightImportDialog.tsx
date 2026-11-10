import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { messageFromApiError } from "../../../shared/api/apiError";
import { cx } from "../../../shared/styles/classNames";
import commonStyles from "../../../shared/styles/common.module.css";
import { freightsApi } from "../api";
import { parseFreightWorkbook } from "../importWorkbook";
import { formatMoney, formatDate, formatNumber } from "../format";
import type { FreightWorkbookPreview } from "../importWorkbook";
import type { HistoricalFreightImportResponse } from "../types";
import styles from "./FreightImportDialog.module.css";

export type FreightImportCompletion = HistoricalFreightImportResponse & {
  dataDe: string;
  dataAte: string;
  linhasComErro: number;
};

type Props = {
  onClose: () => void;
  onImported: (result: FreightImportCompletion) => void;
};

function formatImportDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
  return formatDate(value);
}

export function FreightImportDialog({ onClose, onImported }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<FreightWorkbookPreview>();
  const [fileName, setFileName] = useState("");
  const [dateFrom, setDateFrom] = useState("2026-11-01");
  const [dateTo, setDateTo] = useState("2026-11-10");
  const [previewPage, setPreviewPage] = useState(0);
  const [previewPageSize, setPreviewPageSize] = useState(10);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSummary, setSaveSummary] = useState("");

  useEffect(() => {
    closeButton.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setPreview(undefined);
    setPreviewPage(0);
    setSaveError("");
    setSaveSummary("");
    setFileName(file?.name ?? "");
    if (!file) return;
    if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".xlsx")) {
      setPreview({ sheetName: "", sha256: "", rows: [], errors: ["Selecione um arquivo .xlsx."] });
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setPreview({ sheetName: "", sha256: "", rows: [], errors: ["O arquivo deve ter no máximo 25 MB."] });
      return;
    }
    setLoadingFile(true);
    try {
      setPreview(await parseFreightWorkbook(file));
    } catch {
      setPreview({ sheetName: "", sha256: "", rows: [], errors: ["Não foi possível ler a planilha. Salve como .xlsx e tente novamente."] });
    } finally {
      setLoadingFile(false);
    }
  }

  async function importValidRows() {
    if (!preview || preview.errors.length || saving || !validDateRange) return;
    if (!validRows.length || invalidRows.length) return;
    setSaving(true);
    setSaveError("");
    setSaveSummary("");
    try {
      const result = await freightsApi.importHistorical({
        nome_arquivo: fileName,
        sha256_arquivo: preview.sha256,
        aba_origem: preview.sheetName,
        itens: validRows.flatMap((row) => row.item ? [row.item] : []),
      });
      onImported({ ...result, dataDe: dateFrom, dataAte: dateTo, linhasComErro: invalidRows.length });
      const message = `${result.importados.toLocaleString("pt-BR")} lançados; ${result.vinculados_agregados.toLocaleString("pt-BR")} vinculados a agregados; ${result.vinculados_transportadoras.toLocaleString("pt-BR")} vinculados a transportadoras independentes; ${result.sem_vinculo.toLocaleString("pt-BR")} sem vínculo e pendentes de conferência; ${result.atualizados.toLocaleString("pt-BR")} pendências concluídas; ${result.ja_existentes.toLocaleString("pt-BR")} já estavam importados.`;
      setSaveSummary(message);
      onClose();
    } catch (error) {
      setSaveError(messageFromApiError(error));
    } finally {
      setSaving(false);
    }
  }

  const validDateRange = Boolean(dateFrom && dateTo && dateFrom <= dateTo);
  const rowsInPeriod = preview?.rows.filter((row) => {
    if (!validDateRange) return false;
    const rowDate = row.item?.data_servico ?? (/^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : "");
    return Boolean(rowDate && rowDate >= dateFrom && rowDate <= dateTo);
  }) ?? [];
  const rowsOutsidePeriod = preview?.rows.filter((row) => {
    if (!validDateRange) return false;
    const rowDate = row.item?.data_servico ?? (/^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : "");
    return Boolean(rowDate && (rowDate < dateFrom || rowDate > dateTo));
  }) ?? [];
  const rowsWithoutReadableDate = preview?.rows.filter((row) => {
    const rowDate = row.item?.data_servico ?? (/^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : "");
    return !rowDate;
  }) ?? [];
  const validRows = rowsInPeriod.filter((row) => row.item && row.errors.length === 0);
  const previewPageCount = Math.max(1, Math.ceil(validRows.length / previewPageSize));
  const currentPreviewPage = Math.min(previewPage, previewPageCount - 1);
  const visiblePreviewRows = validRows.slice(
    currentPreviewPage * previewPageSize,
    (currentPreviewPage + 1) * previewPageSize,
  );
  const firstPreviewRow = validRows.length ? currentPreviewPage * previewPageSize + 1 : 0;
  const lastPreviewRow = Math.min((currentPreviewPage + 1) * previewPageSize, validRows.length);
  const rowsToReview = [...rowsInPeriod, ...rowsWithoutReadableDate];
  const invalidRows = rowsToReview.filter((row) => !row.item || row.errors.length > 0);
  const canImport = Boolean(preview && !preview.errors.length && validDateRange && validRows.length && invalidRows.length === 0 && !saving);

  return (
    <div className={cx(styles, commonStyles, "dialog-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className={cx(styles, commonStyles, "detail-dialog", "freight-import-dialog")} role="dialog" aria-modal="true" aria-labelledby="freight-import-title">
        <div className={cx(styles, commonStyles, "dialog-heading", "freight-import-heading")}>
          <div className={cx(styles, "freight-import-title-group")}>
            <span className={cx(styles, "freight-import-mark")} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M7 3.75h7l4.25 4.3v11.2c0 .55-.45 1-1 1h-10.5c-.55 0-1-.45-1-1v-14.5c0-.55.45-1 1-1Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M14 4v4.5h4.1M8.5 12h7M8.5 15.5h7M8.5 9h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </span>
            <div><p className={cx(styles, commonStyles, "eyebrow")}>IMPORTAÇÃO HISTÓRICA</p><h2 id="freight-import-title">Importar fretes da planilha</h2><p>Envie um XLSX e revise os registros antes de gravar.</p></div>
          </div>
          <button ref={closeButton} className={cx(styles, commonStyles, "icon-button", "dialog-close")} type="button" aria-label="Fechar importação" onClick={onClose} disabled={saving}>×</button>
        </div>
        <div className={cx(styles, "freight-import-content")}>
          <label className={cx(styles, "freight-import-file", fileName ? "freight-import-file-selected" : "")}>
            <input aria-label="Selecionar planilha XLSX" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void selectFile(event)} disabled={loadingFile || saving} />
            <span className={cx(styles, "freight-import-file-icon")} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 14.5v3.75c0 .97.78 1.75 1.75 1.75h10.5c.97 0 1.75-.78 1.75-1.75V14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
            <span className={cx(styles, "freight-import-file-copy")}><strong>{fileName || "Selecione a planilha de fretes"}</strong><span>{fileName ? "Clique para trocar o arquivo" : "Formato .xlsx · até 25 MB"}</span></span>
            <span className={cx(styles, "freight-import-file-action")}>{fileName ? "Trocar arquivo" : "Escolher arquivo"}</span>
          </label>

          <section className={cx(styles, "freight-import-range")} aria-label="Período da importação">
            <div className={cx(styles, "freight-import-range-heading")}><strong>Período que será lançado</strong><span>Somente linhas dentro destas datas serão enviadas.</span></div>
            <label className={cx(styles, commonStyles, "filter-control")}>Data inicial<input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPreviewPage(0); }} disabled={saving} /></label>
            <label className={cx(styles, commonStyles, "filter-control")}>Data final<input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPreviewPage(0); }} disabled={saving} /></label>
          </section>
          {!validDateRange && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">Informe um período válido: a data inicial deve ser anterior ou igual à data final.</div>}

          {loadingFile && <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />Lendo e validando a planilha...</div>}
          {preview && !loadingFile && <>
            {preview.errors.map((error) => <div className={cx(styles, commonStyles, "notice notice-error")} role="alert" key={error}>{error}</div>)}
            {preview.rows.length > 0 && <>
              <div className={cx(styles, "freight-import-summary")} role="status">
                <article><span>Linhas lidas</span><strong>{preview.rows.length.toLocaleString("pt-BR")}</strong><small>Aba {preview.sheetName}</small></article>
                <article className={cx(styles, "freight-import-summary-range")}><span>No período selecionado</span><strong>{rowsInPeriod.length.toLocaleString("pt-BR")}</strong><small>{rowsOutsidePeriod.length.toLocaleString("pt-BR")} fora do período e não serão enviadas</small></article>
                <article className={cx(styles, "freight-import-summary-ready")}><span>Prontas para importar</span><strong>{validRows.length.toLocaleString("pt-BR")}</strong><small>Campos em branco são aceitos</small></article>
                <article className={cx(styles, invalidRows.length ? "freight-import-summary-errors" : "freight-import-summary-clear")}><span>Erros no período / data ilegível</span><strong>{invalidRows.length.toLocaleString("pt-BR")}</strong><small>{invalidRows.length ? "Corrija as linhas incluídas antes de gravar" : "Nenhuma linha com erro"}</small></article>
              </div>
              <p className={cx(styles, "freight-import-help")}>Campos em branco serão mantidos como “não informado”; frete bruto ausente, avaria acima do bruto ou responsável não identificado fica pendente. Só linhas com data dentro do período serão gravadas. Linhas com data ilegível ficam em revisão porque não é possível confirmar se pertencem ao intervalo.</p>
              {validDateRange && rowsInPeriod.length === 0 && rowsWithoutReadableDate.length === 0 && <p className={cx(styles, "freight-import-no-matches")}>Nenhuma linha da planilha está dentro deste período. Ajuste as datas para localizar os lançamentos que deseja importar.</p>}
              {invalidRows.length > 0 && <>
                <div className={cx(styles, "freight-import-section-heading")}><h3>Linhas no período ou com data ilegível</h3><p>Corrija os valores destacados para importar todas as linhas selecionadas.</p></div>
                <div className={cx(styles, commonStyles, "data-table-scroll", "freight-import-error-scroll")} role="region" aria-label="Linhas com erros de validação" tabIndex={0}>
                  <table className={cx(styles, commonStyles, "data-table", "freight-import-table")}><thead><tr><th>Linha</th><th>Data</th><th>Transportador</th><th>Rota</th><th>Problemas</th></tr></thead><tbody>
                    {invalidRows.slice(0, 60).map((row) => <tr key={row.line}><td>{row.line}</td><td>{row.date || "—"}</td><td>{row.transporter || "—"}</td><td>{row.route || "—"}</td><td>{row.errors.join(" ")}</td></tr>)}
                  </tbody></table>
                  {invalidRows.length > 60 && <small>Exibindo as 60 primeiras de {invalidRows.length} linhas com erro.</small>}
                </div>
              </>}
              {validRows.length > 0 && <>
                <div className={cx(styles, "freight-import-section-heading")}><h3>Prévia dos lançamentos</h3><p>Uma linha por frete; use a paginação para avançar.</p></div>
                <div className={cx(styles, "freight-import-preview-wrap")} role="region" aria-label="Prévia paginada dos lançamentos prontos" tabIndex={0}>
                  <table className={cx(styles, commonStyles, "data-table", "freight-import-table", "freight-import-preview-table")}><colgroup><col /><col /><col /><col /><col /><col /></colgroup><thead><tr><th>Data / linha</th><th>Responsável</th><th>Rota / cidade</th><th>Volume</th><th>Hodômetro</th><th>Valores históricos</th></tr></thead><tbody>
                    {visiblePreviewRows.map((row) => <tr key={row.line}>
                      <td><strong>{formatImportDate(row.date)}</strong><small>Linha {row.line}{row.dateInferred ? " · ano inferido" : ""}</small></td>
                      <td className={cx(styles, "freight-import-preview-truncate")} title={row.transporter || "Não informado"}>{row.transporter || "Não informado"}</td>
                      <td className={cx(styles, "freight-import-preview-truncate")} title={row.route || "Não informada"}>{row.route || "Não informada"}</td>
                      <td><strong>{row.deliveries || "—"} ent. · {row.weight ? `${row.weight} kg` : "— kg"}</strong></td>
                      <td><strong>{formatNumber(row.item?.km_rodado)} km rod.</strong><small>{formatNumber(row.item?.km_inicial)} → {formatNumber(row.item?.km_final)}</small></td>
                      <td><strong>Bruto {row.item?.valor_frete_bruto === null ? "Pendente" : formatMoney(row.item?.valor_frete_bruto ?? null)} · pago {formatMoney(row.item?.valor_frete_pago)}</strong><small>Nota {formatMoney(row.item?.valor_nota)} · avaria {formatMoney(row.item?.valor_avaria)} · {row.item?.percentual_frete === null ? "—" : `${(Number(row.item?.percentual_frete ?? 0) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`}</small></td>
                    </tr>)}
                  </tbody></table>
                </div>
                <div className={cx(styles, "freight-import-preview-pagination")}>
                  <label>Linhas por página<select aria-label="Linhas da prévia por página" value={previewPageSize} onChange={(event) => { setPreviewPageSize(Number(event.target.value)); setPreviewPage(0); }}><option value={10}>10</option><option value={20}>20</option></select></label>
                  <span>{firstPreviewRow}–{lastPreviewRow} de {validRows.length.toLocaleString("pt-BR")}</span>
                  <div><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={currentPreviewPage === 0} onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}>Anterior</button><span>Página {currentPreviewPage + 1} de {previewPageCount}</span><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={currentPreviewPage + 1 >= previewPageCount} onClick={() => setPreviewPage((page) => Math.min(previewPageCount - 1, page + 1))}>Próxima</button></div>
                </div>
              </>}
              {saveSummary && <div className={cx(styles, commonStyles, "notice notice-success")} role="status">{saveSummary}</div>}
            </>}
          </>}
          {saveError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">Não foi possível importar: {saveError}</div>}
        </div>
        <div className={cx(styles, commonStyles, "dialog-footer", "freight-import-footer")}>
          <span>Valores históricos são preservados; a tarifa atual não é aplicada. Só o período selecionado será enviado.</span>
          <div className={cx(styles, commonStyles, "dialog-actions")}>
            <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={onClose} disabled={saving}>Fechar</button>
            <button className={cx(styles, commonStyles, "button button-primary", "freight-import-submit")} type="button" onClick={() => void importValidRows()} disabled={!canImport}>{saving ? "Importando..." : `Importar ${validRows.length.toLocaleString("pt-BR")} linhas`}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
