import { Workbook } from "exceljs";
import type { CellValue } from "exceljs";
import type { FreightHistoryFilters, FreightResponse } from "./types";

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const headers = [
  "Data do serviço", "Modalidade", "Responsável", "Motorista da transportadora", "Rota / cidade",
  "Entregas", "Peso (kg)", "KM inicial", "KM final", "KM rodado", "Valor da nota (R$)",
  "Tipo de caminhão", "Carro de apoio", "Zona JUST IN TIME", "Adicionais JIT", "Quantidade de avarias",
  "Valor da avaria (R$)", "Frete bruto (R$)", "Percentual do frete", "Total líquido (R$)",
  "Situação do cálculo", "Motivo / pendência", "Situação do registro", "Justificativa de cancelamento",
  "Arquivo de origem", "Aba de origem", "Linha da planilha", "Criado em",
];

function dateValue(value: string): Date {
  return new Date(`${value.slice(0, 10)}T12:00:00`);
}

function numberValue(value: string | number | null): number | null {
  if (value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function paymentAmount(item: FreightResponse): number | null {
  const net = numberValue(item.valor_frete_pago);
  if (net !== null) return net;
  const gross = numberValue(item.valor_frete_bruto);
  const damage = numberValue(item.valor_avaria) ?? 0;
  return gross === null ? null : gross - damage;
}

function sourceOf(item: FreightResponse): Record<string, unknown> {
  const source = item.detalhe_calculo.importacao_planilha;
  return typeof source === "object" && source !== null ? source as Record<string, unknown> : {};
}

function sourceCell(value: unknown): CellValue {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function truckLabel(item: FreightResponse): string {
  return ({
    SAVEIRO: "Saveiro",
    KIA_BONGO: "Kia Bongo",
    CAMINHAO_3_4: "Caminhão 3/4",
    CAMINHAO_TOCO: "Caminhão toco",
  } as Record<string, string>)[item.tipo_caminhao ?? ""] ?? "";
}

function supportLabel(item: FreightResponse): string {
  if (item.carro_apoio === "SAVEIRO") return "Saveiro";
  if (item.carro_apoio === "KIA_BONGO") return "Bongo";
  return "";
}

function filterDescription(filters: FreightHistoryFilters, count: number): string {
  const period = filters.data_de && filters.data_ate
    ? `${filters.data_de} a ${filters.data_ate}`
    : filters.data_de
      ? `a partir de ${filters.data_de}`
      : filters.data_ate
        ? `até ${filters.data_ate}`
        : "todas as datas";
  return `Período: ${period} · Tipo: ${filters.tipo_transporte ?? "todos"} · `
    + `Status: ${filters.status_calculo ?? "todos"} · Motorista ID: ${filters.id_motorista ?? "todos"} · `
    + `Rota: ${filters.rota_cidade ?? "todas"} · Transportadora: ${filters.codigo_transportadora ?? "todas"} · `
    + `Registros: ${count}`;
}

/** Gera a exportação local do histórico para a demonstração sem integração com a API. */
export async function createFreightHistoryWorkbook(
  items: FreightResponse[],
  filters: FreightHistoryFilters,
): Promise<Blob> {
  const workbook = new Workbook();
  workbook.creator = "Portal de Logística";
  workbook.title = "Histórico de Fretes";
  workbook.subject = "Exportação dos lançamentos filtrados no histórico";
  const worksheet = workbook.addWorksheet("Histórico", {
    views: [{ state: "frozen", ySplit: 3, showGridLines: false, zoomScale: 85 }],
  });
  worksheet.columns = [
    15, 20, 28, 30, 30, 12, 14, 14, 14, 14, 19, 20, 18, 21, 30, 18, 20, 20, 18, 20, 24, 55, 19, 45, 32, 20, 15, 22,
  ].map((width) => ({ width }));
  worksheet.mergeCells(1, 1, 1, headers.length);
  worksheet.getCell(1, 1).value = "Histórico de fretes";
  worksheet.getCell(1, 1).font = { name: "Calibri", size: 20, bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
  worksheet.getCell(1, 1).alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 34;
  worksheet.mergeCells(2, 1, 2, headers.length);
  worksheet.getCell(2, 1).value = filterDescription(filters, items.length);
  worksheet.getCell(2, 1).font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF536477" } };
  worksheet.getCell(2, 1).alignment = { vertical: "middle", wrapText: true };
  worksheet.getRow(2).height = 28;

  const header = worksheet.getRow(3);
  header.values = [undefined, ...headers];
  header.height = 34;
  header.eachCell((cell) => {
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF254B6E" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FF17324D" } } };
  });

  items.forEach((item, index) => {
    const row = index + 4;
    const source = sourceOf(item);
    const support = supportLabel(item);
    const imported = source.arquivo ? source : {};
    const values: CellValue[] = [
      dateValue(item.data_servico),
      item.tipo_transporte === "AGREGADO" ? "Agregado" : item.tipo_transporte === "PROPRIO" ? "Frota própria" : "Transportadora independente",
      item.nome_transportador,
      item.nome_motorista_transportadora,
      item.rota_cidade,
      item.quantidade_entregas,
      numberValue(item.peso_kg),
      item.tipo_transporte === "TRANSPORTADORA" ? "Não se aplica" : numberValue(item.km_inicial),
      item.tipo_transporte === "TRANSPORTADORA" ? "Não se aplica" : numberValue(item.km_final),
      item.tipo_transporte === "TRANSPORTADORA" ? "Não se aplica" : numberValue(item.km_rodado),
      numberValue(item.valor_nota),
      truckLabel(item),
      support,
      item.codigo_zona_jit,
      item.adicionais_jit.join(", "),
      item.quantidade_avarias,
      numberValue(item.valor_avaria),
      numberValue(item.valor_frete_bruto),
      numberValue(item.percentual_frete),
      paymentAmount(item),
      item.status_calculo === "CALCULADO" ? "Calculado" : "Pendente de conferência",
      item.motivo_pendencia,
      item.cancelado ? "Cancelado" : "Ativo",
      item.justificativa_cancelamento,
      sourceCell(imported.arquivo),
      sourceCell(imported.aba),
      sourceCell(imported.linha),
      new Date(item.criado_em),
    ];
    const dataRow = worksheet.getRow(row);
    dataRow.values = [undefined, ...values];
    dataRow.height = 24;
    dataRow.eachCell((cell, column) => {
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF24364B" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: row % 2 === 0 ? "FFF5F8FB" : "FFFFFFFF" } };
      cell.alignment = {
        horizontal: [1, 2, 6, 8, 9, 10, 12, 13, 14, 16, 19, 21, 23, 27, 28].includes(column) ? "center" : "left",
        vertical: "middle",
        wrapText: [3, 4, 5, 14, 15, 22, 24, 25].includes(column),
      };
      if ([11, 17, 18, 20].includes(column)) cell.numFmt = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
      else if ([7, 8, 9, 10].includes(column)) cell.numFmt = "#,##0.000";
      else if (column === 1) cell.numFmt = "dd/mm/yyyy";
      else if (column === 19) cell.numFmt = "0.000%";
      else if (column === 28) cell.numFmt = "dd/mm/yyyy hh:mm";
      if (column === 21 && item.status_calculo !== "CALCULADO") {
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF99610E" } };
      }
      if (column === 23 && item.cancelado) {
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF9D413B" } };
      }
    });
  });
  worksheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, items.length + 3), column: headers.length } };
  worksheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME_TYPE });
}
