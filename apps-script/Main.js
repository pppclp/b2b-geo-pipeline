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
  // Serialize reads and writes while crash-recoverable database snapshots are
  // prepared. Without this, a GET might mistake an in-progress backup for a
  // crashed transaction and roll back another request.
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
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
    lock.releaseLock();
  }
}

function uatLogin_(store, body) {
  var username = normalizeEmployeeId_(body.username);
  var password = String(body.password || "");
  var limiter = CacheService.getScriptCache();
  var key = username ? "GEO_LOGIN_FAIL_" + sessionB64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, username)).slice(0, 24) : "";
  // Username-only throttling is vulnerable to password spraying across accounts.
  // The script-wide limit is a second brake, NOT a replacement for SSO/WAF.
  var globalKey = "GEO_LOGIN_FAIL_GLOBAL_V1";
  if (Number(limiter.get(globalKey) || 0) >= 50 ||
      (key && Number(limiter.get(key) || 0) >= 5)) {
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

  if (!credential || !verifyUatPassword_(credential, password)) {
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
  var globalKey = "GEO_LOGIN_FAIL_GLOBAL_V1";
  cache.put(globalKey, String(Number(cache.get(globalKey) || 0) + 1), 600);
  throwUatError_(401, "Invalid username or password");
}

// UAT-only credential migration. Hash is salted + keyed with a separate
// Script Property (pepper). This protects a leaked Sheet alone, but is NOT a
// memory-hard password KDF and must not be marketed as production-grade.
var GEO_UAT_PASSWORD_PEPPER_PROPERTY_ = "GEO_UAT_PASSWORD_PEPPER";
var GEO_UAT_PASSWORD_HASH_SCHEME_ = "hmac-sha256-v1";

function uatPasswordPepper_(create) {
  var props = PropertiesService.getScriptProperties();
  var value = props.getProperty(GEO_UAT_PASSWORD_PEPPER_PROPERTY_);
  if (!value && create) {
    // Never generate a new pepper while hashes may exist; migration itself
    // performs the first provisioning under the script lock.
    value = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(GEO_UAT_PASSWORD_PEPPER_PROPERTY_, value);
  }
  if (!value) throwUatError_(503, "UAT password verification is not configured");
  return value;
}

function uatPasswordDigest_(salt, password) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(String(salt) + ":" + String(password), uatPasswordPepper_(false))
  ).replace(/=+$/, "");
}

