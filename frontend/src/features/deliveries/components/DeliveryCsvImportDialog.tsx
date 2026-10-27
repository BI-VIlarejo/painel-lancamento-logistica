import styles from "./DeliveryCsvImportDialog.module.css";
import commonStyles from "../../../shared/styles/common.module.css";
import { cx } from "../../../shared/styles/classNames";
import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { catalogsApi } from "../../catalogs/api";
import { messageFromApiError } from "../../../shared/api/apiError";
import { deliveriesApi } from "../api";
import type {
  DeliveryDraftRequest,
  DeliveryItemInput,
  LocalityCatalogItem,
  NonDeliveryReasonCatalogItem,
  PersonCatalogItem,
} from "../types";

type CsvCatalogs = {
  localities: LocalityCatalogItem[];
  drivers: PersonCatalogItem[];
  helpers: PersonCatalogItem[];
  reasons: NonDeliveryReasonCatalogItem[];
};

type CsvRecord = { line: number; cells: string[] };

type CsvPreviewRow = {
  line: number;
  date: string;
  locality: string;
  driver: string;
  completed: string;
  notCompleted: string;
  errors: string[];
};

type CsvPreview = {
  payload?: DeliveryDraftRequest;
  rows: CsvPreviewRow[];
  errors: string[];
};

const templateHeader = [
  "data_entrega",
  "loja",
  "motorista",
  "ajudante_1",
  "ajudante_2",
  "quantidade_realizada",
  "quantidade_nao_realizada",
  "motivos",
  "observacoes_motivos",
];

const acceptedSectorValues = new Set(["suporte", "entregas", "entregas diarias"]);

const headerAliases: Record<string, string> = {
  data: "data_entrega",
  data_entrega: "data_entrega",
  setor: "setor",
  codigo_setor: "setor",
  loja: "codigo_localidade",
  filial: "codigo_localidade",
  localidade: "codigo_localidade",
  codigo_localidade: "codigo_localidade",
  motorista: "motorista",
  ajudante_1: "ajudante_1",
  entregador_1: "ajudante_1",
  entregador1: "ajudante_1",
  ajudante_2: "ajudante_2",
  entregador_2: "ajudante_2",
  entregador2: "ajudante_2",
  quantidade_realizada: "quantidade_realizada",
  realizadas: "quantidade_realizada",
  quantidade_de_realizadas_pelo_motorista: "quantidade_realizada",
  quantidade_realizadas_pelo_motorista: "quantidade_realizada",
  quantidade_realizada_pelo_motorista: "quantidade_realizada",
  quantidade_nao_realizada: "quantidade_nao_realizada",
  nao_realizadas: "quantidade_nao_realizada",
  quantidade_de_nao_realizadas_pelo_motorista: "quantidade_nao_realizada",
  quantidade_de_nao_realizada_pelo_motorista: "quantidade_nao_realizada",
  quantidade_de_nao_relizada_pelo_motorista: "quantidade_nao_realizada",
  quantidade_nao_realizadas_pelo_motorista: "quantidade_nao_realizada",
  quantidade_nao_realizada_pelo_motorista: "quantidade_nao_realizada",
  quantidade_entregas_no_prazo: "quantidade_entregas_no_prazo",
  entregas_no_prazo: "quantidade_entregas_no_prazo",
  quantidade_entregas_completas: "quantidade_entregas_completas",
  entregas_completas: "quantidade_entregas_completas",
  motivos: "motivos",
  motivo: "motivos",
  observacoes_motivos: "observacoes_motivos",
  observacoes_dos_motivos: "observacoes_motivos",
  observacao_motivos: "observacoes_motivos",
  observacao: "observacao",
  observacoes: "observacao",
};

function normalize(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function normalizeHeader(value: string): string {
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
    if (character === '"' && firstLine[index + 1] === '"' && quoted) {
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      commas += 1;
    } else if (!quoted && character === ";") {
      semicolons += 1;
    }
  }
  return semicolons >= commas ? ";" : ",";
}

