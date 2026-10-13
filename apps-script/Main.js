// Apps Script web app: the GEO backend over Google Sheets.
// Same API as the local dev server — routing, permissions and scope live in
// server/core.js, bundled into GeoCore.js by `npm run gas:build` together with
// Contract.js (from b2b_geo_pipeline.yaml) and SheetIds.js (from .env.local).
//
// Request: { method, path, query, body, userId, demoAs } as JSON —
//   reads:  GET  ?req=<json>
//   writes: POST body (Content-Type text/plain, so no CORS preflight)
// Response: { status, body } — Apps Script cannot set HTTP status codes.

// Reads arrive as GET ?req=<json> (a POST can be redirected by Google and lose
// its body). Without ?req it is a health check — clients treat that shape as
// "not executed" and retry.
function doGet(e) {
  var raw = e && e.parameter && e.parameter.req;
  if (!raw) return json_({ status: 200, body: { ok: true, service: "B2B GEO Pipeline API" }, health: true });
  return serve_(raw);
}

function doPost(e) {
  return serve_((e.postData && e.postData.contents) || "{}");
}

function serve_(raw) {
  var out;
  try {
    var req = JSON.parse(raw);
    out = { status: 200, body: handle_(req) };
  } catch (err) {
    if (!err.status) console.error(err && err.stack ? err.stack : err);
    out = { status: err.status || 500, body: { message: String((err && err.message) || err) } };
  }
  return json_(out);
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  var writes = req.method && req.method !== "GET";
  var lock = LockService.getScriptLock();
  if (writes) lock.waitLock(30000);
  try {
    var store = new SheetStore_();
    var core = GeoCoreLib.createCore({
      contract: GEO_CONTRACT,
      store: store,
      now: function () { return new Date().toISOString(); },
      uuid: function () { return Utilities.getUuid(); },
    });
    var result = core.handle(req);
    store.flush();
    return result;
  } finally {
    if (writes) lock.releaseLock();
  }
}

// ---- Sheet IDs: SheetIds.js (generated) first, then Script Properties ----
function sheetIdFor_(file) {
  var key = "GEO_SHEET_ID_" + file.replace(/\.xlsx$/, "");
  return (typeof GEO_SHEET_IDS !== "undefined" && GEO_SHEET_IDS[file]) || PropertiesService.getScriptProperties().getProperty(key);
}

// ---- Table store over Google Sheets (same interface as server/store.js) ----
function SheetStore_() {
  this.books = {};
  this.tables = {};
  this.loaded = {}; // key -> rows as read, to write only what changed
  this.dirty = {};
}

SheetStore_.prototype.book_ = function (file) {
  if (!this.books[file]) {
    var id = sheetIdFor_(file);
    if (!id) {
      var e = new Error("No Google Sheet ID for " + file + " — set GEO_SHEET_ID_" + file.replace(/\.xlsx$/, "") + " in .env.local and run npm run gas:push (or run setup())");
      e.status = 500;
      throw e;
    }
    this.books[file] = SpreadsheetApp.openById(id);
  }
  return this.books[file];
};

SheetStore_.prototype.table = function (file, sheet) {
  var key = file + "|" + sheet;
  if (this.tables[key]) return this.tables[key];
  var ws = this.book_(file).getSheetByName(sheet);
  var headers = [];
  var rows = [];
  if (ws && ws.getLastRow() > 0) {
    var values = ws.getRange(1, 1, ws.getLastRow(), Math.max(ws.getLastColumn(), 1)).getValues();
    headers = values[0].map(function (h) { return String(h).trim(); });
    for (var i = 1; i < values.length; i++) {
      var rec = {};
      var has = false;
      for (var c = 0; c < headers.length; c++) {
        if (!headers[c]) continue;
        var v = cell_(values[i][c]);
        if (v !== "") has = true;
        rec[headers[c]] = v;
      }
      if (has) rows.push(rec);
    }
  }
  this.tables[key] = { headers: headers.filter(function (h) { return h; }), rows: rows };
  this.loaded[key] = {
    headers: this.tables[key].headers.slice(),
    rows: rows.slice(),
    json: rows.map(function (r) { return JSON.stringify(r); }),
  };
  return this.tables[key];
};

