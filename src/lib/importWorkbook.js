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

// Convert source Create Month to YYYY-MM. Invalid/ambiguous dates are rejected rather than guessed.
export function parseImportCreatedMonth(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const valid = (year, month, day = null) => {
    if (!Number.isInteger(year) || year < 1900 || year > 2100 ||
        !Number.isInteger(month) || month < 1 || month > 12) return null;
    if (day != null) {
      const dt = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isInteger(day) || dt.getUTCFullYear() !== year ||
          dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
    }
    return String(year) + "-" + String(month).padStart(2, "0");
  };
  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), iso[3] == null ? null : Number(iso[3]));
  const named = /^(?:(\d{1,2})[-\/\s]+)?([A-Za-z]{3,9})[-\/\s]+(\d{2}|\d{4})$/.exec(text);
  if (named) {
    const names = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const month = names.indexOf(named[2].slice(0,3).toLowerCase()) + 1;
    const yy = Number(named[3]);
    const year = named[3].length === 2 ? (yy <= 69 ? 2000 + yy : 1900 + yy) : yy;
    return valid(year, month, named[1] == null ? null : Number(named[1]));
  }
  return null;
}

export async function parseImportXlsx(arrayBuffer) {
  const imported = await import("exceljs");
  const ExcelJS = imported.default || imported;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("This workbook has no worksheet");
  if (sheet.columnCount > MAX_COLUMNS) throw new Error("Import exceeds 80 columns");
  const headers = Array.from({length:sheet.columnCount},(_,i)=>excelCellText(sheet.getRow(1).getCell(i+1)).trim());
  if (!headers.some(Boolean)) throw new Error("The first row must contain column names");
  if (sheet.rowCount - 1 > MAX_IMPORT_ROWS) throw new Error("Import supports up to 200 rows per file");
  const rows = [];
  for (let rowNumber=2;rowNumber<=sheet.rowCount;rowNumber++) {
    const row = Array.from({length:headers.length},(_,i)=>
      excelCellText(sheet.getRow(rowNumber).getCell(i+1), headers[i]));
    if (row.some((cell)=>String(cell).trim())) rows.push(row);
  }
  if (!rows.length) throw new Error("This workbook contains no data rows");
  return {headers,rows};
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