function uatConstantTimeEqual_(a, b) {
  a = String(a); b = String(b);
  var mismatch = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

function verifyUatPassword_(credential, password) {
  var stored = String(credential.password_hash || "").trim();
  if (stored) {
    var parts = stored.split("$");
    if (parts.length !== 3 || parts[0] !== GEO_UAT_PASSWORD_HASH_SCHEME_ ||
        !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{40,44}$/.test(parts[2])) {
      throwUatError_(503, "UAT credential hash format is invalid");
    }
    return uatConstantTimeEqual_(parts[2], uatPasswordDigest_(parts[1], password));
  }
  if (String(PropertiesService.getScriptProperties().getProperty("GEO_UAT_REQUIRE_HASHED_PASSWORDS") || "") === "true") return false;
  // Temporary backward compatibility only until the authorized migration.
  return uatConstantTimeEqual_(String(credential.temporary_password || ""), String(password));
}

// MANUAL RUN ONLY. Never invoked from the public /exec API.
// Before running, back up the restricted credential workbook, then set Script
// Property GEO_UAT_HASH_MIGRATION_APPROVED=YES. It writes hash first, verifies,
// and clears one plaintext password at a time; safe to rerun after interruption.
// It never logs employee IDs, passwords, salt, pepper or hashes.
function migrateUatCredentialsToSaltedHashes() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("GEO_UAT_HASH_MIGRATION_APPROVED") !== "YES")
    throw Error("Migration blocked: take a restricted backup, then set GEO_UAT_HASH_MIGRATION_APPROVED=YES.");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var workbook = SpreadsheetApp.openById(sheetIdFor_("B2B_GEO_UAT_Credentials_Distribution.xlsx"));
    if (workbook.getName() !== "UAT_Credentials") throw Error("Unexpected credentials workbook; no changes made.");
    var sheet = workbook.getSheetByName("UAT_Credentials");
    if (!sheet) throw Error("Missing UAT_Credentials tab");
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    var usernameCol = headers.indexOf("employee_id / username") + 1;
    var plainCol = headers.indexOf("temporary_password") + 1;
    var hashCol = headers.indexOf("password_hash") + 1;
    if (!usernameCol || !plainCol) throw Error("Missing employee_id / username or temporary_password column");
    var values = sheet.getDataRange().getDisplayValues();
    var seen = {};
    var plans = [];
    for (var i = 1; i < values.length; i++) {
      var username = String(values[i][usernameCol - 1] || "").trim();
      var plaintext = String(values[i][plainCol - 1] || "");
      var existingHash = hashCol ? String(values[i][hashCol - 1] || "").trim() : "";
      if (!username) continue;
      if (seen[username]) throw Error("Duplicate credential employee ID; abort before writing");
      seen[username] = true;
      if (existingHash && plaintext && !verifyUatPassword_({ password_hash: existingHash }, plaintext))
        throw Error("Credential hash and plaintext disagree; abort before writing");
      if (plaintext && !existingHash) plans.push({ row: i + 1, password: plaintext });
    }
    // Never rotate the pepper if hashes already exist.
    if (!props.getProperty(GEO_UAT_PASSWORD_PEPPER_PROPERTY_)) {
      if (values.some(function (row) { return hashCol && row[hashCol - 1]; }))
        throw Error("Hashed credentials exist but pepper is missing; restore the original pepper.");
      uatPasswordPepper_(true);
    }
    if (!hashCol) {
      hashCol = headers.length + 1;
      sheet.getRange(1, hashCol).setValue("password_hash");
    }
    for (var j = 0; j < plans.length; j++) {
      var task = plans[j];
      var salt = Utilities.getUuid().replace(/-/g, "").toLowerCase();
      var hash = GEO_UAT_PASSWORD_HASH_SCHEME_ + "$" + salt + "$" + uatPasswordDigest_(salt, task.password);
      sheet.getRange(task.row, hashCol).setValue(hash);
      SpreadsheetApp.flush();
      var written = String(sheet.getRange(task.row, hashCol).getDisplayValue() || "");
      if (written !== hash) throw Error("Hash verification failed; plaintext preserved for row " + task.row);
      sheet.getRange(task.row, plainCol).clearContent();
    }
    SpreadsheetApp.flush();
    var remaining = sheet.getRange(2, plainCol, Math.max(sheet.getLastRow() - 1, 1), 1)
      .getDisplayValues().filter(function (r) { return String(r[0]).trim(); }).length;
    if (remaining === 0) props.setProperty("GEO_UAT_REQUIRE_HASHED_PASSWORDS", "true");
    var summary = { ok: remaining === 0, migrated: plans.length, remainingPlaintext: remaining,
      hashedRequired: remaining === 0 };
    console.log(JSON.stringify(summary));
    return summary;
  } finally {
    lock.releaseLock();
  }
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

// Read-only check after pushing an updated Apps Script build.
// This highlights accidental binding to archived Config spreadsheets.
// It does NOT change any Script Properties or create new workbooks.
function debugB2bSheetBindings() {
  var defs = [
    ["B2B_GEO_Pipeline_DB.xlsx", "B2B_GEO_Pipeline_DB"],
    ["B2B_GEO_Pipeline_Config.xlsx", "B2B_GEO_Pipeline_Config"],
    ["B2B_GEO_User_Org_Master.xlsx", "B2B_GEO_User_Org_Master"],
  ];
  var props = PropertiesService.getScriptProperties();
  var results = defs.map(function (item) {
    var file = item[0], expectedTitle = item[1];
    var propKey = "GEO_SHEET_ID_" + file.replace(/\.xlsx$/, "");
    var runtimeId = props.getProperty(propKey);
    var sheetId = sheetIdFor_(file);
    if (!sheetId) return { file: file, ok: false, problem: "Missing Spreadsheet ID" };
    var book = SpreadsheetApp.openById(sheetId);
    var title = book.getName();
    return {
      file: file,
      sheetId: sheetId,
      source: runtimeId ? "Script Properties" : "generated SheetIds.js",
      actualTitle: title,
      expectedTitle: expectedTitle,
      ok: title === expectedTitle,
    };
  });
  console.log(JSON.stringify(results, null, 2));
  if (results.some(function (x) { return !x.ok; })) {
    console.warn("Sheet bindings need review before deployment; do not run setup() to replace an existing DB.");
  }
  return results;
}

