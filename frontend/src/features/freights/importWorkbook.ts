import { Workbook } from "exceljs";
import type { Worksheet } from "exceljs";
import type { HistoricalFreightImportItem } from "./types";

export type FreightImportPreviewRow = {
  line: number;
  date: string;
  dateInferred: boolean;
  transporter: string;
  route: string;
  deliveries: string;
  weight: string;
  gross: string;
  paid: string;
  percentage: string;
  errors: string[];
  item?: HistoricalFreightImportItem;
};

export type FreightWorkbookPreview = {
  sheetName: string;
  sha256: string;
  rows: FreightImportPreviewRow[];
  errors: string[];
};

type HeaderKey =
  | "data_servico"
  | "nome_transportador"
  | "rota_cidade"
  | "km_inicial"
  | "km_final"
  | "km_rodado"
  | "quantidade_entregas"
  | "peso_kg"
  | "valor_nota"
  | "valor_frete_bruto"
  | "valor_frete_pago"
  | "percentual_frete"
  | "valor_avaria";

type ParsedDecimal = { value: string | null; error?: string };

const headerAliases: Record<string, HeaderKey> = {
  data: "data_servico",
  data_servico: "data_servico",
  transportador: "nome_transportador",
  motorista: "nome_transportador",
  agregado: "nome_transportador",
  nome_transportador: "nome_transportador",
  rota: "rota_cidade",
  cidade: "rota_cidade",
  rota_cidade: "rota_cidade",
  km_inicial: "km_inicial",
  km_final: "km_final",
  km_rodado: "km_rodado",
  entrega: "quantidade_entregas",
  entregas: "quantidade_entregas",
  quantidade_entregas: "quantidade_entregas",
  peso: "peso_kg",
  peso_kg: "peso_kg",
  valor: "valor_nota",
  nota: "valor_nota",
  valor_nota: "valor_nota",
  r_frete: "valor_frete_bruto",
  frete_bruto: "valor_frete_bruto",
  valor_frete: "valor_frete_bruto",
  valor_frete_bruto: "valor_frete_bruto",
  r_frete_pag: "valor_frete_pago",
  r_frete_pago: "valor_frete_pago",
  frete_pago: "valor_frete_pago",
  valor_frete_pago: "valor_frete_pago",
  frete: "percentual_frete",
  percentual_frete: "percentual_frete",
  percentual_do_frete: "percentual_frete",
  r_avaria: "valor_avaria",
  avaria: "valor_avaria",
  valor_avaria: "valor_avaria",
};

const requiredHeaders: HeaderKey[] = ["data_servico"];

function normalizeText(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function headerKey(value: unknown): HeaderKey | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return headerAliases[normalized];
}

function rawCellValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const cellValue = value as { result?: unknown; text?: unknown; formula?: unknown; sharedFormula?: unknown; richText?: Array<{ text?: string }> };
  if (("formula" in cellValue || "sharedFormula" in cellValue) && !("result" in cellValue)) return null;
  if ("result" in cellValue) return cellValue.result;
  if (Array.isArray(cellValue.richText)) return cellValue.richText.map((part) => part.text ?? "").join("");
  if (typeof cellValue.text === "string") return cellValue.text;
  return value;
}

function cellText(value: unknown): string {
  const raw = rawCellValue(value);
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

function normalizeDecimalText(value: string): string | undefined {
  let normalized = value.replace(/[\s\u00a0]/g, "").replace(/[R$%]/gi, "").replace(/[^\d,.-]/g, "");
  normalized = normalized.replace(/,{2,}/g, ",");
  if (!normalized || !/^[+-]?[\d.,]+$/.test(normalized)) return undefined;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = normalized.replace(/,/g, ".");
  } else if ((normalized.match(/\./g) ?? []).length > 1) {
    const parts = normalized.split(".");
    const decimalPart = parts.pop() ?? "";
    normalized = parts.join("") + (decimalPart ? `.${decimalPart}` : "");
  }
  if (!/^[+-]?(?:\d+)(?:\.\d+)?$/.test(normalized)) return undefined;
  return normalized;
}

