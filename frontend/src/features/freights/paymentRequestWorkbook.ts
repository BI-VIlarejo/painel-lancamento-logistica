import { Workbook } from "exceljs";

export type PaymentRequestWorkbookRow = {
  name: string;
  reason: string;
  total: number;
  observations: string;
};

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CURRENCY_FORMAT = "_-[$R$-416]\\ * #,##0.00_-;\\-[$R$-416]\\ * #,##0.00_-;_-[$R$-416]\\ * \"-\"??_-;_-@_-";

/** Gera no navegador a versão de demonstração do modelo usado na solicitação de pagamento. */
export async function createPaymentRequestWorkbook(
  rows: PaymentRequestWorkbookRow[],
  issueDate = new Date(),
): Promise<Blob> {
  const workbook = new Workbook();
  workbook.creator = "Portal de Logística";
  workbook.title = "Solicitação de pagamento de Fretes";

  const worksheet = workbook.addWorksheet("Sheet1", { views: [{ showGridLines: false }] });
  worksheet.columns = [
    { width: 28.140625 },
    { width: 28.7109375 },
    { width: 41.28515625 },
    { width: 20.140625 },
    { width: 19.140625 },
    { width: 40.7109375 },
  ];
  worksheet.mergeCells("A1:F1");
  worksheet.getCell("A1").value = "Solicitação de pagamento Extra";
  worksheet.getCell("A1").font = {
    name: "Calibri", size: 24, bold: true, italic: true, color: { argb: "FFFFFFFF" },
  };
  worksheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF808080" } };
  worksheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(1).height = 32.25;

  for (let column = 1; column <= 6; column += 1) {
    const cell = worksheet.getCell(2, column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF404040" } };
    cell.border = {
      left: { style: "medium", color: { argb: "FF000000" } },
      right: { style: "medium", color: { argb: "FF000000" } },
      top: { style: "medium", color: { argb: "FF000000" } },
      bottom: { style: "medium", color: { argb: "FF000000" } },
    };
  }
  worksheet.getCell("A2").value = "Data";
  worksheet.getCell("A2").font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getCell("C2").value = issueDate;
  worksheet.getCell("C2").numFmt = "dd/mm/yyyy";
  worksheet.getCell("C2").font = { name: "Calibri", size: 14, bold: true, italic: true, color: { argb: "FFFFFFFF" } };
  worksheet.getCell("C2").alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getRow(2).height = 21.75;

  const headers = ["Nome", "CPF", "Motivo", "Setor", "Valor Total", "Observações"];
  headers.forEach((header, index) => {
    const cell = worksheet.getCell(3, index + 1);
    cell.value = header;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D0D0D" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      left: { style: index === 0 ? "medium" : "thin", color: { argb: "FF000000" } },
      right: { style: "thin", color: { argb: "FF000000" } },
      top: { style: "medium", color: { argb: "FF000000" } },
      bottom: { style: "thin", color: { argb: "FF000000" } },
    };
  });

  const dataStart = 4;
  const dataEnd = dataStart + rows.length - 1;
  const dataSlotEnd = Math.max(23, dataEnd);
  rows.forEach((row, index) => {
    const rowNumber = dataStart + index;
    const values: (string | number | null)[] = [row.name, null, row.reason, "TRANSPORTE", row.total, row.observations];
    values.forEach((value, columnIndex) => {
      const cell = worksheet.getCell(rowNumber, columnIndex + 1);
      cell.value = value;
      cell.font = { name: "Calibri", size: 16, color: { argb: "FF000000" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        left: { style: columnIndex === 0 ? "medium" : "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
        top: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: rowNumber === dataSlotEnd ? "medium" : "thin", color: { argb: "FF000000" } },
      };
      if (columnIndex === 4) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
        cell.numFmt = CURRENCY_FORMAT;
      }
    });
    worksheet.getRow(rowNumber).height = 42;
  });

  for (let rowNumber = Math.max(dataStart, dataEnd + 1); rowNumber <= dataSlotEnd; rowNumber += 1) {
    worksheet.getRow(rowNumber).height = 21;
    for (let column = 1; column <= 6; column += 1) {
      const cell = worksheet.getCell(rowNumber, column);
      cell.font = { name: "Calibri", size: 16, color: { argb: "FF000000" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        left: { style: column === 1 ? "medium" : "thin", color: { argb: "FF000000" } },
        right: { style: "thin", color: { argb: "FF000000" } },
        top: { style: "thin", color: { argb: "FF000000" } },
        bottom: { style: rowNumber === dataSlotEnd ? "medium" : "thin", color: { argb: "FF000000" } },
      };
      if (column === 5) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
        cell.numFmt = CURRENCY_FORMAT;
      }
    }
  }
  if (dataEnd < dataSlotEnd) worksheet.getRow(dataSlotEnd).height = 21.75;

  const totalRow = dataSlotEnd + 1;
  for (const column of [4, 5]) {
    const cell = worksheet.getCell(totalRow, column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    cell.font = { name: "Calibri", size: 16, bold: column === 4, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      left: { style: "medium", color: { argb: "FF000000" } },
      right: { style: "medium", color: { argb: "FF000000" } },
      top: { style: "medium", color: { argb: "FF000000" } },
      bottom: { style: "medium", color: { argb: "FF000000" } },
    };
  }
  worksheet.getCell(totalRow, 4).value = "TOTAL GERAL";
  worksheet.getCell(totalRow, 5).value = { formula: `SUM(E${dataStart}:E${dataSlotEnd})` };
  worksheet.getCell(totalRow, 5).numFmt = CURRENCY_FORMAT;
  worksheet.getRow(totalRow).height = 21.75;

  worksheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    scale: 69,
    margins: {
      left: 0.7086614173228347,
      right: 0.7086614173228347,
      top: 0.7480314960629921,
      bottom: 0.7480314960629921,
      header: 0.3149606299212598,
      footer: 0.3149606299212598,
    },
  };

  const bytes = await workbook.xlsx.writeBuffer();
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return new Blob([arrayBuffer], { type: XLSX_MIME_TYPE });
}