// Run manually in Apps Script when changing the runtime Pipeline DB.
// It is read-only and helps confirm the deployed web app is bound to the intended sheet.
function debugPipelineDbBinding() {
  var file = "B2B_GEO_Pipeline_DB.xlsx";
  var id = sheetIdFor_(file);
  if (!id) throw new Error("Missing GEO_SHEET_ID_B2B_GEO_Pipeline_DB");
  var book = SpreadsheetApp.openById(id);
  var expected = ["Pipelines", "Pipeline_Events", "Snapshots", "Admin_Audit"];
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

// Safe, one-time schema preparation before deploying the new Admin audit writer.
// Run this MANUALLY against the existing DB. It never changes Pipelines, Events
// or Snapshots and refuses to overwrite an incompatible Admin_Audit header row.
function prepareAdminAuditSheet() {
  var file = "B2B_GEO_Pipeline_DB.xlsx";
  var id = sheetIdFor_(file);
  if (!id) throw new Error("Missing GEO_SHEET_ID_B2B_GEO_Pipeline_DB");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var book = SpreadsheetApp.openById(id);
    recoverGeoDb_(book);
    var name = "Admin_Audit";
    var columns = [
      "audit_id", "event_type", "source_file", "source_sheet",
      "source_record_id", "field_name", "previous_value", "new_value",
      "actor_user_id", "actor_name", "actor_role", "event_at",
    ];
    var ws = book.getSheetByName(name);
    if (!ws) {
      ws = book.insertSheet(name);
      ws.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight("bold");
      ws.setFrozenRows(1);
      SpreadsheetApp.flush();
      console.log("Created Admin_Audit in existing Pipeline DB: " + book.getName());
    } else {
      var existing = ws.getLastColumn()
        ? ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(String)
        : [];
      if (ws.getLastRow() === 0) {
        ws.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight("bold");
        ws.setFrozenRows(1);
      } else if (existing.join("|") !== columns.join("|")) {
        throw new Error("Existing Admin_Audit schema does not match; review manually. No cells changed.");
      }
      console.log("Admin_Audit schema verified: " + Math.max(0, ws.getLastRow() - 1) + " existing rows");
    }
    return { spreadsheetId: id, sheet: name, columns: columns.length };
  } finally {
    lock.releaseLock();
  }
}

