// Excel-backed table store for local development.
// Each file in access_control.files is a workbook in DATA_DIR and each
// sheet is a table: row 1 = column headers, following rows = records.
// Workbooks are loaded up front (async) so core.js can work synchronously;
// apps-script/Main.js implements the same table/touch interface over Google Sheets.
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

function cellValue(v) {
  if (v == null) return "";
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso; // date-only cells stay YYYY-MM-DD
  }
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result); // formula
    if ("text" in v) return v.text; // hyperlink
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
  }
  return v;
}

export class ExcelStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.books = new Map(); // fileName -> { wb, tables: Map(sheet -> { headers, rows }) }
    this.dirty = new Map(); // fileName -> Set(sheet) with unsaved changes
    this.queue = Promise.resolve();
  }

  filePath(fileName) {
    return path.join(this.dataDir, fileName);
  }

  exists(fileName) {
    return fs.existsSync(this.filePath(fileName));
  }

  async load(fileName) {
    if (this.books.has(fileName)) return this.books.get(fileName);
    const wb = new ExcelJS.Workbook();
    if (this.exists(fileName)) await wb.xlsx.readFile(this.filePath(fileName));
    const tables = new Map();
    wb.eachSheet((ws) => {
      const headers = [];
      ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
        headers[col - 1] = String(cellValue(cell.value)).trim();
      });
      const rows = [];
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const rec = {};
        let hasValue = false;
        headers.forEach((h, i) => {
          if (!h) return;
          const v = cellValue(row.getCell(i + 1).value);
          if (v !== "") hasValue = true;
          rec[h] = v;
        });
        if (hasValue) rows.push(rec);
      }
      tables.set(ws.name, { headers: headers.filter(Boolean), rows });
    });
    const book = { wb, tables, mtime: this.mtime(fileName) };
    this.books.set(fileName, book);
    return book;
  }

  mtime(fileName) {
    return this.exists(fileName) ? fs.statSync(this.filePath(fileName)).mtimeMs : 0;
  }

  // Reloads any file changed on disk by something else (e.g. npm run sheets:pull).
  async loadAll(fileNames) {
    for (const f of fileNames) {
      if (this.books.has(f) && this.books.get(f).mtime !== this.mtime(f)) this.books.delete(f);
      await this.load(f);
    }
  }

  // Sync access for core.js — the file must already be loaded.
  table(fileName, sheet) {
    const book = this.books.get(fileName);
    if (!book) throw new Error(`${fileName} is not loaded`);
    if (!book.tables.has(sheet)) book.tables.set(sheet, { headers: [], rows: [] });
    return book.tables.get(sheet);
  }

  touch(fileName, sheet) {
    if (!this.dirty.has(fileName)) this.dirty.set(fileName, new Set());
    this.dirty.get(fileName).add(sheet);
  }

  // Requests are serialized so two never interleave a read-modify-save.
  run(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  // Unload so the next request re-reads files from disk (e.g. after sheets:pull).
  reset() {
    this.books.clear();
    this.dirty.clear();
  }

  // Single cell write for formula-layout sheets (e.g. Month-End Summary).
  setCell(fileName, sheet, a1, value) {
    const book = this.books.get(fileName);
    const ws = book.wb.getWorksheet(sheet) || book.wb.addWorksheet(sheet);
    ws.getCell(a1).value = value;
    if (!this.dirty.has(fileName)) this.dirty.set(fileName, new Set());
  }

  async flush() {
    for (const [fileName, sheets] of this.dirty) await this.save(fileName, sheets);
    this.dirty.clear();
  }

  // Rewrites only the given sheets; README / Data_Dictionary etc. stay untouched.
  async save(fileName, sheets = this.books.get(fileName).tables.keys()) {
    const book = this.books.get(fileName);
    for (const sheet of sheets) {
      const t = book.tables.get(sheet);
      for (const r of t.rows) for (const k of Object.keys(r)) if (!t.headers.includes(k)) t.headers.push(k);
      const ws = book.wb.getWorksheet(sheet) || book.wb.addWorksheet(sheet);
      ws.getRow(1).values = t.headers;
      ws.getRow(1).font = { bold: true };
      t.rows.forEach((rec, i) => {
        ws.getRow(i + 2).values = t.headers.map((h) => (rec[h] === undefined ? null : rec[h]));
      });
      // Clear leftover rows (spliceRows misbehaves on Google exports padded to 1000 rows).
      for (let r = t.rows.length + 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        if (row.hasValues) row.eachCell({ includeEmpty: true }, (cell) => (cell.value = null));
      }
    }
    fs.mkdirSync(this.dataDir, { recursive: true });
    await book.wb.xlsx.writeFile(this.filePath(fileName));
    book.mtime = this.mtime(fileName);
  }
}
