import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import styles from "../pages/FeedbackPage.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { messageFromApiError } from "../../../shared/api/apiError";
import { feedbackApi } from "../api";
import type { FeedbackCreateInput, FeedbackImportRequest } from "../types";

type ParsedRow = {
  line: number;
  date: string;
  type: string;
  launch: string;
  revision: string;
  itemCode: string;
  errors: string[];
  item?: FeedbackCreateInput;
};

type Preview = {
  rows: ParsedRow[];
  errors: string[];
  payload?: FeedbackImportRequest;
};

type CsvRecord = { line: number; cells: string[] };

const templateHeader = [
  "data_feedback",
  "tipo",
  "nome_cliente",
  "codigo_lancamento",
  "codigo_revisao",
  "codigo_item_lancamento",
  "relato",
];

const headerAliases: Record<string, string> = {
  cliente: "nome_cliente",
  data_manifestacao: "data_feedback",
  descricao: "relato",
};

function normalize(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function header(value: string): string {
  const key = normalize(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return headerAliases[key] ?? key;
}

function delimiterFor(text: string): ";" | "," {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let index = 0; index < firstLine.length; index += 1) {
    const character = firstLine[index];
    if (character === '"' && firstLine[index + 1] === '"' && quoted) index += 1;
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ",") commas += 1;
    else if (!quoted && character === ";") semicolons += 1;
  }
  return semicolons >= commas ? ";" : ",";
}

function parseRecords(text: string, delimiter: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (quoted || value.length === 0) quoted = !quoted;
      else value += character;
    } else if (!quoted && character === delimiter) {
      cells.push(value);
      value = "";
    } else if (character === "\n" || character === "\r") {
      const isCrLf = character === "\r" && text[index + 1] === "\n";
      if (quoted) {
        value += isCrLf ? "\r\n" : character;
        if (isCrLf) index += 1;
        line += 1;
        continue;
      }
      cells.push(value);
      if (cells.some((cell) => cell.trim())) records.push({ line: recordLine, cells });
      cells = [];
      value = "";
      if (isCrLf) index += 1;
      line += 1;
      recordLine = line;
    } else value += character;
  }
  if (quoted) throw new Error("O CSV tem uma aspa sem fechamento.");
  cells.push(value);
  if (cells.some((cell) => cell.trim())) records.push({ line: recordLine, cells });
  return records;
}

function normalizeDate(value: string): string | undefined {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === text ? text : undefined;
  }
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (!match) return undefined;
  const iso = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}