// ---- Table store over Google Sheets (same interface as server/store.js) ----
function SheetStore_() {
  this.books = {};
  this.tables = {};
  this.loaded = {}; // key -> rows as read, to write only what changed
  this.dirty = {};
  this.pendingAppends = [];
  this.pendingCells = [];
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
    if (file === "B2B_GEO_Pipeline_DB.xlsx") recoverGeoDb_(this.books[file]);
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

// Queue optional export logs. Never append output logs before Pipeline + Event
// tables commit; a failed core write must not leave a false external audit export.
SheetStore_.prototype.append = function (file, sheet, records) {
  if (records && records.length) this.pendingAppends.push({ file: file, sheet: sheet, rows: records });
};

SheetStore_.prototype.appendNow_ = function (file, sheet, records) {
  var ws = this.book_(file).getSheetByName(sheet) || this.book_(file).insertSheet(sheet);
  var headers = ws.getLastColumn() ? ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0].map(String) : [];
  if (!headers.filter(String).length) {
    headers = Object.keys(records[0]);
    ws.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  ws.getRange(ws.getLastRow() + 1, 1, records.length, headers.length).setValues(
    records.map(function (r) {
      return headers.map(function (h) { return r[h] === undefined || r[h] === null ? "" : r[h]; });
    })
  );
};

// Single cell write for formula-layout sheets (Month-End Summary).
SheetStore_.prototype.setCell = function (file, sheet, a1, value) {
  // Derived summary cells must not change before canonical DB commits.
  this.pendingCells.push({ file: file, sheet: sheet, a1: a1, value: value });
};

SheetStore_.prototype.touch = function (file, sheet) {
  this.dirty[file + "|" + sheet] = { file: file, sheet: sheet };
};

// Crash-recoverable backups for runtime DB writes. Google Sheets does not
// provide multi-sheet ACID transactions, so use a write-ahead backup and restore.
// The script lock must be held for ALL data requests.
var GEO_DB_TXN_PROPERTY_ = "GEO_RUNTIME_DB_TXN";
var GEO_DB_BACKUP_PREFIX_ = "__GEO_BAK__";

function geoBackups_(book, sheets) {
  var backups = [];
  try {
    sheets.forEach(function (sheet) {
      var live = book.getSheetByName(sheet);
      if (!live) throw new Error("Missing live Pipeline DB sheet: " + sheet);
      var name = GEO_DB_BACKUP_PREFIX_ + sheet;
      if (book.getSheetByName(name)) throw new Error("Unresolved database backup: " + name);
      var copy = live.copyTo(book);
      copy.setName(name);
      copy.hideSheet();
      backups.push(name);
    });
    SpreadsheetApp.flush();
    return backups;
  } catch (error) {
    backups.forEach(function (name) {
      var backup = book.getSheetByName(name);
      if (backup) book.deleteSheet(backup);
    });
    throw error;
  }
}

// Audit/event sheets are immutable append logs. Copying their entire history
// before every Pipeline write is unnecessary. Persist their previous lastRow in
// the transaction marker, and trim appended rows during rollback instead.
function geoRollbackAppend_(book, name, originalLastRow) {
  var ws = book.getSheetByName(name);
  if (!ws) throw new Error("Missing append-only sheet " + name + " during rollback");
  if (!Number.isInteger(originalLastRow) || originalLastRow < 1 ||
      ws.getLastRow() < originalLastRow) {
    throw new Error("Append-only recovery checkpoint is invalid for " + name);
  }
  var excess = ws.getLastRow() - originalLastRow;
  if (excess > 0) {
    ws.deleteRows(originalLastRow + 1, excess);
  }
}

function restoreGeoSheet_(book, sheet) {
  var backup = book.getSheetByName(GEO_DB_BACKUP_PREFIX_ + sheet);
  if (!backup) throw new Error("Critical backup missing for " + sheet + "; manual recovery needed");
  var live = book.getSheetByName(sheet);
  if (!live) throw new Error("Live sheet missing for " + sheet + "; manual recovery needed");
  var values = backup.getDataRange().getValues();
  // Restore the entire used area, including headers and deleted rows.
  var lastRows = Math.max(live.getLastRow(), values.length);
  var lastCols = Math.max(live.getLastColumn(), values[0].length);
  if (live.getMaxRows() < lastRows) live.insertRowsAfter(live.getMaxRows(), lastRows - live.getMaxRows());
  if (live.getMaxColumns() < lastCols) live.insertColumnsAfter(live.getMaxColumns(), lastCols - live.getMaxColumns());
  live.getRange(1, 1, lastRows, lastCols).clearContent();
  live.getRange(1, 1, values.length, values[0].length).setValues(values);
}

function recoverGeoDb_(book) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(GEO_DB_TXN_PROPERTY_);
  if (!raw) {
    // Interrupted backup preparation cannot have changed live records yet.
    book.getSheets().forEach(function (ws) {
      if (ws.getName().indexOf(GEO_DB_BACKUP_PREFIX_) === 0) book.deleteSheet(ws);
    });
    return;
  }
  var marker = JSON.parse(raw);
  if (marker.spreadsheetId !== book.getId()) {
    throw new Error("Pending transaction references a different Pipeline DB; manual review required");
  }
  var backups = Array.isArray(marker.backupSheets) ? marker.backupSheets : marker.sheets;
  if (marker.status !== "committed") {
    // Backward compatible with older V4/V5 markers that backed up all sheets.
    backups.forEach(function (sheet) { restoreGeoSheet_(book, sheet); });
    Object.keys(marker.appendCheckpoints || {}).forEach(function (sheet) {
      geoRollbackAppend_(book, sheet, marker.appendCheckpoints[sheet]);
    });
    SpreadsheetApp.flush();
  }
  backups.forEach(function (sheet) {
    var backup = book.getSheetByName(GEO_DB_BACKUP_PREFIX_ + sheet);
    if (backup) book.deleteSheet(backup);
  });
  props.deleteProperty(GEO_DB_TXN_PROPERTY_);
}

