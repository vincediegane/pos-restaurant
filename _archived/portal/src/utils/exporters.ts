import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Workbook } from "exceljs";

type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | boolean;
};

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

export async function exportExcel<T>(filename: string, rows: T[], columns: ExportColumn<T>[]) {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet("Export");

  worksheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.header,
    width: Math.max(14, column.header.length + 4),
  }));
  rows.forEach((row) => {
    worksheet.addRow(Object.fromEntries(columns.map((column) => [column.header, column.value(row)])));
  });
  worksheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}-${stamp()}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportPdf<T>(filename: string, title: string, rows: T[], columns: ExportColumn<T>[]) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(15);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.text(`Genere le ${stamp()}`, 14, 23);
  autoTable(doc, {
    startY: 30,
    head: [columns.map((column) => column.header)],
    body: rows.map((row) => columns.map((column) => String(column.value(row)))),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [31, 41, 51] },
  });
  doc.save(`${filename}-${stamp()}.pdf`);
}