function parseCsv(text: string, delimiter: string): CsvRecord[] {
  const rows: CsvRecord[] = [];
  let row: string[] = [];
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
      } else if (quoted || value.length === 0) {
        quoted = !quoted;
      } else {
        value += character;
      }
    } else if (!quoted && character === delimiter) {
      row.push(value);
      value = "";
    } else if (character === "\n" || character === "\r") {
      const isCrLf = character === "\r" && text[index + 1] === "\n";
      if (quoted) {
        value += isCrLf ? "\r\n" : character;
        if (isCrLf) index += 1;
        line += 1;
        continue;
      }
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push({ line: recordLine, cells: row });
      row = [];
      value = "";
      if (isCrLf) index += 1;
      line += 1;
      recordLine = line;
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error("Há uma aspa sem fechamento no arquivo CSV.");
  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) rows.push({ line: recordLine, cells: row });
  return rows;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeDate(value: string): string | undefined {
  if (validDate(value)) return value;
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value.trim());
  if (!match) return undefined;
  const iso = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return validDate(iso) ? iso : undefined;
}

function quantity(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647 ? parsed : undefined;
}

function resolvePerson(value: string, options: PersonCatalogItem[]): { person?: PersonCatalogItem; error?: string } {
  if (!value) return {};
  const matches = /^\d+$/.test(value)
    ? options.filter((item) => item.id_pessoa === Number(value))
    : options.filter((item) => normalize(item.nome_exibicao) === normalize(value));
  if (matches.length === 1) return { person: matches[0] };
  if (matches.length > 1) return { error: `"${value}" corresponde a mais de uma pessoa; use o ID no CSV.` };
  return { error: `Pessoa "${value}" não encontrada no cadastro ativo.` };
}