function parseDecimal(
  rawValue: unknown,
  label: string,
  decimals: number,
  blankValue: string | null,
  maxDigits = 14,
  roundExcessDecimals = false,
  allowNegative = false,
): ParsedDecimal {
  const raw = rawCellValue(rawValue);
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return blankValue === null
      ? { value: null }
      : { value: blankValue };
  }
  const normalized = normalizeDecimalText(String(raw));
  if (!normalized) return { value: null, error: `${label}: valor numérico inválido.` };
  let value = Number(normalized);
  if (!Number.isFinite(value) || (value < 0 && !allowNegative)) return { value: null, error: `${label}: informe um número igual ou maior que zero.` };
  let parsedValue = normalized;
  const [, fraction = ""] = normalized.replace(/^[+-]/, "").split(".");
  if (fraction.length > decimals) {
    if (!roundExcessDecimals) return { value: null, error: `${label}: use no máximo ${decimals} casas decimais.` };
    parsedValue = value.toFixed(decimals);
    value = Number(parsedValue);
  }
  const [integerPart = "", parsedFraction = ""] = parsedValue.replace(/^[+-]/, "").split(".");
  const digitCount = integerPart.replace(/^0+/, "").length + parsedFraction.length;
  if (digitCount > maxDigits) return { value: null, error: `${label}: valor excede o limite de dígitos aceito.` };
  return { value: parsedValue.replace(/^\+/, "") };
}

function parseQuantity(rawValue: unknown): { value?: number | null; error?: string } {
  const parsed = parseDecimal(rawValue, "ENTREGA", 0, "0");
  if (parsed.error) return { error: parsed.error };
  const value = Number(parsed.value ?? "0");
  if (!Number.isSafeInteger(value) || value > 2_147_483_647) {
    return { error: "ENTREGA: informe um inteiro entre zero e 2.147.483.647." };
  }
  return { value };
}

function parsePercentage(rawValue: unknown): ParsedDecimal {
  const raw = rawCellValue(rawValue);
  const parsed = parseDecimal(raw, "% FRETE", 20, null, 24);
  if (parsed.error || parsed.value === null) return parsed;
  const fraction = Number(parsed.value) / (typeof raw === "string" && raw.includes("%") ? 100 : 1);
  if (!Number.isFinite(fraction)) return { value: null, error: "% FRETE: valor numérico inválido." };
  const rounded = (Math.round((fraction + Number.EPSILON) * 1_000_000) / 1_000_000).toFixed(6);
  return parseDecimal(rounded, "% FRETE", 6, null, 10);
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function dateText(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function parseDate(rawValue: unknown, inferredYear?: number): string | undefined {
  const raw = rawCellValue(rawValue);
  if (raw instanceof Date && !Number.isNaN(raw.valueOf())) {
    const iso = dateText(raw);
    return validIsoDate(iso) ? iso : undefined;
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0 && raw < 100_000) {
    const date = new Date(Math.round((raw - 25_569) * 86_400_000));
    const iso = dateText(date);
    return validIsoDate(iso) ? iso : undefined;
  }
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (validIsoDate(value)) return value;
  const standard = /^(\d{1,2})[/-](\d{1,2})[/-](\d{3,4})$/.exec(value);
  if (standard) {
    const year = standard[3].length === 3
      ? inferredYear?.toString()
      : standard[3];
    if (!year) return undefined;
    const iso = `${year}-${standard[2].padStart(2, "0")}-${standard[1].padStart(2, "0")}`;
    return validIsoDate(iso) ? iso : undefined;
  }
  const compact = /^(\d{1,2})\/(\d{2})(\d{4})$/.exec(value);
  if (!compact) return undefined;
  const iso = `${compact[3]}-${compact[2]}-${compact[1].padStart(2, "0")}`;
  return validIsoDate(iso) ? iso : undefined;
}

function nearestDateYear(
  sheet: Worksheet,
  line: number,
  dateColumn: number,
  direction: -1 | 1,
): number | undefined {
  for (let distance = 1; distance <= 50; distance += 1) {
    const candidateLine = line + distance * direction;
    if (candidateLine < 1 || candidateLine > sheet.rowCount) break;
    const candidate = parseDate(sheet.getRow(candidateLine).getCell(dateColumn).value);
    if (candidate) return Number(candidate.slice(0, 4));
  }
  return undefined;
}

function parseDateForRow(
  sheet: Worksheet,
  line: number,
  dateColumn: number,
): { value?: string; inferred: boolean } {
  const raw = sheet.getRow(line).getCell(dateColumn).value;
  const direct = parseDate(raw);
  if (direct) return { value: direct, inferred: false };
  const text = cellText(raw);
  if (!/^\d{1,2}[/-]\d{1,2}[/-]\d{3}$/.test(text)) return { inferred: false };
  const previousYear = nearestDateYear(sheet, line, dateColumn, -1);
  const nextYear = nearestDateYear(sheet, line, dateColumn, 1);
  if (previousYear === undefined || previousYear !== nextYear) return { inferred: false };
  const inferred = parseDate(raw, previousYear);
  return inferred ? { value: inferred, inferred: true } : { inferred: false };
}

function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", buffer).then((digest) =>
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

function findHeaderRows(workbook: Workbook): Array<{ sheetName: string; headerRow: number; columns: Map<HeaderKey, number> }> {
  const matches: Array<{ sheetName: string; headerRow: number; columns: Map<HeaderKey, number> }> = [];
  for (const sheet of workbook.worksheets) {
    const lastRow = Math.min(sheet.rowCount, 30);
    for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const columns = new Map<HeaderKey, number>();
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const key = headerKey(rawCellValue(cell.value));
        if (key && !columns.has(key)) columns.set(key, columnNumber);
      });
      const matched = requiredHeaders.filter((key) => columns.has(key)).length;
      if (matched === requiredHeaders.length) {
        matches.push({ sheetName: sheet.name, headerRow: rowNumber, columns });
      }
    }
  }
  return matches;
}