// Adds rows after the last row without reading the sheet (audit logs).
SheetStore_.prototype.append = function (file, sheet, rows) {
  var ws = this.book_(file).getSheetByName(sheet) || this.book_(file).insertSheet(sheet);
  var headers = ws.getLastColumn() ? ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(String) : [];
  if (!headers.filter(String).length) {
    headers = Object.keys(rows[0]);
    ws.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  ws.getRange(ws.getLastRow() + 1, 1, rows.length, headers.length).setValues(
    rows.map(function (r) {
      return headers.map(function (h) { return r[h] === undefined || r[h] === null ? "" : r[h]; });
    })
  );
};

// Single cell write for formula-layout sheets (Month-End Summary).
SheetStore_.prototype.setCell = function (file, sheet, a1, value) {
  var ws = this.book_(file).getSheetByName(sheet);
  if (ws) ws.getRange(a1).setValue(value);
};

SheetStore_.prototype.touch = function (file, sheet) {
  this.dirty[file + "|" + sheet] = { file: file, sheet: sheet };
};

// Writes only touched sheets (README / Data_Dictionary are never touched).
// If rows were only edited or added, just those rows are written; otherwise
// (deletes, reorders, new columns) the data area is rewritten.
SheetStore_.prototype.flush = function () {
  for (var key in this.dirty) {
    var d = this.dirty[key];
    var t = this.tables[key];
    var before = this.loaded[key] || { headers: [], rows: [], json: [] };
    t.rows.forEach(function (r) {
      Object.keys(r).forEach(function (k) { if (t.headers.indexOf(k) < 0) t.headers.push(k); });
    });
    var book = this.book_(d.file);
    var ws = book.getSheetByName(d.sheet) || book.insertSheet(d.sheet);
    var toValues = function (r) {
      return t.headers.map(function (h) { return r[h] === undefined || r[h] === null ? "" : r[h]; });
    };
    var sameShape =
      before.rows.length > 0 &&
      t.headers.join("\u0001") === before.headers.join("\u0001") &&
      t.rows.length >= before.rows.length &&
      before.rows.every(function (r, i) { return t.rows[i] === r; });

    if (sameShape) {
      for (var i = 0; i < t.rows.length; i++) {
        if (i < before.rows.length && JSON.stringify(t.rows[i]) === before.json[i]) continue;
        ws.getRange(i + 2, 1, 1, t.headers.length).setValues([toValues(t.rows[i])]);
      }
    } else {
      ws.getRange(1, 1, 1, t.headers.length).setValues([t.headers]);
      var last = ws.getLastRow();
      if (last > 1) ws.getRange(2, 1, last - 1, Math.max(ws.getLastColumn(), t.headers.length)).clearContent();
      if (t.rows.length) ws.getRange(2, 1, t.rows.length, t.headers.length).setValues(t.rows.map(toValues));
    }
  }
  this.dirty = {};
  SpreadsheetApp.flush();
};

function cell_(v) {
  if (v instanceof Date) {
    var tz = Session.getScriptTimeZone();
    var time = Utilities.formatDate(v, tz, "HH:mm:ss");
    return time === "00:00:00" ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : v.toISOString();
  }
  return v === null || v === undefined ? "" : v;
}

// ---- One-time setup: run from the Apps Script editor ----
// Checks access to every source sheet and creates B2B_GEO_Pipeline_DB if it has no ID yet.
function setup() {
  var files = GEO_CONTRACT.access.files;
  Object.keys(files).forEach(function (file) {
    if (!files[file].sheets) return;
    var id = sheetIdFor_(file);
    if (!id) return;
    var book = SpreadsheetApp.openById(id);
    var missing = Object.keys(files[file].sheets).filter(function (s) { return !book.getSheetByName(s); });
    console.log("ok  " + file + " → " + book.getName() + (missing.length ? " (missing sheets: " + missing.join(", ") + ")" : ""));
  });

  clearOutputSamples_();

  var dbFile = "B2B_GEO_Pipeline_DB.xlsx";
  if (sheetIdFor_(dbFile)) return console.log("Pipeline DB already configured: " + sheetIdFor_(dbFile));
  var db = SpreadsheetApp.create("B2B_GEO_Pipeline_DB");
  Object.keys(files[dbFile].sheets).forEach(function (sheet) {
    var entity = files[dbFile].sheets[sheet].entity;
    var cols = GEO_CONTRACT.columns[entity] || [files[dbFile].sheets[sheet].primary_key];
    db.insertSheet(sheet).getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold");
  });
  var first = db.getSheets()[0];
  if (Object.keys(files[dbFile].sheets).indexOf(first.getName()) < 0) db.deleteSheet(first);
  PropertiesService.getScriptProperties().setProperty("GEO_SHEET_ID_B2B_GEO_Pipeline_DB", db.getId());
  console.log("Created Pipeline DB: " + db.getUrl());
  console.log("Add to .env.local:  GEO_SHEET_ID_B2B_GEO_Pipeline_DB=" + db.getId());
}

// Output templates ship with sample rows and pre-filled formulas. Clear their
// data rows once (tracked in Script Properties) so real logs start clean.
// Later runs of setup() never clear them again.
function clearOutputSamples_() {
  var props = PropertiesService.getScriptProperties();
  var files = GEO_CONTRACT.access.files;
  Object.keys(files).forEach(function (file) {
    var output = files[file].output;
    if (!output) return;
    var flag = "OUTPUT_CLEARED_" + file.replace(/\.xlsx$/, "");
    var id = sheetIdFor_(file);
    if (!id) return console.log("skip " + file + " — no sheet ID");
    if (props.getProperty(flag)) return console.log("ok  " + file + " (output sheets already initialised)");
    var book = SpreadsheetApp.openById(id);
    Object.keys(output).forEach(function (sheet) {
      var ws = book.getSheetByName(sheet);
      if (!ws || output[sheet].mode === "cells") return;
      var last = ws.getLastRow();
      if (last > 1) ws.getRange(2, 1, last - 1, ws.getLastColumn()).clearContent();
    });
    props.setProperty(flag, new Date().toISOString());
    console.log("ok  " + file + " → sample rows cleared, ready for app output");
  });
}
