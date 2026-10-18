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

    // UAT login gate: plaintext temporary passwords are read only from the
    // restricted credential workbook. This is intentionally UAT-only.
    if (
      req.method === "POST" &&
      String(req.path || "").replace(/^\/+/, "") === "session/login"
    ) {
      return uatLogin_(store, req.body || {});
    }

    // All other requests must present a valid signed session.
    // Never accept the userId claimed by the browser as proof of identity.
    req.userId = verifyUatSession_(req.sessionToken);
    delete req.sessionToken;

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

function uatLogin_(store, body) {
  var username = normalizeEmployeeId_(body.username);
  var password = String(body.password || "");
  var limiter = CacheService.getScriptCache();
  var key = username ? "GEO_LOGIN_FAIL_" + sessionB64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, username)).slice(0, 24) : "";
  if (key && Number(limiter.get(key) || 0) >= 5) {
    throwUatError_(429, "Too many login attempts. Try again in 10 minutes.");
  }

  if (!username || !password) {
    throwUatError_(400, "Username and password are required");
  }

  var users = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows;
  var user = users.find(function (row) {
    return normalizeEmployeeId_(row.employee_id) === username;
  });

  if (!user || String(user.status || "Active").toLowerCase() !== "active") {
    denyUatLogin_(limiter, key);
  }

  var credentials = store
    .table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials")
    .rows;

  var credential = credentials.find(function (row) {
    return normalizeEmployeeId_(row["employee_id / username"]) === username;
  });

  if (!credential || String(credential.temporary_password || "") !== password) {
    denyUatLogin_(limiter, key);
  }
  if (key) limiter.remove(key);

  return {
    user_id: String(user.user_id || ""),
    id: String(user.user_id || ""),
    full_name: String(user.display_name || ""),
    role: String(user.role || "AE"),
    session_token: issueUatSession_(String(user.user_id || "")),
  };
}

function denyUatLogin_(cache, key) {
  if (key) cache.put(key, String(Number(cache.get(key) || 0) + 1), 600);
  throwUatError_(401, "Invalid username or password");
}

// UAT signed sessions: self-contained and HMAC-protected, expiring after 4h.
// A deploy may use its own persistent Script Property; no extra Sheet is needed.
// Token signatures never appear in spreadsheet rows, log events, or query params.
var GEO_UAT_SESSION_LIFETIME_SECONDS_ = 4 * 60 * 60;

function uatSessionSecret_(create) {
  var props = PropertiesService.getScriptProperties();
  var key = "GEO_UAT_SESSION_SECRET";
  var secret = props.getProperty(key);
  if (!secret && create) {
    // Login requests use the script lock, so initial key generation is serialized.
    secret = [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid()].join("-");
    props.setProperty(key, secret);
  }
  return secret;
}

function sessionB64_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}

function sessionMac_(body, secret) {
  return Utilities.computeHmacSha256Signature(body, secret);
}

function issueUatSession_(userId) {
  if (!userId) throwUatError_(401, "Invalid session user");
  var now = Math.floor(Date.now() / 1000);
  var data = {
    v: 1,
    sub: String(userId),
    iat: now,
    exp: now + GEO_UAT_SESSION_LIFETIME_SECONDS_,
  };
  var body = sessionB64_(Utilities.newBlob(JSON.stringify(data)).getBytes());
  return body + "." + sessionB64_(sessionMac_(body, uatSessionSecret_(true)));
}

function verifyUatSession_(token) {
  var reject = function () {
    throwUatError_(401, "Session expired or invalid. Please sign in again.");
  };
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) reject();
  var parts = token.split(".");
  var secret = uatSessionSecret_(false);
  if (!secret) reject();
  try {
    var signature = Utilities.base64DecodeWebSafe(parts[1]);
    var expected = sessionMac_(parts[0], secret);
    var diff = expected.length ^ signature.length;
    for (var i = 0; i < expected.length; i++) diff |= expected[i] ^ (signature[i] || 0);
    if (diff !== 0) reject();
    var data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString("UTF-8"));
    var now = Math.floor(Date.now() / 1000);
    if (data.v !== 1 || typeof data.sub !== "string" || !data.sub ||
        !Number.isInteger(data.iat) || !Number.isInteger(data.exp) ||
        data.iat > now + 60 || data.exp <= now ||
        data.exp - data.iat > GEO_UAT_SESSION_LIFETIME_SECONDS_) reject();
    return data.sub;
  } catch (err) {
    if (err && err.status === 401) throw err;
    reject();
  }
}

// Run manually if UAT sessions must be invalidated immediately (e.g. suspected theft).
function revokeAllUatSessions() {
  PropertiesService.getScriptProperties().setProperty(
    "GEO_UAT_SESSION_SECRET",
    [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid()].join("-")
  );
  console.log("All UAT sessions revoked. All users must sign in again.");
}

function normalizeEmployeeId_(value) {
  if (value === null || value === undefined || value === "") return "";
  var s = String(value).trim();
  if (/^[0-9]+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  return s;
}

function throwUatError_(status, message) {
  var error = new Error(message);
  error.status = status;
  throw error;
}

// ---- Sheet IDs: Script Properties first, generated SheetIds.js as fallback ----
// Runtime deployments may move to a new Google Sheet without rebuilding the bundle.
// Script Properties must therefore be authoritative; otherwise an old generated
// GEO_SHEET_IDS value can silently keep the web app pointed at the previous DB.
function sheetIdFor_(file) {
  var key = "GEO_SHEET_ID_" + file.replace(/\.xlsx$/, "");
  var runtimeId = PropertiesService.getScriptProperties().getProperty(key);
  return runtimeId || (typeof GEO_SHEET_IDS !== "undefined" && GEO_SHEET_IDS[file]) || "";
}

// Run manually in Apps Script when changing the runtime Pipeline DB.
// It is read-only and helps confirm the deployed web app is bound to the intended sheet.
function debugPipelineDbBinding() {
  var file = "B2B_GEO_Pipeline_DB.xlsx";
  var id = sheetIdFor_(file);
  if (!id) throw new Error("Missing GEO_SHEET_ID_B2B_GEO_Pipeline_DB");
  var book = SpreadsheetApp.openById(id);
  var expected = ["Pipelines", "Pipeline_Events", "Snapshots"];
  var details = expected.map(function (name) {
    var ws = book.getSheetByName(name);
    return {
      sheet: name,
      exists: !!ws,
      rows: ws ? Math.max(0, ws.getLastRow() - 1) : 0,
      columns: ws ? ws.getLastColumn() : 0,
    };
  });
  var out = { id: id, title: book.getName(), sheets: details };
  console.log(JSON.stringify(out, null, 2));
  return out;
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