// Spreadsheet writes must preserve identifier/month strings and must never
// interpret user-provided text as a formula. Format columns BEFORE setValues.
// Only explicitly textual fields receive TEXT format; amounts remain numeric.
var GEO_PLAIN_TEXT_HEADERS_ = {
  audit_id: true, actor_user_id: true, business_id: true, contact_phone: true,
  created_month: true, employee_id: true, "employee_id / username": true,
  expected_close_month: true, snapshot_period: true, source_record_id: true,
  opportunity_id: true, event_id: true, snapshot_id: true,
  previous_value: true, new_value: true, lost_note: true, support_note: true,
  remark: true, notes: true, customer_name: true, contact_name: true,
  partner_name: true, product_details: true,
};

function geoSafeSheetValue_(value) {
  if (value === undefined || value === null) return "";
  // SpreadsheetApp.setValues interprets strings beginning with '=' as formulas.
  // Escape Excel-style formula prefixes as well, including after whitespace.
  if (typeof value === "string" && /^[\s\uFEFF]*[=+@-]/.test(value)) return "'" + value;
  return value;
}

function geoTextColumns_(ws, headers, firstRow, rowCount) {
  if (rowCount < 1) return;
  headers.forEach(function (header, index) {
    if (GEO_PLAIN_TEXT_HEADERS_[header] || /_id$/.test(header)) {
      ws.getRange(firstRow, index + 1, rowCount, 1).setNumberFormat("@");
    }
  });
}

SheetStore_.prototype.writeDirty_ = function (d) {
  var key = d.file + "|" + d.sheet;
  var t = this.tables[key];
  var before = this.loaded[key] || { headers: [], rows: [], json: [] };
  t.rows.forEach(function (r) {
    Object.keys(r).forEach(function (k) { if (t.headers.indexOf(k) < 0) t.headers.push(k); });
  });
  var ws = this.book_(d.file).getSheetByName(d.sheet) || this.book_(d.file).insertSheet(d.sheet);
  var toValues = function (r) {
    return t.headers.map(function (h) { return geoSafeSheetValue_(r[h]); });
  };
  if (d.file === "B2B_GEO_Pipeline_DB.xlsx" &&
      (d.sheet === "Pipeline_Events" || d.sheet === "Admin_Audit")) {
    // Refuse any mutation to committed audit rows or sheet headers. This
    // guarantee makes lastRow rollback equivalent to an append-only undo.
    if (t.headers.join("\u0001") !== before.headers.join("\u0001") ||
        t.rows.length < before.rows.length ||
        before.json.some(function (json, i) { return JSON.stringify(t.rows[i]) !== json; })) {
      throw Error("Append-only audit sheet may not rewrite existing records");
    }
    var appended = t.rows.slice(before.rows.length);
    if (!appended.length) return;
    if (ws.getLastRow() !== before.rows.length + 1) {
      throw Error("Append-only audit sheet has unexpected blank or extra rows");
    }
    var firstRow = ws.getLastRow() + 1;
    var finalRow = firstRow + appended.length - 1;
    if (ws.getMaxRows() < finalRow) {
      ws.insertRowsAfter(ws.getMaxRows(), finalRow - ws.getMaxRows());
    }
    geoTextColumns_(ws, t.headers, firstRow, appended.length);
    ws.getRange(firstRow, 1, appended.length, t.headers.length)
      .setValues(appended.map(toValues));
    return;
  }
  var sameShape =
    before.rows.length > 0 &&
    t.headers.join("\u0001") === before.headers.join("\u0001") &&
    t.rows.length >= before.rows.length &&
    before.rows.every(function (r, i) { return t.rows[i] === r; });

  if (sameShape) {
    // Existing-row changes remain surgical. New rows are written in one
    // contiguous block (critical for 100-200 row imports).
    for (var i = 0; i < before.rows.length; i++) {
      if (JSON.stringify(t.rows[i]) === before.json[i]) continue;
      geoTextColumns_(ws, t.headers, i + 2, 1);
      ws.getRange(i + 2, 1, 1, t.headers.length).setValues([toValues(t.rows[i])]);
    }
    var newRows = t.rows.slice(before.rows.length);
    if (newRows.length) {
      var startRow = before.rows.length + 2;
      var lastRowNeeded = startRow + newRows.length - 1;
      if (ws.getMaxRows() < lastRowNeeded) {
        ws.insertRowsAfter(ws.getMaxRows(), lastRowNeeded - ws.getMaxRows());
      }
      geoTextColumns_(ws, t.headers, startRow, newRows.length);
      ws.getRange(startRow, 1, newRows.length, t.headers.length)
        .setValues(newRows.map(toValues));
    }
  } else {
    // Pre-size before clearing. Failed resize must not destroy the old table.
    if (ws.getMaxRows() < t.rows.length + 1) ws.insertRowsAfter(ws.getMaxRows(), t.rows.length + 1 - ws.getMaxRows());
    if (ws.getMaxColumns() < t.headers.length) ws.insertColumnsAfter(ws.getMaxColumns(), t.headers.length - ws.getMaxColumns());
    ws.getRange(1, 1, 1, t.headers.length).setValues([t.headers]);
    var last = ws.getLastRow();
    if (last > 1) ws.getRange(2, 1, last - 1, Math.max(ws.getLastColumn(), t.headers.length)).clearContent();
    if (t.rows.length) {
      geoTextColumns_(ws, t.headers, 2, t.rows.length);
      ws.getRange(2, 1, t.rows.length, t.headers.length).setValues(t.rows.map(toValues));
    }
  }
};