function hasContent(sheet: Worksheet, rowNumber: number, columns: Map<HeaderKey, number>): boolean {
  // Pago e percentual são fórmulas de resumo no rodapé; sozinhos, não identificam um serviço.
  const recordFields: HeaderKey[] = [
    "data_servico",
    "nome_transportador",
    "rota_cidade",
    "km_inicial",
    "km_final",
    "km_rodado",
    "quantidade_entregas",
    "peso_kg",
    "valor_nota",
    "valor_frete_bruto",
    "valor_avaria",
  ];
  const row = sheet.getRow(rowNumber);
  return recordFields.some((key) => {
    const column = columns.get(key);
    return column !== undefined && cellText(row.getCell(column).value) !== "";
  });
}

function parseRows(
  sheet: Worksheet,
  headerRow: number,
  columns: Map<HeaderKey, number>,
): FreightImportPreviewRow[] {
  const rows: FreightImportPreviewRow[] = [];
  for (let line = headerRow + 1; line <= sheet.rowCount; line += 1) {
    if (!hasContent(sheet, line, columns)) continue;
    const sourceRow = sheet.getRow(line);
    const cell = (key: HeaderKey) => {
      const column = columns.get(key);
      return column ? sourceRow.getCell(column).value : null;
    };
    const errors: string[] = [];
    const rawDateValue = rawCellValue(cell("data_servico"));
    const rawDate = cellText(rawDateValue);
    const dateColumn = columns.get("data_servico");
    const dateResult: { value?: string; inferred: boolean } = dateColumn
      ? parseDateForRow(sheet, line, dateColumn)
      : { value: undefined, inferred: false };
    const data = dateResult.value;
    if (!data) errors.push("DATA: data inválida; corrija para DD/MM/AAAA ou AAAA-MM-DD.");

    const nomeTransportador = cellText(cell("nome_transportador")).replace(/\s+/g, " ");
    if (nomeTransportador.length > 160) errors.push("TRANSPORTADOR: o nome ultrapassa 160 caracteres.");
    const rotaText = cellText(cell("rota_cidade")).replace(/\s+/g, " ");
    const rotaCidade = rotaText || null;
    if (rotaText.length > 160) errors.push("ROTA/CIDADE: ultrapassa 160 caracteres.");

    const rawDeliveries = cell("quantidade_entregas");
    const deliveries = cellText(rawDeliveries) === ""
      ? { value: null }
      : parseQuantity(rawDeliveries);
    if (deliveries.error) errors.push(deliveries.error);

    const weight = parseDecimal(cell("peso_kg"), "PESO", 3, null, 12, true);
    if (weight.error) errors.push(weight.error);
    const invoice = parseDecimal(cell("valor_nota"), "VALOR", 2, null, 14, true);
    if (invoice.error) errors.push(invoice.error);
    const gross = parseDecimal(cell("valor_frete_bruto"), "R$ FRETE", 2, null, 14, true);
    if (gross.error) errors.push(gross.error);
    const paid = parseDecimal(cell("valor_frete_pago"), "R$ FRETE PAG.", 2, null, 14, true, true);
    if (paid.error) errors.push(paid.error);
    const percentage = parsePercentage(cell("percentual_frete"));
    if (percentage.error) errors.push(percentage.error);
    const damage = parseDecimal(cell("valor_avaria"), "R$ AVARIA", 2, "0", 14, true);
    if (damage.error) errors.push(damage.error);

    const kmInitial = parseDecimal(cell("km_inicial"), "KM INICIAL", 3, null, 12, true);
    const kmFinal = parseDecimal(cell("km_final"), "KM FINAL", 3, null, 12, true);
    const kmSheet = parseDecimal(cell("km_rodado"), "KM RODADO", 3, null, 12, true);
    for (const parsed of [kmInitial, kmFinal, kmSheet]) if (parsed.error) errors.push(parsed.error);
    let kmRun = kmSheet.value;
    if (kmInitial.value !== null && kmFinal.value !== null) {
      if (Number(kmFinal.value) < Number(kmInitial.value)) {
        errors.push("KM FINAL: não pode ser menor que KM INICIAL.");
      }
      const derived = (Number(kmFinal.value) - Number(kmInitial.value)).toFixed(3).replace(/\.000$/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
      kmRun = derived;
    }
    const row: FreightImportPreviewRow = {
      line,
      date: data ?? rawDate,
      dateInferred: dateResult.inferred,
      transporter: nomeTransportador,
      route: rotaCidade ?? "",
      deliveries: deliveries.value === null || deliveries.value === undefined ? "" : String(deliveries.value),
      weight: weight.value ?? "",
      gross: gross.value ?? cellText(cell("valor_frete_bruto")),
      paid: paid.value ?? cellText(cell("valor_frete_pago")),
      percentage: percentage.value ?? cellText(cell("percentual_frete")),
      errors,
    };
    if (errors.length === 0 && data && damage.value !== null) {
      row.item = {
        linha_planilha: line,
        data_servico: data,
        data_servico_planilha: rawDateValue instanceof Date ? dateText(rawDateValue) : rawDate || null,
        data_servico_ano_inferido: dateResult.inferred,
        nome_transportador: nomeTransportador || null,
        rota_cidade: rotaCidade,
        km_inicial: kmInitial.value,
        km_final: kmFinal.value,
        km_rodado: kmRun,
        quantidade_entregas: deliveries.value ?? null,
        peso_kg: weight.value,
        valor_nota: invoice.value,
        valor_frete_bruto: gross.value,
        valor_frete_pago: paid.value,
        percentual_frete: percentage.value,
        percentual_frete_planilha: cellText(cell("percentual_frete")) || null,
        valores_originais_planilha: {
          data_servico: rawDateValue instanceof Date ? dateText(rawDateValue) : rawDate || null,
          nome_transportador: cellText(cell("nome_transportador")) || null,
          rota_cidade: cellText(cell("rota_cidade")) || null,
          km_inicial: cellText(cell("km_inicial")) || null,
          km_final: cellText(cell("km_final")) || null,
          km_rodado: cellText(cell("km_rodado")) || null,
          quantidade_entregas: cellText(cell("quantidade_entregas")) || null,
          peso_kg: cellText(cell("peso_kg")) || null,
          valor_nota: cellText(cell("valor_nota")) || null,
          valor_frete_bruto: cellText(cell("valor_frete_bruto")) || null,
          valor_frete_pago: cellText(cell("valor_frete_pago")) || null,
          percentual_frete: cellText(cell("percentual_frete")) || null,
          valor_avaria: cellText(cell("valor_avaria")) || null,
        },
        valor_avaria: damage.value,
      };
    }
    rows.push(row);
  }
  return rows;
}

export async function parseFreightWorkbook(file: File): Promise<FreightWorkbookPreview> {
  const buffer = await file.arrayBuffer();
  const sha256 = await sha256Hex(buffer);
  const workbook = new Workbook();
  const xlsxBuffer = new Uint8Array(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(xlsxBuffer);

  const matches = findHeaderRows(workbook);
  if (matches.length !== 1) {
    return {
      sheetName: "",
      sha256,
      rows: [],
      errors: [matches.length === 0
        ? "Não encontrei uma aba com os cabeçalhos de fretes esperados. Use a planilha de controle de agregados."
        : "Mais de uma aba tem cabeçalhos de fretes. Separe cada importação em um arquivo com uma única aba de lançamentos."],
    };
  }

  const match = matches[0];
  const sheet = workbook.getWorksheet(match.sheetName);
  if (!sheet) return { sheetName: match.sheetName, sha256, rows: [], errors: ["Não foi possível abrir a aba de lançamentos."] };
  const rows = parseRows(sheet, match.headerRow, match.columns);
  const errors: string[] = [];
  if (rows.length === 0) errors.push("A aba não tem linhas de lançamentos abaixo do cabeçalho.");
  if (rows.length > 2500) errors.push("A importação aceita até 2.500 linhas por vez.");
  return { sheetName: match.sheetName, sha256, rows, errors };
}
