// Parse a user-selected .xlsx in the browser, without uploading raw bytes.
// ExcelJS is loaded only when the user chooses a workbook.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 200;
const MAX_COLUMNS = 80;

function excelCellText(cell, header = "") {
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date) {
    const ym = value.toISOString().slice(0, 7);
    return /expected.close.month|เดือน.*ปิด/iu.test(header) ? ym : value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value)
      throw new Error("Excel formulas are not supported in Import. Paste values first.");
    if (Array.isArray(value.richText)) return value.richText.map((v) => v.text || "").join("");
    if (typeof value.text === "string") return value.text;
    if (typeof value.result === "string" || typeof value.result === "number")
      throw new Error("Formula results are not supported. Paste values first.");
    throw new Error("Unsupported Excel cell type. Convert cells to plain values.");
  }
  // If Excel stores an identifier numerically, its original leading zeroes
  // are gone. A standard all-zero number format can still be reconstructed.
  if (typeof value === "number" && Number.isInteger(value) &&
      /^0{2,}$/.test(String(cell.numFmt || ""))) {
    return String(value).padStart(cell.numFmt.length, "0");
  }
  return String(value);
}

export async function parseImportXlsx(arrayBuffer) {
  const imported = await import("exceljs");
  const ExcelJS = imported.default || imported;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("This workbook has no worksheet");
  // worksheet.rowCount/columnCount include styled blank cells. Only valued
  // headers and data rows count toward the 80-column / 200-row import limits.
  let lastHeaderColumn = 0;
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    if (excelCellText(cell).trim()) lastHeaderColumn = Math.max(lastHeaderColumn, col);
  });
  if (!lastHeaderColumn) throw new Error("The first row must contain column names");
  if (lastHeaderColumn > MAX_COLUMNS) throw new Error("Import exceeds 80 columns");
  const headers = Array.from({length:lastHeaderColumn},(_,i)=>excelCellText(sheet.getRow(1).getCell(i+1)).trim());
  const rows = [], rowNumbers = [];
  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber === 1) return;
    const row = Array.from({length:headers.length},(_,i)=>
      excelCellText(excelRow.getCell(i+1), headers[i]));
    if (!row.some((cell)=>String(cell).trim())) return;
    rows.push(row);
    rowNumbers.push(rowNumber);
    if (rows.length > MAX_IMPORT_ROWS) throw new Error("Import supports up to 200 data rows per file");
  });
  if (!rows.length) throw new Error("This workbook contains no data rows");
  return {headers,rows,rowNumbers};
}

export async function readImportFile(file, parseCsv) {
  if (!file || file.size > MAX_FILE_BYTES) throw new Error("File exceeds the 5 MB limit");
  const name = String(file.name || "").toLowerCase();
  if (name.endsWith(".xlsx")) return parseImportXlsx(await file.arrayBuffer());
  if (name.endsWith(".csv")) {
    const parsed = parseCsv(await file.text());
    if (!parsed.length) throw new Error("CSV has no rows");
    if (parsed.length - 1 > MAX_IMPORT_ROWS) throw new Error("Import supports up to 200 rows per file");
    return {headers:parsed[0].map((h)=>h.trim()),rows:parsed.slice(1)};
  }
  throw new Error("Choose a .xlsx or .csv file");
}
