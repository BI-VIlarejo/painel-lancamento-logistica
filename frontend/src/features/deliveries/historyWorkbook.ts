import { Workbook } from "exceljs";

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function createDeliveryHistoryWorkbook(
  headers: string[],
  rows: Array<Array<string | number>>,
  period: string,
): Promise<Blob> {
  const workbook = new Workbook();
  workbook.creator = "Portal de Logística";
  workbook.title = "Histórico de Entregas";
  const sheet = workbook.addWorksheet("Histórico", {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false, zoomScale: 85 }],
  });
  const widths = headers.map((header, index) => {
    const sampleWidth = Math.max(header.length, ...rows.slice(0, 100).map((row) => String(row[index] ?? "").length));
    const descriptionColumn = /motivos|observa|códigos de clientes/i.test(header);
    return Math.min(descriptionColumn ? 42 : 30, Math.max(descriptionColumn ? 18 : 12, sampleWidth + 2));
  });
  sheet.columns = widths.map((width) => ({ width }));
  sheet.mergeCells(1, 1, 1, headers.length);
  const title = sheet.getCell(1, 1);
  title.value = "Histórico de entregas";
  title.font = { name: "Calibri", size: 20, bold: true, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
  title.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 34;
  sheet.mergeCells(2, 1, 2, headers.length);
  const subtitle = sheet.getCell(2, 1);
  subtitle.value = `${period} · ${rows.length.toLocaleString("pt-BR")} registros`;
  subtitle.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF536477" } };
  subtitle.alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(2).height = 24;
  sheet.addRow([]);
  const headerRow = sheet.addRow(headers);
  headerRow.height = 34;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF254B6E" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FF17324D" } } };
  });
  rows.forEach((values, index) => {
    const row = sheet.addRow(values.map((value) => {
      if (typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(value)) return `'${value}`;
      return value;
    }));
    row.height = 24;
    row.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF24364B" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 === 0 ? "FFF5F8FB" : "FFFFFFFF" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, rows.length + 4), column: headers.length } };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME_TYPE });
}