function parsePreview(text: string, catalogs: CsvCatalogs): CsvPreview {
  let records: CsvRecord[];
  try {
    records = parseCsv(text.replace(/^\uFEFF/, ""), delimiterFor(text));
  } catch (error) {
    return { rows: [], errors: [error instanceof Error ? error.message : "Não foi possível ler o arquivo CSV."] };
  }

  if (records.length < 2) return { rows: [], errors: ["O arquivo precisa ter o cabeçalho e ao menos uma linha de entrega."] };

  const headers = records[0].cells.map(normalizeHeader);
  const required = ["data_entrega", "motorista", "quantidade_realizada", "quantidade_nao_realizada"];
  const allowed = [
    ...required,
    "setor",
    "codigo_localidade",
    "ajudante_1",
    "ajudante_2",
    // Aceita cabeçalhos antigos de importação, mas ignora essas contagens legadas.
    "quantidade_entregas_no_prazo",
    "quantidade_entregas_completas",
    "motivos",
    "observacoes_motivos",
    "observacao",
  ];
  const missing = required.filter((header) => !headers.includes(header));
  if (!headers.includes("codigo_localidade")) missing.push("loja");
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  const unexpected = headers.filter((header) => !allowed.includes(header));
  if (missing.length || duplicates.length || unexpected.length) {
    return {
      rows: [],
      errors: [
        ...(missing.length ? [`Colunas obrigatórias ausentes: ${missing.join(", ")}.`] : []),
        ...(duplicates.length ? [`Colunas repetidas: ${[...new Set(duplicates)].join(", ")}.`] : []),
        ...(unexpected.length ? [`Colunas não reconhecidas: ${[...new Set(unexpected)].join(", ")}.`] : []),
      ],
    };
  }

  const column = (name: string) => headers.indexOf(name);
  const rows: CsvPreviewRow[] = [];
  const items: DeliveryItemInput[] = [];
  const globalErrors: string[] = [];

  records.slice(1).forEach(({ cells, line }) => {
    const get = (name: string) => (cells[column(name)] ?? "").trim();
    const rawDate = get("data_entrega");
    const date = normalizeDate(rawDate) ?? rawDate;
    const localityValue = get("codigo_localidade");
    const driverValue = get("motorista");
    const completedValue = get("quantidade_realizada");
    const notCompletedValue = get("quantidade_nao_realizada");
    const previewRow: CsvPreviewRow = {
      line,
      date,
      locality: localityValue,
      driver: driverValue,
      completed: completedValue,
      notCompleted: notCompletedValue,
      errors: [],
    };
    rows.push(previewRow);

    const sectorValue = get("setor");
    if (sectorValue && !acceptedSectorValues.has(normalize(sectorValue))) {
      previewRow.errors.push(`setor: "${sectorValue}" não corresponde ao setor fixo Suporte.`);
    }

    if (!validDate(date)) previewRow.errors.push("data_entrega: valor inválido; use AAAA-MM-DD ou DD/MM/AAAA.");
    const localityMatches = catalogs.localities.filter((item) => normalize(item.nome_localidade) === normalize(localityValue) || normalize(item.codigo_localidade) === normalize(localityValue));
    const locality = localityMatches.length === 1 ? localityMatches[0] : undefined;
    if (!locality) previewRow.errors.push(localityMatches.length > 1 ? `loja: "${localityValue}" ambígua; confira o nome no cadastro.` : `loja: "${localityValue}" não encontrada.`);

    const driverMatch = resolvePerson(driverValue, catalogs.drivers);
    if (!driverMatch.person) previewRow.errors.push(`motorista: ${driverMatch.error ?? "informe o motorista."}`);

    const helperValues = [{ field: "ajudante_1", value: get("ajudante_1") }, { field: "ajudante_2", value: get("ajudante_2") }].filter((item) => item.value);
    const helperMatches = helperValues.map(({ field, value }) => ({ field, value, ...resolvePerson(value, catalogs.helpers) }));
    helperMatches.forEach((match) => { if (!match.person) previewRow.errors.push(`${match.field}: ${match.error ?? "ajudante inválido."}`); });
    const teamTypes = [driverMatch.person, ...helperMatches.map((match) => match.person)]
      .filter((person): person is PersonCatalogItem => Boolean(person))
      .map((person) => person.tipo_transporte_entrega);
    if (teamTypes.some((type) => type === null)) {
      previewRow.errors.push("motorista/ajudantes: classifique todas as pessoas como Entregas próprias ou terceirizadas.");
    } else if (new Set(teamTypes).size > 1) {
      previewRow.errors.push("motorista/ajudantes: a equipe precisa ter um único tipo de entrega.");
    }

    const completed = quantity(completedValue);
    const notCompleted = quantity(notCompletedValue);
    if (completed === undefined) previewRow.errors.push("quantidade_realizada: informe um inteiro não negativo.");
    if (notCompleted === undefined) previewRow.errors.push("quantidade_nao_realizada: informe um inteiro não negativo.");
    if (completed !== undefined && notCompleted !== undefined && completed + notCompleted === 0) {
      previewRow.errors.push("quantidade_realizada/quantidade_nao_realizada: informe ao menos uma entrega.");
    }

    const reasonValue = get("motivos");
    if (get("observacao")) previewRow.errors.push("observacao: informe o texto por motivo na coluna observacoes_motivos.");
    const reasonObservationValue = get("observacoes_motivos");
    const reasons: DeliveryItemInput["motivos"] = [];
    if (notCompleted !== undefined && notCompleted === 0 && reasonValue) {
      previewRow.errors.push("motivos: remova os motivos quando quantidade_nao_realizada for zero.");
    } else if (notCompleted !== undefined && notCompleted > 0 && !reasonValue) {
      previewRow.errors.push("motivos: informe no formato descrição:quantidade.");
    } else if (reasonValue) {
      const reasonEntries = reasonValue.split("|").map((entry) => entry.trim()).filter(Boolean);
      for (const entry of reasonEntries) {
        const separator = entry.lastIndexOf(":");
        const explicitAmount = separator >= 0 ? quantity(entry.slice(separator + 1).trim()) : undefined;
        const useWholeReasonAsLabel = reasonEntries.length === 1 && notCompleted !== undefined && notCompleted > 0 && explicitAmount === undefined;
        const amount = useWholeReasonAsLabel ? notCompleted : explicitAmount;
        const resolvedReasonLabel = useWholeReasonAsLabel || separator < 0 ? entry : entry.slice(0, separator).trim();
        const resolvedMatches = catalogs.reasons.filter((item) => normalize(item.descricao_motivo) === normalize(resolvedReasonLabel) || normalize(item.codigo_motivo) === normalize(resolvedReasonLabel));
        if (!resolvedReasonLabel || amount === undefined || amount <= 0 || resolvedMatches.length !== 1) {
          previewRow.errors.push(`motivos: "${entry}" inválido ou não encontrado; use código ou descrição:quantidade.`);
          continue;
        }
        if (!resolvedMatches[0].grupo_motivo) {
          previewRow.errors.push(`motivos: classifique o grupo de "${resolvedReasonLabel}" antes de importar.`);
        }
        reasons.push({ id_motivo_nao_entrega: resolvedMatches[0].id_motivo_nao_entrega, quantidade: amount, observacao: null });
      }
      if (new Set(reasons.map((reason) => reason.id_motivo_nao_entrega)).size !== reasons.length) {
        previewRow.errors.push("motivos: cada motivo deve aparecer uma vez por linha.");
      }
    }
    if (reasonObservationValue) {
      const reasonObservations = reasonObservationValue.split("|").map((value) => value.trim());
      if (reasonObservations.length !== reasons.length) {
        previewRow.errors.push("observacoes_motivos: informe uma observação por motivo, na mesma ordem, separadas por |.");
      } else {
        reasonObservations.forEach((observation, index) => {
          if (observation.length > 5000) {
            previewRow.errors.push(`observacoes_motivos: a observação ${index + 1} não pode ultrapassar 5.000 caracteres.`);
          } else if (reasons[index]) {
            reasons[index].observacao = observation || null;
          }
        });
      }
    }
    if (notCompleted !== undefined && reasons.reduce((sum, reason) => sum + reason.quantidade, 0) !== notCompleted) {
      previewRow.errors.push("motivos: a soma das quantidades deve igualar quantidade_nao_realizada.");
    }

    const participants: DeliveryItemInput["participantes"] = [];
    if (driverMatch.person) participants.push({ id_pessoa: driverMatch.person.id_pessoa, papel_participante: "MOTORISTA" });
    helperMatches.forEach((match) => {
      if (match.person) participants.push({ id_pessoa: match.person.id_pessoa, papel_participante: "AJUDANTE" });
    });
    if (new Set(participants.map((person) => person.id_pessoa)).size !== participants.length) {
      previewRow.errors.push("motorista/ajudantes: uma pessoa não pode ocupar dois papéis na mesma linha.");
    }

    if (
      (!sectorValue || acceptedSectorValues.has(normalize(sectorValue))) && locality && validDate(date) && completed !== undefined && notCompleted !== undefined &&
      driverMatch.person && helperMatches.every((match) => match.person) && previewRow.errors.length === 0
    ) {
      items.push({
        data_entrega: date,
        id_localidade: locality.id_localidade,
        quantidade_realizada: completed,
        quantidade_nao_realizada: notCompleted,
        participantes: participants,
        motivos: reasons,
      });
    }
  });

  if (rows.length > 100) globalErrors.push("O CSV pode ter no máximo 100 linhas de entrega por importação.");
  if (rows.some((row) => row.errors.length > 0)) globalErrors.push("Corrija os erros indicados antes de importar; nenhuma linha foi gravada.");

  const canImport = rows.length > 0 && rows.length <= 100 && globalErrors.length === 0 && items.length === rows.length;
  return {
    rows,
    errors: globalErrors,
    ...(canImport ? { payload: { itens: items } } : {}),
  };
}

