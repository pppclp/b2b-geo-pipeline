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

// Parse historical source Create Month without guessing local date order.
// ExcelJS converts recognized XLSX date cells to Date; our XLSX reader turns
// those into ISO calendar dates before calling this. Unformatted serial
// numbers and locale-dependent numeric dates remain ambiguous and are rejected.
export function parseImportCreatedMonth(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const valid = (year, month, day = null) => {
    if (!Number.isInteger(year) || year < 1900 || year > 2100 ||
        !Number.isInteger(month) || month < 1 || month > 12) return null;
    if (day !== null) {
      if (!Number.isInteger(day) || day < 1 || day > 31) return null;
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year ||
          date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    }
    return String(year) + "-" + String(month).padStart(2, "0");
  };
  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
  if (iso) return valid(Number(iso[1]), Number(iso[2]),
    iso[3] === undefined ? null : Number(iso[3]));
  const named = /^(?:(\d{1,2})[-\/\s]+)?([A-Za-z]{3,9})[-\/\s]+(\d{2}|\d{4})$/.exec(text);
  if (named) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const month = months.indexOf(named[2].slice(0,3).toLowerCase()) + 1;
    const yearPart = named[3];
    const yy = Number(yearPart);
    // Same century convention as PR #72; two-digit years are a legacy
    // compatibility rule, not a guessed day/month order.
    const year = yearPart.length === 2 ? (yy <= 69 ? 2000 + yy : 1900 + yy) : yy;
    return valid(year, month, named[1] === undefined ? null : Number(named[1]));
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