// Commit live DB first, guarded by a backup; export templates are derived and
// best-effort, so an export failure cannot report a committed Pipeline as failed.
SheetStore_.prototype.flush = function () {
  var self = this;
  var dirty = Object.keys(this.dirty).map(function (key) { return self.dirty[key]; });
  var critical = dirty.filter(function (d) { return d.file === "B2B_GEO_Pipeline_DB.xlsx"; });
  var derived = dirty.filter(function (d) { return d.file !== "B2B_GEO_Pipeline_DB.xlsx"; });
  if (critical.length) {
    var book = this.book_("B2B_GEO_Pipeline_DB.xlsx");
    var sheets = critical.map(function (d) { return d.sheet; });
    var props = PropertiesService.getScriptProperties();
    var appendSheets = sheets.filter(function (name) { return name === "Pipeline_Events" || name === "Admin_Audit"; });
    var backupSheets = sheets.filter(function (name) { return appendSheets.indexOf(name) < 0; });
    var appendCheckpoints = {};
    appendSheets.forEach(function (name) {
      var ws = book.getSheetByName(name);
      if (!ws || ws.getLastRow() < 1) throw Error("Missing append-only sheet or header: " + name);
      appendCheckpoints[name] = ws.getLastRow();
    });
    // Keep full sheet backups only for mutable tables. Audit tables cannot be
    // changed in place and are restored by removing appended rows.
    geoBackups_(book, backupSheets);
    try {
      props.setProperty(GEO_DB_TXN_PROPERTY_, JSON.stringify({
        spreadsheetId: book.getId(), sheets: sheets, backupSheets: backupSheets,
        appendCheckpoints: appendCheckpoints, status: "prepared"
      }));
    } catch (markerError) {
      sheets.forEach(function (sheet) {
        var orphan = book.getSheetByName(GEO_DB_BACKUP_PREFIX_ + sheet);
        if (orphan) book.deleteSheet(orphan);
      });
      throw markerError;
    }
    try {
      critical.forEach(function (d) { self.writeDirty_(d); });
      SpreadsheetApp.flush();
      // Mark committed BEFORE cleanup: a crash during backup deletion must
      // never roll back a fully committed operation.
      props.setProperty(GEO_DB_TXN_PROPERTY_, JSON.stringify({
        spreadsheetId: book.getId(), sheets: sheets, backupSheets: backupSheets,
        appendCheckpoints: appendCheckpoints, status: "committed"
      }));
    } catch (error) {
      try { recoverGeoDb_(book); } catch (restoreError) { console.error("URGENT: DB restore required: " + restoreError.message); }
      throw error;
    }
    try { recoverGeoDb_(book); } catch (cleanupError) { console.warn("DB backup cleanup deferred: " + cleanupError.message); }
  }
  // These are source Master workbooks, not optional export mirrors.
  // Never tell the UI that a Master edit succeeded when its Sheet write failed.
  // Cross-workbook operations are not ACID: if this throws after Admin_Audit
  // committed, reconcile the audit and master data before retrying.
  derived.forEach(function (d) {
    try {
      self.writeDirty_(d);
    } catch (error) {
      console.error("Master workbook write failed: " + d.file + " / " + d.sheet + ": " + error.message);
      throw new Error("Master data save failed for " + d.sheet + ". Check the master Sheet and Admin_Audit before retrying.");
    }
  });
  this.pendingAppends.forEach(function (a) {
    try { self.appendNow_(a.file, a.sheet, a.rows); } catch (error) { console.warn("Audit export append failed: " + error.message); }
  });
  this.pendingCells.forEach(function (a) {
    try {
      var sheet = self.book_(a.file).getSheetByName(a.sheet);
      if (sheet) sheet.getRange(a.a1).setValue(a.value);
    } catch (error) { console.warn("Derived summary cell failed: " + error.message); }
  });
  this.dirty = {};
  this.pendingAppends = [];
  this.pendingCells = [];
  try { SpreadsheetApp.flush(); } catch (error) { console.warn("Derived export flush failed: " + error.message); }
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

// Legacy output-template initialization was retired: exports are created
// on demand and the three standalone template spreadsheets are not writable
// runtime dependencies.


// Phase 4 UAT migration: creates TWO new tabs inside the canonical DB only.
// No existing Pipelines, Pipeline_Events, Snapshots, or Admin_Audit cells touched.
// Must be invoked by an authorized operator after verifying the DB binding.
function prepareGeoPhase4Sheets() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("GEO_PHASE4_SCHEMA_APPROVED") !== "YES")
    throw Error("Set GEO_PHASE4_SCHEMA_APPROVED=YES only after a restricted DB backup");
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var expectedId="1z2alvS2BSRCll-6CaQq2HetuVCjYW43cpdSuXTZNthc";
    var actualId=sheetIdFor_("B2B_GEO_Pipeline_DB.xlsx");
    if(actualId !== expectedId)throw Error("Pipeline DB binding differs from verified UAT workbook");
    var book=SpreadsheetApp.openById(actualId);
    if(book.getName()!=="B2B_GEO_Pipeline_DB")throw Error("Unexpected DB workbook name");
    var tables=[
      ["Handoff_Notifications",GEO_CONTRACT.columns.handoff_notifications],
      ["Support_Requests",GEO_CONTRACT.columns.support_requests]
    ];
    var result=[];
    tables.forEach(function(item){
      var ws=book.getSheetByName(item[0]);
      if(!ws){
        ws=book.insertSheet(item[0]);
        ws.getRange(1,1,1,item[1].length).setNumberFormat("@").setValues([item[1]]);
        result.push({tab:item[0],created:true});
        return;
      }
      var headers=ws.getRange(1,1,1,Math.max(1,ws.getLastColumn())).getDisplayValues()[0];
      if(item[1].join("|")!==headers.slice(0,item[1].length).join("|"))
        throw Error("Existing "+item[0]+" headers differ; stop for manual reconciliation");
      result.push({tab:item[0],created:false});
    });
    SpreadsheetApp.flush();
    console.log(JSON.stringify({ok:true,verifiedPipelineRows:book.getSheetByName("Pipelines").getLastRow()-1,tables:result}));
    return {ok:true,tables:result};
  } finally {lock.releaseLock();}
}