function downloadTemplate(): void {
  const content = `\uFEFF${templateHeader.join(";")}\r\n`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "modelo-importacao-entregas.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DeliveryCsvImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [catalogs, setCatalogs] = useState<CsvCatalogs>();
  const [catalogError, setCatalogError] = useState("");
  const [preview, setPreview] = useState<CsvPreview>();
  const [fileName, setFileName] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      catalogsApi.localities(),
      catalogsApi.people("MOTORISTA"),
      catalogsApi.people("AJUDANTE"),
      catalogsApi.reasons(),
    ])
      .then(([localities, drivers, helpers, reasons]) => {
        if (active) setCatalogs({ localities: localities.items, drivers: drivers.items, helpers: helpers.items, reasons: reasons.items });
      })
      .catch((error: unknown) => { if (active) setCatalogError(messageFromApiError(error)); });
    return () => { active = false; };
  }, []);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setPreview(undefined);
    setSaveError("");
    setFileName(file?.name ?? "");
    if (!file || !catalogs) return;
    setLoadingFile(true);
    try {
      const text = await file.text();
      setPreview(parsePreview(text, catalogs));
    } catch {
      setPreview({ rows: [], errors: ["Não foi possível ler este arquivo. Salve-o como CSV UTF-8 e tente novamente."] });
    } finally {
      setLoadingFile(false);
    }
  }

  async function importCsv() {
    if (!preview?.payload) return;
    setSaving(true);
    setSaveError("");
    try {
      await deliveriesApi.createDraft(preview.payload, crypto.randomUUID());
      onImported();
    } catch (error) {
      setSaveError(messageFromApiError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cx(styles, commonStyles, "dialog-backdrop csv-import-backdrop")} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={cx(styles, commonStyles, "detail-dialog csv-import-dialog")} role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
        <div className={cx(styles, commonStyles, "dialog-heading")}>
          <div><p className={cx(styles, commonStyles, "eyebrow")}>HISTÓRICO DE ENTREGAS</p><h2 id="csv-import-title">Importar CSV como rascunho</h2></div>
          <button className={cx(styles, commonStyles, "icon-button dialog-close")} type="button" aria-label="Fechar importação" onClick={onClose}>×</button>
        </div>
        <p className={cx(styles, commonStyles, "csv-import-description")}>O CSV histórico de Entregas pode ser validado antes de criar um rascunho. Importamos até 100 linhas por vez; nenhuma linha é gravada se houver erro.</p>

        <div className={cx(styles, commonStyles, "csv-template-help")}>
          <div><strong>Prepare o arquivo</strong><span>Novos lançamentos ficam vinculados ao setor Suporte. O histórico também pode informar Entregas como setor de origem. Datas aceitam AAAA-MM-DD ou DD/MM/AAAA. Um motivo sem quantidade recebe o total não realizado; para vários motivos, informe CODIGO_MOTIVO:QUANTIDADE e separe com |. Se preencher observações, use uma por motivo, na mesma ordem, na coluna observacoes_motivos; a coluna antiga observacao não é aceita em novos lançamentos.</span></div>
          <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={downloadTemplate}>Baixar modelo CSV</button>
        </div>
        <p className={cx(styles, commonStyles, "csv-template-columns")}><strong>Colunas:</strong> {templateHeader.join(" · ")}</p>
          <p className={cx(styles, commonStyles, "csv-template-columns")}><strong>Motorista, entregadores e loja:</strong> use os nomes do cadastro. Também aceitamos as colunas do histórico (“Data”, “Loja”, “Entregador 1/2” e quantidades pelo motorista).</p>

        {catalogError ? <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">Não foi possível carregar os cadastros necessários: {catalogError}</div> : !catalogs ? (
          <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Carregando cadastros para validar o CSV...</div>
        ) : (
          <label className={cx(styles, commonStyles, "csv-file-control")}><span>Arquivo CSV</span><input type="file" accept=".csv,text/csv" onChange={(event) => void selectFile(event)} /><small>{fileName || "Selecione um arquivo .csv"}</small></label>
        )}

        {loadingFile && <div className={cx(styles, commonStyles, "history-loading")}><span className={cx(styles, commonStyles, "spinner spinner-green")} /> Lendo e validando o arquivo...</div>}
        {preview && !loadingFile && <>
          <div className={cx(styles, commonStyles, `csv-import-summary${preview.payload ? " csv-import-valid" : " csv-import-invalid"}`)} role="status">
            <strong>{preview.payload ? `${preview.rows.length} linhas prontas para importar` : "O arquivo ainda tem erros"}</strong>
            <span>{preview.payload ? "Será criado um rascunho para conferência; depois você confirma o lançamento." : `${preview.rows.length} linhas lidas; corrija os problemas antes de gravar.`}</span>
          </div>
          {preview.errors.map((error) => <p className={cx(styles, commonStyles, "csv-import-error")} key={error}>{error}</p>)}
          {preview.rows.length > 0 && <div className={cx(styles, commonStyles, "csv-preview-scroll")}><table className={cx(styles, commonStyles, "csv-preview-table")}><thead><tr><th>Linha</th><th>Data</th><th>Localidade</th><th>Motorista</th><th>Realizadas</th><th>Não realizadas</th><th>Validação</th></tr></thead><tbody>
            {preview.rows.slice(0, 15).map((row) => <tr className={cx(styles, commonStyles, row.errors.length ? "csv-row-error" : "")} key={row.line}><td>{row.line}</td><td>{row.date || "—"}</td><td>{row.locality || "—"}</td><td>{row.driver || "—"}</td><td>{row.completed || "0"}</td><td>{row.notCompleted || "0"}</td><td>{row.errors.length ? row.errors.join(" ") : "Pronta"}</td></tr>)}
          </tbody></table>{preview.rows.length > 15 && <small>Exibindo as 15 primeiras de {preview.rows.length} linhas.</small>}</div>}
        </>}

        {saveError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">Não foi possível importar: {saveError}</div>}
        <div className={cx(styles, commonStyles, "dialog-footer")}><span>Importações respeitam seu acesso por setor e localidade.</span><div className={cx(styles, commonStyles, "dialog-actions")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={() => void importCsv()} disabled={!preview?.payload || saving}>{saving ? "Gravando rascunho..." : "Importar como rascunho"}</button></div></div>
      </section>
    </div>
  );
}
