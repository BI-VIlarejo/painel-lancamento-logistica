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
  SectorCatalogItem,
} from "../types";

type CsvCatalogs = {
  sectors: SectorCatalogItem[];
  localities: LocalityCatalogItem[];
  drivers: PersonCatalogItem[];
  helpers: PersonCatalogItem[];
  reasons: NonDeliveryReasonCatalogItem[];
};

type CsvPreviewRow = {
  line: number;
  date: string;
  locality: string;
  driver: string;
  completed: string;
  notCompleted: string;
  onTime: string;
  inFull: string;
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
  "quantidade_entregas_no_prazo",
  "quantidade_entregas_completas",
  "motivos",
  "observacao",
];

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

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

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
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error("Há uma aspa sem fechamento no arquivo CSV.");
  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
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
  let records: string[][];
  try {
    records = parseCsv(text.replace(/^\uFEFF/, ""), delimiterFor(text));
  } catch (error) {
    return { rows: [], errors: [error instanceof Error ? error.message : "Não foi possível ler o arquivo CSV."] };
  }

  if (records.length < 2) return { rows: [], errors: ["O arquivo precisa ter o cabeçalho e ao menos uma linha de entrega."] };

  const headers = records[0].map(normalizeHeader);
  const required = ["data_entrega", "motorista", "quantidade_realizada", "quantidade_nao_realizada"];
  const allowed = [
    ...required,
    "setor",
    "codigo_localidade",
    "ajudante_1",
    "ajudante_2",
    "quantidade_entregas_no_prazo",
    "quantidade_entregas_completas",
    "motivos",
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
  const sectorIds = new Set<number>();
  const globalErrors: string[] = [];

  records.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const get = (name: string) => (cells[column(name)] ?? "").trim();
    const rawDate = get("data_entrega");
    const date = normalizeDate(rawDate) ?? rawDate;
    const localityValue = get("codigo_localidade");
    const driverValue = get("motorista");
    const completedValue = get("quantidade_realizada");
    const notCompletedValue = get("quantidade_nao_realizada");
    const onTimeValue = get("quantidade_entregas_no_prazo");
    const inFullValue = get("quantidade_entregas_completas");
    const previewRow: CsvPreviewRow = {
      line,
      date,
      locality: localityValue,
      driver: driverValue,
      completed: completedValue,
      notCompleted: notCompletedValue,
      onTime: onTimeValue,
      inFull: inFullValue,
      errors: [],
    };
    rows.push(previewRow);

    const sectorValue = get("setor");
    const sectorMatches = catalogs.sectors.filter((item) => {
      const isEntregas = item.codigo === "ENTREGAS" || normalize(item.nome) === "entregas";
      if (!isEntregas) return false;
      return !sectorValue || normalize(item.codigo) === normalize(sectorValue) || normalize(item.nome) === normalize(sectorValue);
    });
    const sector = sectorMatches.length === 1 ? sectorMatches[0] : undefined;
    if (!sector) {
      previewRow.errors.push(
        sectorMatches.length > 1
          ? "O setor Entregas está duplicado no catálogo."
          : sectorValue
            ? `O setor "${sectorValue}" não corresponde ao setor Entregas deste Portal.`
            : "O setor Entregas não está cadastrado ou disponível no seu acesso.",
      );
    } else {
      sectorIds.add(sector.id_setor);
    }

    if (!validDate(date)) previewRow.errors.push("Data inválida; use AAAA-MM-DD ou DD/MM/AAAA.");
    const localityMatches = catalogs.localities.filter((item) => normalize(item.nome_localidade) === normalize(localityValue) || normalize(item.codigo_localidade) === normalize(localityValue));
    const locality = localityMatches.length === 1 ? localityMatches[0] : undefined;
    if (!locality) previewRow.errors.push(localityMatches.length > 1 ? `Loja "${localityValue}" ambígua; confira o nome no cadastro.` : `Loja "${localityValue}" não encontrada.`);

    const driverMatch = resolvePerson(driverValue, catalogs.drivers);
    if (!driverMatch.person) previewRow.errors.push(driverMatch.error ?? "Informe o motorista.");

    const helperValues = [get("ajudante_1"), get("ajudante_2")].filter(Boolean);
    const helperMatches = helperValues.map((value) => ({ value, ...resolvePerson(value, catalogs.helpers) }));
    helperMatches.forEach((match) => { if (!match.person) previewRow.errors.push(match.error ?? "Ajudante inválido."); });

    const completed = quantity(completedValue);
    const notCompleted = quantity(notCompletedValue);
    if (completed === undefined) previewRow.errors.push("Quantidade realizada deve ser um inteiro não negativo.");
    if (notCompleted === undefined) previewRow.errors.push("Quantidade não realizada deve ser um inteiro não negativo.");
    if (completed !== undefined && notCompleted !== undefined && completed + notCompleted === 0) {
      previewRow.errors.push("Informe ao menos uma entrega realizada ou não realizada.");
    }

    let onTime: number | null = null;
    let inFull: number | null = null;
    if (Boolean(onTimeValue) !== Boolean(inFullValue)) {
      previewRow.errors.push("Preencha as duas contagens de OTIF ou deixe ambas vazias.");
    } else if (onTimeValue && inFullValue) {
      const parsedOnTime = quantity(onTimeValue);
      const parsedInFull = quantity(inFullValue);
      if (parsedOnTime === undefined || parsedInFull === undefined) {
        previewRow.errors.push("As contagens de OTIF devem ser inteiros não negativos.");
      } else if (completed !== undefined && (parsedOnTime > completed || parsedInFull > completed)) {
        previewRow.errors.push("As contagens no prazo e completas não podem superar as realizadas.");
      } else {
        onTime = parsedOnTime;
        inFull = parsedInFull;
      }
    }

    const reasonValue = get("motivos");
    if (get("observacao").length > 5000) previewRow.errors.push("A observação não pode ultrapassar 5.000 caracteres.");
    const reasons: DeliveryItemInput["motivos"] = [];
    if (notCompleted !== undefined && notCompleted === 0 && reasonValue) {
      previewRow.errors.push("Não informe motivos quando a quantidade não realizada for zero.");
    } else if (notCompleted !== undefined && notCompleted > 0 && !reasonValue) {
      previewRow.errors.push("Informe os motivos no formato descrição:quantidade.");
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
          previewRow.errors.push(`Motivo "${entry}" inválido ou não encontrado. Use uma descrição ou descrição:quantidade; em vários motivos, informe a quantidade de cada um.`);
          continue;
        }
        reasons.push({ id_motivo_nao_entrega: resolvedMatches[0].id_motivo_nao_entrega, quantidade: amount });
      }
      if (new Set(reasons.map((reason) => reason.id_motivo_nao_entrega)).size !== reasons.length) {
        previewRow.errors.push("Cada motivo deve aparecer uma vez por linha.");
      }
    }
    if (notCompleted !== undefined && reasons.reduce((sum, reason) => sum + reason.quantidade, 0) !== notCompleted) {
      previewRow.errors.push("A soma dos motivos deve igualar a quantidade não realizada.");
    }

    const participants: DeliveryItemInput["participantes"] = [];
    if (driverMatch.person) participants.push({ id_pessoa: driverMatch.person.id_pessoa, papel_participante: "MOTORISTA" });
    helperMatches.forEach((match) => {
      if (match.person) participants.push({ id_pessoa: match.person.id_pessoa, papel_participante: "AJUDANTE" });
    });
    if (new Set(participants.map((person) => person.id_pessoa)).size !== participants.length) {
      previewRow.errors.push("Uma pessoa não pode ocupar dois papéis na mesma linha.");
    }

    if (
      sector && locality && validDate(date) && completed !== undefined && notCompleted !== undefined &&
      driverMatch.person && helperMatches.every((match) => match.person) && previewRow.errors.length === 0
    ) {
      items.push({
        data_entrega: date,
        id_localidade: locality.id_localidade,
        quantidade_realizada: completed,
        quantidade_nao_realizada: notCompleted,
        quantidade_entregas_no_prazo: onTime,
        quantidade_entregas_completas: inFull,
        observacao: get("observacao") || null,
        participantes: participants,
        motivos: reasons,
      });
    }
  });

  if (rows.length > 100) globalErrors.push("O CSV pode ter no máximo 100 linhas de entrega por importação.");
  if (sectorIds.size > 1) globalErrors.push("Cada arquivo deve conter lançamentos de um único setor.");
  if (rows.some((row) => row.errors.length > 0)) globalErrors.push("Corrija os erros indicados antes de importar; nenhuma linha foi gravada.");

  const sectorId = sectorIds.size === 1 ? [...sectorIds][0] : undefined;
  const canImport = rows.length > 0 && rows.length <= 100 && sectorId !== undefined && globalErrors.length === 0 && items.length === rows.length;
  return {
    rows,
    errors: globalErrors,
    ...(canImport && sectorId !== undefined ? { payload: { id_setor: sectorId, itens: items } } : {}),
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
      catalogsApi.sectors(),
      catalogsApi.localities(),
      catalogsApi.people("MOTORISTA"),
      catalogsApi.people("AJUDANTE"),
      catalogsApi.reasons(),
    ])
      .then(([sectors, localities, drivers, helpers, reasons]) => {
        if (active) setCatalogs({ sectors: sectors.items, localities: localities.items, drivers: drivers.items, helpers: helpers.items, reasons: reasons.items });
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
          <div><strong>Prepare o arquivo</strong><span>O setor é fixo como Entregas. Datas aceitam AAAA-MM-DD ou DD/MM/AAAA. Um motivo sem quantidade recebe o total não realizado; para vários motivos, informe CODIGO_MOTIVO:QUANTIDADE e separe com |. As duas colunas OTIF são opcionais.</span></div>
          <button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={downloadTemplate}>Baixar modelo CSV</button>
        </div>
        <p className={cx(styles, commonStyles, "csv-template-columns")}><strong>Colunas:</strong> {templateHeader.join(" · ")}</p>
          <p className={cx(styles, commonStyles, "csv-template-columns")}><strong>Motorista, entregadores e loja:</strong> use os nomes do cadastro. Também aceitamos as colunas do histórico (“Data”, “Loja”, “Entregador 1/2” e quantidades pelo motorista). <strong>OTIF:</strong> informe as duas contagens ou deixe ambas vazias.</p>

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
          {preview.rows.length > 0 && <div className={cx(styles, commonStyles, "csv-preview-scroll")}><table className={cx(styles, commonStyles, "csv-preview-table")}><thead><tr><th>Linha</th><th>Data</th><th>Localidade</th><th>Motorista</th><th>Realizadas</th><th>Não realizadas</th><th>No prazo</th><th>Completas</th><th>Validação</th></tr></thead><tbody>
            {preview.rows.slice(0, 15).map((row) => <tr className={cx(styles, commonStyles, row.errors.length ? "csv-row-error" : "")} key={row.line}><td>{row.line}</td><td>{row.date || "—"}</td><td>{row.locality || "—"}</td><td>{row.driver || "—"}</td><td>{row.completed || "0"}</td><td>{row.notCompleted || "0"}</td><td>{row.onTime || "—"}</td><td>{row.inFull || "—"}</td><td>{row.errors.length ? row.errors.join(" ") : "Pronta"}</td></tr>)}
          </tbody></table>{preview.rows.length > 15 && <small>Exibindo as 15 primeiras de {preview.rows.length} linhas.</small>}</div>}
        </>}

        {saveError && <div className={cx(styles, commonStyles, "notice notice-error")} role="alert">Não foi possível importar: {saveError}</div>}
        <div className={cx(styles, commonStyles, "dialog-footer")}><span>Importações respeitam seu acesso por setor e localidade.</span><div className={cx(styles, commonStyles, "dialog-actions")}><button className={cx(styles, commonStyles, "button button-secondary")} type="button" onClick={onClose} disabled={saving}>Cancelar</button><button className={cx(styles, commonStyles, "button button-primary")} type="button" onClick={() => void importCsv()} disabled={!preview?.payload || saving}>{saving ? "Gravando rascunho..." : "Importar como rascunho"}</button></div></div>
      </section>
    </div>
  );
}