// One first-of-month trigger at 02:00 Bangkok captures the PREVIOUS month.
// Re-running the scheduled function is idempotent: existing period is NEVER overwritten.
function installGeoMonthEndSnapshotTrigger() {
  if(PropertiesService.getScriptProperties().getProperty("GEO_AUTO_SNAPSHOT_APPROVED")!=="YES")
    throw Error("Set GEO_AUTO_SNAPSHOT_APPROVED=YES after confirming snapshot permissions");
  var existing=ScriptApp.getProjectTriggers().filter(function(t){
    return t.getHandlerFunction()==="runGeoMonthEndSnapshot";
  });
  if(existing.length) return {ok:true,alreadyInstalled:true,count:existing.length};
  ScriptApp.newTrigger("runGeoMonthEndSnapshot")
    .timeBased().onMonthDay(1).atHour(2).inTimezone("Asia/Bangkok").create();
  return {ok:true,alreadyInstalled:false};
}

function runGeoMonthEndSnapshot() {
  if(PropertiesService.getScriptProperties().getProperty("GEO_AUTO_SNAPSHOT_APPROVED")!=="YES")
    throw Error("Automatic month-end snapshot is not approved");
  var lock=LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var today=Utilities.formatDate(new Date(),"Asia/Bangkok","yyyy-MM-dd");
    if(today.slice(-2)!=="01") return {ok:true,skipped:"Not first day in Bangkok"};
    var yyyy=Number(today.slice(0,4)), mm=Number(today.slice(5,7));
    var period=new Date(Date.UTC(yyyy,mm-2,1)).toISOString().slice(0,7);
    var store=new SheetStore_();
    var prior=store.table("B2B_GEO_Pipeline_DB.xlsx","Snapshots").rows;
    if(prior.some(function(r){return String(r.snapshot_period)===period;})){
      return {ok:true,period:period,skipped:"Snapshot already captured"};
    }
    var admins=store.table("B2B_GEO_User_Org_Master.xlsx","Users").rows.filter(function(r){
      return String(r.role).toLowerCase()==="admin" && String(r.status||"Active").toLowerCase()==="active";
    });
    if(!admins.length)throw Error("No active Admin in User Master for scheduled snapshot");
    var core=GeoCoreLib.createCore({contract:GEO_CONTRACT,store:store,
      now:function(){return new Date().toISOString();},
      uuid:function(){return Utilities.getUuid();}
    });
    var result=core.handle({method:"POST",path:"snapshots/capture",
      body:{snapshot_period:period},userId:admins[0].user_id});
    store.flush();
    console.log(JSON.stringify({ok:true,period:period,captured:result.captured}));
    return {ok:true,period:period,captured:result.captured};
  } finally {lock.releaseLock();}
}