function normalizeType(value: string): FeedbackCreateInput["tipo"] | undefined {
  const normalized = normalize(value).replace(/[^a-z]/g, "");
  if (normalized === "reclamacao") return "RECLAMACAO";
  if (normalized === "elogio") return "ELOGIO";
  return undefined;
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parsePreview(text: string): Preview {
  let records: CsvRecord[];
  try {
    records = parseRecords(text.replace(/^\uFEFF/, ""), delimiterFor(text));
  } catch (error) {
    return { rows: [], errors: [error instanceof Error ? error.message : "Não foi possível ler o CSV."] };
  }
  if (records.length < 2) return { rows: [], errors: ["O CSV precisa ter cabeçalho e ao menos uma manifestação."] };

  const headers = records[0].cells.map(header);
  const missing = templateHeader.filter((name) => !headers.includes(name));
  const duplicates = headers.filter((name, index) => headers.indexOf(name) !== index);
  const unexpected = headers.filter((name) => !templateHeader.includes(name));
  const errors = [
    ...(missing.length ? [`Colunas obrigatórias ausentes: ${missing.join(", ")}.`] : []),
    ...(duplicates.length ? [`Colunas repetidas: ${[...new Set(duplicates)].join(", ")}.`] : []),
    ...(unexpected.length ? [`Colunas não reconhecidas: ${[...new Set(unexpected)].join(", ")}.`] : []),
  ];
  if (errors.length) return { rows: [], errors };

  const indexOf = (name: string) => headers.indexOf(name);
  const rows: ParsedRow[] = records.slice(1).map(({ cells, line }) => {
    const get = (name: string) => (cells[indexOf(name)] ?? "").trim();
    const rawDate = get("data_feedback");
    const date = normalizeDate(rawDate);
    const rawType = get("tipo");
    const type = normalizeType(rawType);
    const customerName = get("nome_cliente");
    const launch = get("codigo_lancamento");
    const revision = get("codigo_revisao");
    const itemCode = get("codigo_item_lancamento");
    const report = get("relato");
    const rowErrors: string[] = [];

    if (cells.length !== headers.length) rowErrors.push("linha: quantidade de campos diferente do cabeçalho.");
    if (!date) rowErrors.push("data_feedback: valor inválido; use AAAA-MM-DD ou DD/MM/AAAA.");
    if (!type) rowErrors.push("tipo: informe RECLAMACAO ou ELOGIO.");
    if (!customerName) rowErrors.push("nome_cliente: informe o nome do cliente.");
    else if (customerName.length > 160) rowErrors.push("nome_cliente: limite de 160 caracteres excedido.");
    if (!validUuid(launch)) rowErrors.push("codigo_lancamento: informe um UUID válido.");
    if (!validUuid(revision)) rowErrors.push("codigo_revisao: informe um UUID válido.");
    if (!validUuid(itemCode)) rowErrors.push("codigo_item_lancamento: informe um UUID válido.");
    if (report.length < 5 || report.length > 5000) rowErrors.push("relato: informe entre 5 e 5.000 caracteres.");

    const item = date && type && customerName.length > 0 && customerName.length <= 160 && validUuid(launch) && validUuid(revision) && validUuid(itemCode) && report.length >= 5 && report.length <= 5000 && cells.length === headers.length
      ? {
          data_feedback: date,
          tipo: type,
          nome_cliente: customerName,
          codigo_lancamento: launch,
          codigo_revisao: revision,
          codigo_item_lancamento: itemCode,
          relato: report,
        }
      : undefined;
    return { line, date: date ?? rawDate, type: type ?? rawType, launch, revision, itemCode, errors: rowErrors, ...(item ? { item } : {}) };
  });

  if (rows.length > 100) errors.push("O CSV pode ter no máximo 100 manifestações por importação.");
  if (rows.every((row) => row.errors.length === 0) && rows.length <= 100) {
    return { rows, errors, payload: { rows: rows.flatMap((row) => row.item ? [{ line: row.line, item: row.item }] : []) } };
  }
  return { rows, errors };
}

function downloadTemplate(): void {
  const csv = `\uFEFF${templateHeader.join(";")}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "modelo-importacao-feedback.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FeedbackCsvImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (count: number) => void }) {
  const [preview, setPreview] = useState<Preview>();
  const [fileName, setFileName] = useState("");
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const importIdempotencyKey = useRef(crypto.randomUUID());
  const validationSequence = useRef(0);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const sequence = validationSequence.current + 1;
    validationSequence.current = sequence;
    event.target.value = "";
    setPreview(undefined);
    setSaveError("");
    setFileName(file?.name ?? "");
    importIdempotencyKey.current = crypto.randomUUID();
    if (!file) {
      setValidating(false);
      return;
    }
    setValidating(true);
    try {
      const parsed = parsePreview(await file.text());
      if (sequence !== validationSequence.current) return;
      if (!parsed.payload) {
        setPreview(parsed);
        return;
      }
      try {
        const previewPayload = {
          rows: parsed.payload.rows.map(({ line, item }) => ({
            line,
            item: {
              data_feedback: item.data_feedback,
              tipo: item.tipo,
              codigo_lancamento: item.codigo_lancamento,
              codigo_revisao: item.codigo_revisao,
              codigo_item_lancamento: item.codigo_item_lancamento,
            },
          })),
        };
        const serverPreview = await feedbackApi.previewImport(previewPayload);
        if (sequence !== validationSequence.current) return;
        const checks = new Map(serverPreview.rows.map((row) => [row.line, row]));
        const rows = parsed.rows.map((row) => {
          const serverRow = checks.get(row.line);
          return serverRow ? { ...row, errors: serverRow.errors } : row;
        });
        const canImport = serverPreview.rows.length === parsed.payload.rows.length && rows.length === parsed.payload.rows.length && rows.every((row) => checks.has(row.line) && row.errors.length === 0);
        setPreview({ rows, errors: parsed.errors, ...(canImport ? { payload: parsed.payload } : {}) });
      } catch (error) {
        if (sequence === validationSequence.current) {
          setPreview({ ...parsed, payload: undefined, errors: [...parsed.errors, `Não foi possível validar os vínculos no servidor: ${messageFromApiError(error)}`] });
        }
      }
    } catch {
      if (sequence === validationSequence.current) setPreview({ rows: [], errors: ["Não foi possível ler o arquivo. Salve-o como CSV UTF-8 e tente novamente."] });
    } finally {
      if (sequence === validationSequence.current) setValidating(false);
    }
  }

  async function importCsv() {
    if (!preview?.payload) return;
    setSaving(true);
    setSaveError("");
    try {
      const result = await feedbackApi.importCsv(preview.payload, importIdempotencyKey.current);
      onImported(result.imported);
    } catch (error) {
      setSaveError(messageFromApiError(error));
    } finally {
      setSaving(false);
    }
  }

  return <div className={cx(styles, commonStyles, "dialog-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section className={cx(styles, commonStyles, "feedback-form-dialog")} role="dialog" aria-modal="true" aria-labelledby="feedback-import-title">
      <div className={cx(styles, commonStyles, "detail-heading")}>
        <div><p className={cx(styles, commonStyles, "feedback-eyebrow")}>IMPORTAÇÃO DE HISTÓRICO</p><h2 id="feedback-import-title">Importar CSV de feedback</h2></div>
        <button className={cx(styles, commonStyles, "icon-button")} type="button" aria-label="Fechar importação" disabled={saving} onClick={onClose}>×</button>
      </div>
      <div className={cx(styles, commonStyles, "feedback-form feedback-import-body")}>
        <p>O arquivo deve relacionar cada manifestação a uma entrega confirmada pelos códigos do lançamento, revisão e item. Importamos até 100 linhas e só gravamos o lote inteiro depois da prévia.</p>
        <div className={cx(styles, commonStyles, "form-privacy-note")}><span aria-hidden="true">i</span>O nome do cliente é obrigatório. Não inclua telefone, documento ou outros identificadores pessoais.</div>
        <div className={cx(styles, commonStyles, "feedback-import-template")}>
          <div><strong>Colunas do modelo</strong><small>{templateHeader.join(" · ")}</small></div>
          <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={downloadTemplate}>Baixar modelo CSV</button>
        </div>
        <p className={cx(styles, commonStyles, "feedback-import-hint")}>O CSV exportado pelo Portal não contém os códigos de relacionamento e não pode ser reimportado diretamente. Como não há um arquivo de origem neste projeto, confirme este modelo com uma amostra anonimizada antes de usar dados históricos.</p>
        <label className={cx(styles, commonStyles, "feedback-import-file")}><span>Arquivo CSV</span><input type="file" accept=".csv,text/csv" onChange={(event) => void selectFile(event)} /><small>{fileName || "Selecione um arquivo .csv"}</small></label>
        {validating && <div className={cx(styles, commonStyles, "feedback-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} />Lendo o arquivo e conferindo as entregas...</div>}
        {preview && !validating && <>
          <div className={cx(styles, commonStyles, `feedback-import-summary${preview.payload ? " feedback-import-valid" : ""}`)} role="status">
            <strong>{preview.payload ? `${preview.rows.length} linhas prontas para importar` : "A prévia encontrou problemas"}</strong>
            <span>{preview.rows.length} linhas lidas; nomes e relatos não são exibidos na prévia.</span>
          </div>
          {preview.errors.map((error) => <p className={cx(styles, commonStyles, "feedback-import-error")} key={error}>{error}</p>)}
          {preview.rows.length > 0 && <div className={cx(styles, commonStyles, "feedback-import-table-scroll")}><table className={cx(styles, commonStyles, "feedback-import-table")}><thead><tr><th>Linha</th><th>Data</th><th>Tipo</th><th>Vínculo</th><th>Validação</th></tr></thead><tbody>
            {preview.rows.slice(0, 20).map((row) => <tr key={row.line} className={row.errors.length ? cx(styles, commonStyles, "feedback-import-row-error") : undefined}><td>{row.line}</td><td>{row.date || "—"}</td><td>{row.type || "—"}</td><td>{row.itemCode || "—"}</td><td>{row.errors.length ? row.errors.join(" ") : "Pronta"}</td></tr>)}
          </tbody></table>{preview.rows.length > 20 && <small>Exibindo as 20 primeiras de {preview.rows.length} linhas.</small>}</div>}
        </>}
        {saveError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">Não foi possível importar: {saveError}</div>}
        <div className={cx(styles, commonStyles, "form-actions")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" disabled={saving} onClick={onClose}>Cancelar</button><button className={cx(styles, commonStyles, "button button-primary")} type="button" disabled={!preview?.payload || saving} onClick={() => void importCsv()}>{saving ? "Importando..." : "Importar manifestações"}</button></div>
      </div>
    </section>
  </div>;
}