// Run ONCE after prepareGeoPhase4Sheets. Migrates historical support_needed
// flags into the new workflow without changing any existing Pipeline rows.
// The source column marks them as migrated, not freshly requested by an AE.
function backfillGeoPhase4SupportFlags() {
  if(PropertiesService.getScriptProperties().getProperty("GEO_PHASE4_SCHEMA_APPROVED")!=="YES")
    throw Error("Approve Phase 4 schema migration and keep a restricted DB backup first");
  var lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    var store=new SheetStore_();
    var pipelines=store.table("B2B_GEO_Pipeline_DB.xlsx","Pipelines").rows;
    var requests=store.table("B2B_GEO_Pipeline_DB.xlsx","Support_Requests");
    var headers=GEO_CONTRACT.columns.support_requests || [];
    if(!headers.length)throw Error("Missing Support Request schema");
    if(requests.headers.join("|") !== headers.join("|"))
      throw Error("Unexpected Support_Requests headers; no records changed");
    var seen={};
    requests.rows.forEach(function(r){if(r.opportunity_id && r.status!=="Resolved")seen[r.opportunity_id]=true;});
    var stamp=new Date().toISOString(),created=0;
    pipelines.forEach(function(op){
      if(!["yes","true","1"].includes(String(op.support_needed||"").toLowerCase().trim()) ||
         !op.opportunity_id || seen[op.opportunity_id]) return;
      if(!op.support_type_id || !String(op.support_note||"").trim())return;
      requests.rows.push({
        request_id:"SRQ-"+Utilities.getUuid(),
        opportunity_id:op.opportunity_id,region_id:op.region_id,
        request_type_id:op.support_type_id,note:op.support_note,
        status:"Open",requested_by_user_id:"",assigned_to_user_id:"",
        response_note:"",created_at:stamp,updated_at:stamp,resolved_at:"",
        source:"migration"
      });
      seen[op.opportunity_id]=true;created++;
    });
    if(created)store.touch("B2B_GEO_Pipeline_DB.xlsx","Support_Requests");
    store.flush();
    var result={ok:true,created:created,totalSupportRequests:requests.rows.length,
      pipelineRows:pipelines.length};
    console.log(JSON.stringify(result));return result;
  }finally{lock.releaseLock();}
}
