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
// Public non-secret release marker: compare this exact value against the
// deployed /exec health response before enabling the new frontend.
var GEO_RELEASE_TAG_ = "geo-uat-login-e2e-20261027-r2";
function doGet(e) {
  // Never accept serialized API requests over GET: tokens in query strings leak
  // into browser history and intermediaries. The authenticated client uses POST.
  if (e && e.parameter && Object.prototype.hasOwnProperty.call(e.parameter, "req")) {
    return json_({ status: 405, body: { message: "Use POST for API requests" } });
  }
  return json_({ status: 200, body: { ok: true, service: "B2B GEO Pipeline API", release: GEO_RELEASE_TAG_ }, health: true });
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
    var errorId = Utilities.getUuid();
    // Internal exceptions may contain workbook identifiers or service errors.
    // Log them server-side with a support reference, never in a public response.
    if (!err.status || err.status >= 500) {
      console.error("API error " + errorId + ": " + (err && err.stack ? err.stack : err));
    }
    var status = err.status || 500;
    var publicCode = err.publicCode || ({401:"UNAUTHENTICATED",403:"FORBIDDEN",409:"CONFLICT",410:"GONE",428:"PRECONDITION_REQUIRED",429:"RATE_LIMITED",503:"DATA_SOURCE_ERROR"}[status] || "REQUEST_ERROR");
    out = { status: status, body: status >= 500
      ? { message: "Backend request failed. Contact support with error ID " + errorId, error_id: errorId, code: publicCode }
      : { message: String((err && err.message) || "Request failed"), code: publicCode } };
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

    // Activation is a purpose-limited UAT flow, never an authenticated app session.
    // Each request runs under the same script lock as ordinary writes.
    var authPath = String(req.path || "").split("/").filter(Boolean).join("/");
    if (req.method === "POST" && authPath === "auth/activation/verify") {
      return verifyUatActivation_(store, req.body || {});
    }
    if (req.method === "POST" && authPath === "auth/activation/complete") {
      var activationResult = completeUatActivation_(store, req.body || {});
      // Persist before reporting success; otherwise the one-time code could be
      // reused after the response while the credential row remains unchanged.
      store.flush();
      geoVerifyUatCredentialPersisted_(store);
      return activationResult;
    }
    if (req.method === "POST" && authPath === "auth/temporary-password/complete") {
      var passwordSetupResult = completeUatTemporaryPasswordSetup_(store, req.body || {});
      // Never tell a user their password was saved before Sheets has committed it.
      store.flush();
      geoVerifyUatCredentialPersisted_(store);
      return passwordSetupResult;
    }

    // All other requests must present a valid signed session.
    // Never accept the userId claimed by the browser as proof of identity.
    req.userId = verifyUatSession_(req.sessionToken);
    delete req.sessionToken;
    // Pre-migration sessions must not bypass mandatory personal password setup.
    if (uatTemporarySetupEnabled_()) {
      var currentUsers = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows.filter(function (u) {
        return String(u.user_id || "").trim() === req.userId;
      });
      var currentCreds = store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows.filter(function (c) {
        return String(c.user_id || "").trim() === req.userId;
      });
      if (currentUsers.length !== 1 ||
          String(currentUsers[0].status || "").toLowerCase() !== "active" ||
          currentCreds.length !== 1 ||
          String(currentCreds[0].credential_status || "") !== "active" ||
          !String(currentCreds[0].password_set_at || "").trim() ||
          !String(currentCreds[0].password_hash || "").trim()) {
        throwUatError_(401, "Password setup required. Sign in with your temporary password.");
      }
    }

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
  // This endpoint is never a valid Production identity provider.
  var environment = String(PropertiesService.getScriptProperties().getProperty("GEO_ENVIRONMENT") || "").toUpperCase();
  if (environment === "PRODUCTION" || environment === "PROD")
    throwUatError_(503, "UAT password login is disabled in Production");
  // Email authentication is UAT-only, even if an email flag is accidentally enabled elsewhere.
  var emailMode = environment === "UAT" &&
    PropertiesService.getScriptProperties().getProperty("GEO_UAT_EMAIL_LOGIN_ENABLED") === "true";
  var usingEmail = emailMode && String(body.username || "").indexOf("@") >= 0;
  var username = usingEmail ? normalizeUatCorporateEmail_(body.username) : normalizeEmployeeId_(body.username);
  var password = String(body.password || "");
  var limiter = CacheService.getScriptCache();
  var key = username ? "GEO_LOGIN_FAIL_" + sessionB64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, username)).slice(0, 24) : "";
  // Do not lock a legitimate user out merely because somebody previously
  // submitted bad passwords for the same Employee ID. Verify credentials
  // first; only invalid attempts are rate-limited below.
  // Keep aggregate abuse alerts and invalid-attempt throttling in UAT.
  if (!username || !password) {
    throwUatError_(400, "Username and password are required");
  }

  var users = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows;
  var matchingUsers = users.filter(function (row) {
    return usingEmail ? (username && normalizeUatCorporateEmail_(row.email) === username) :
      normalizeEmployeeId_(row.employee_id) === username;
  });

  // A duplicated Employee ID must never select whichever account happens to
  // appear first: that could issue a signed session for a different user/role.
  if (matchingUsers.length !== 1 ||
      String(matchingUsers[0].status || "Active").toLowerCase() !== "active") {
    denyUatLogin_(limiter, key);
  }
  var user = matchingUsers[0];

  var credentials = store
    .table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials")
    .rows;

  var matchingCredentials = credentials.filter(function (row) {
    return usingEmail ? String(row.user_id || "").trim() === String(user.user_id || "").trim() :
      normalizeEmployeeId_(row["employee_id / username"]) === username;
  });

  // Fail closed on ambiguous or inconsistent identity bindings. An empty
  // credential user_id remains supported for legacy UAT rows; populated IDs
  // must agree with the authenticated Users row.
  var credential = matchingCredentials.length === 1 ? matchingCredentials[0] : null;
  var needsSetup = credential && !usingEmail && uatTemporarySetupEnabled_() &&
    uatTemporaryCredentialPending_(credential);
  if (matchingCredentials.length !== 1 ||
      (String(matchingCredentials[0].user_id || "").trim() &&
       String(matchingCredentials[0].user_id).trim() !== String(user.user_id || "").trim()) ||
      (usingEmail && (!uatCorporateDomainAllowed_(username) ||
        !normalizeEmployeeId_(user.employee_id) ||
        normalizeEmployeeId_(matchingCredentials[0]["employee_id / username"]) !== normalizeEmployeeId_(user.employee_id) ||
        String(matchingCredentials[0].credential_status || "") !== "active" ||
        !String(matchingCredentials[0].password_set_at || "").trim() ||
        !String(matchingCredentials[0].password_hash || "").trim())) ||
      !(needsSetup ? uatTemporaryPasswordMatches_(credential, password) :
        verifyUatPassword_(credential, password))) {
    denyUatLogin_(limiter, key);
  }
  if (!usingEmail && uatTemporarySetupEnabled_() && !needsSetup &&
      (String(credential.credential_status || "") !== "active" ||
       !String(credential.password_set_at || "").trim() ||
       !String(credential.password_hash || "").trim())) {
    denyUatLogin_(limiter, key);
  }
  if (key) limiter.remove(key);
  // Correct temporary credentials confer no app session or Pipeline access.
  if (needsSetup) {
    // First-use secret initialization is UAT-only, locked, and permitted only
    // after the existing temporary credential has been verified.
    uatEnsureFirstLoginSecrets_(store);
    return { password_setup_required: true,
      password_setup_ticket: uatTemporarySetupTicket_(String(user.user_id), credential),
      expires_in_seconds: 600 };
  }

  return {
    user_id: String(user.user_id || ""),
    id: String(user.user_id || ""),
    full_name: String(user.display_name || ""),
    role: String(user.role || "AE"),
    session_token: issueUatSession_(String(user.user_id || "")),
  };
}

function denyUatLogin_(cache, key) {
  // A valid password always clears the counter in uatLogin_ and succeeds.
  // Wrong guesses beyond the threshold are throttled without revealing how
  // long the security cache lasts, or whether an account exists.
  var priorFailures = key ? Number(cache.get(key) || 0) : 0;
  if (key) cache.put(key, String(priorFailures + 1), 600);
  var globalKey = "GEO_LOGIN_FAIL_GLOBAL_V1";
  var attempts = Number(cache.get(globalKey) || 0) + 1;
  cache.put(globalKey, String(attempts), 600);
  if (attempts >= 50 && !cache.get("GEO_LOGIN_SPRAY_ALERT_V1")) {
    cache.put("GEO_LOGIN_SPRAY_ALERT_V1", "1", 600);
    console.warn("UAT_SECURITY_ALERT: high aggregate failed login count; investigate. No employee ID was logged.");
  }
  if (priorFailures >= 5) throwUatError_(429, "Sign-in temporarily limited for security. Contact your account administrator if a valid password is rejected.");
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
  // Fail closed by default. Allow temporary plaintext only if explicitly
  // approved during a time-boxed UAT migration window.
  if (!geoUatTemporaryPasswordWindowOpen_()) return false;
  return uatConstantTimeEqual_(String(credential.temporary_password || ""), String(password));
}

// The emergency plaintext window is deliberately UAT-only and reversible.
// Existing Script Properties continue to work without expiry, but any new
// recovery window configured by the operator expires automatically.
function geoUatTemporaryPasswordWindowOpen_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS") !== "true") return false;
  var environment = String(props.getProperty("GEO_ENVIRONMENT") || "").toUpperCase();
  if (environment !== "UAT") return false;
  var expiresAt = props.getProperty("GEO_UAT_TEMP_PASSWORD_EXPIRES_AT");
  if (expiresAt) {
    var timestamp = Date.parse(expiresAt);
    if (!Number.isFinite(timestamp) || Date.now() >= timestamp) return false;
  }
  return true;
}

// The first valid UAT temporary-password login can safely prepare absent
// authentication secrets, eliminating a shared 503 across all users when a new
// Code.gs is deployed before the editor-only setup helper was run.
//
// This runs under handle_()'s ScriptLock *after* the password was verified.
// Never overwrite existing secrets. Never invent a pepper when any stored
// password hash already exists: it would permanently invalidate those hashes.
// This is intentionally not available outside controlled UAT migration.
function uatEnsureFirstLoginSecrets_(store) {
  if (!uatTemporarySetupEnabled_())
    throwUatError_(503, "UAT first-login migration is not enabled");
  var props = PropertiesService.getScriptProperties();
  var hasPepper = !!props.getProperty(GEO_UAT_PASSWORD_PEPPER_PROPERTY_);
  if (!hasPepper) {
    var creds = store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows;
    if (creds.some(function (c) { return !!String(c.password_hash || "").trim(); }))
      throwUatError_(503, "Existing password hashes require the original UAT pepper; do not reset it");
    uatPasswordPepper_(true);
  }
  // Signing key is independent from the credential pepper; a missing key can
  // be created once, but already-issued tickets cannot survive key rotation.
  uatActivationSecret_(true);
}

// ---- UAT first-login password setup (Employee ID temporary credentials) ----
// Separate from email activation: validating a temporary password never issues
// an application session. Feature flag defaults OFF until matching UI is deployed.
function uatTemporarySetupEnabled_() {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty("GEO_ENVIRONMENT") === "UAT" &&
    p.getProperty("GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED") === "true";
}
function uatTemporaryCredentialPending_(c) {
  return !String(c.credential_status || "").trim() &&
    !String(c.password_set_at || "").trim() &&
    !String(c.activation_code_hash || "").trim() &&
    !String(c.activation_expires_at || "").trim() &&
    !String(c.activation_used_at || "").trim() &&
    (!!String(c.password_hash || "").trim() || !!String(c.temporary_password || "").trim());
}
function uatTemporaryPasswordMatches_(c, password) {
  if (String(c.password_hash || "").trim()) return verifyUatPassword_(c, password);
  var stored = String(c.temporary_password || "");
  return !!stored && uatConstantTimeEqual_(stored, String(password || ""));
}
function uatTemporaryFingerprint_(uid, c) {
  var storedHash = String(c.password_hash || "").trim();
  var material = storedHash ? "hash:" + storedHash : "temp:" + String(c.temporary_password || "");
  return sessionB64_(Utilities.computeHmacSha256Signature(
    "uat-temp-setup:" + uid + ":" + material, uatActivationSecret_(false)));
}
function uatTemporarySetupTicket_(uid, c) {
  var ts = Math.floor(Date.now() / 1000);
  var payload = sessionB64_(Utilities.newBlob(JSON.stringify({
    v: 1, typ: "uat_temp_setup", sub: uid, fp: uatTemporaryFingerprint_(uid, c),
    iat: ts, exp: ts + 600
  })).getBytes());
  return payload + "." + sessionB64_(Utilities.computeHmacSha256Signature(
    payload, uatActivationSecret_(false)));
}
function uatReadTemporarySetupTicket_(ticket) {
  if (typeof ticket !== "string" || !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(ticket))
    throwUatError_(401, "Password setup expired. Sign in with your temporary password again.");
  var pieces = ticket.split(".");
  var signature = sessionB64_(Utilities.computeHmacSha256Signature(
    pieces[0], uatActivationSecret_(false)));
  if (!uatConstantTimeEqual_(signature, pieces[1]))
    throwUatError_(401, "Password setup expired. Sign in with your temporary password again.");
  var data;
  try {
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pieces[0])).getDataAsString("UTF-8"));
  } catch (err) { throwUatError_(401, "Password setup expired. Sign in with your temporary password again."); }
  var now = Math.floor(Date.now() / 1000);
  if (data.v !== 1 || data.typ !== "uat_temp_setup" ||
      typeof data.sub !== "string" || !data.sub || typeof data.fp !== "string" ||
      !Number.isInteger(data.iat) || !Number.isInteger(data.exp) ||
      data.iat > now + 60 || data.exp <= now || data.exp - data.iat !== 600) {
    throwUatError_(401, "Password setup expired. Sign in with your temporary password again.");
  }
  return data;
}
function completeUatTemporaryPasswordSetup_(store, body) {
  if (!uatTemporarySetupEnabled_()) throwUatError_(503, "UAT password setup is not enabled");
  var ticket = uatReadTemporarySetupTicket_(body.password_setup_ticket);
  var matches = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows.filter(function (u) {
    return String(u.user_id || "").trim() === ticket.sub;
  });
  if (matches.length !== 1 || String(matches[0].status || "").toLowerCase() !== "active" ||
      !normalizeEmployeeId_(matches[0].employee_id))
    throwUatError_(401, "Password setup expired. Sign in again.");
  var employeeId = normalizeEmployeeId_(matches[0].employee_id);
  var creds = store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows.filter(function (c) {
    return String(c.user_id || "").trim() === ticket.sub ||
      normalizeEmployeeId_(c["employee_id / username"]) === employeeId;
  });
  if (creds.length !== 1 || String(creds[0].user_id || "").trim() !== ticket.sub ||
      normalizeEmployeeId_(creds[0]["employee_id / username"]) !== employeeId ||
      !uatTemporaryCredentialPending_(creds[0]) ||
      !uatConstantTimeEqual_(uatTemporaryFingerprint_(ticket.sub, creds[0]), ticket.fp))
    throwUatError_(401, "Password setup expired. Sign in again.");
  var c = creds[0];
  var pass = uatCheckNewPassword_(body.new_password, normalizeUatCorporateEmail_(matches[0].email));
  if (pass !== String(body.confirm_password || "")) throwUatError_(400, "Passwords do not match");
  if (pass.indexOf(employeeId) !== -1 || uatTemporaryPasswordMatches_(c, pass))
    throwUatError_(400, "Choose a new password that differs from the temporary password and Employee ID");
  // The live credential row must be writable before we consume its
  // one-time ticket or clear the old temporary password.
  geoAssertUatCredentialRowWritable_(store, c);
  // Pepper must be provisioned securely before any login migration.
  uatPasswordPepper_(false);
  var salt = Utilities.getUuid().replace(/-/g, "");
  var now = new Date().toISOString();
  c.password_hash = GEO_UAT_PASSWORD_HASH_SCHEME_ + "$" + salt + "$" + uatPasswordDigest_(salt, pass);
  c.password_hash_version = GEO_UAT_PASSWORD_HASH_SCHEME_;
  c.temporary_password = "";
  c.password_set_at = now;
  c.password_changed_at = now;
  c.credential_status = "active";
  store.touch("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials");
  store.geoCredentialUserToVerify = ticket.sub; // server-only; never sent to browser
  // handle_ flushes and reads the committed Sheet before returning success.
  return { password_set: true };
}

// ---- Opt-in UAT Corporate Email Activation ----
// IMPORTANT: Script Properties default to disabled. Never use this as Production auth.
// A custodian must verify the employee's corporate mailbox by an approved channel;
// checking an email suffix or issuing an activation code is NOT proof of ownership.
// Codes are only shown once as a return value to the authorized Apps Script editor.
function normalizeUatCorporateEmail_(v) {
  var email = String(v || "").trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
function uatCorporateDomainAllowed_(email) {
  var domains = String(PropertiesService.getScriptProperties().getProperty("GEO_UAT_ALLOWED_EMAIL_DOMAINS") || "")
    .toLowerCase().split(",").map(function (s) { return s.trim().replace(/^@/, ""); }).filter(Boolean);
  return domains.length > 0 && domains.indexOf(String(email || "").split("@")[1]) >= 0;
}
function uatActivationEnabled_() {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty("GEO_ENVIRONMENT") === "UAT" &&
    p.getProperty("GEO_UAT_EMAIL_ACTIVATION_ENABLED") === "true";
}
function uatActivationSecret_(create) {
  var p = PropertiesService.getScriptProperties(), name = "GEO_UAT_ACTIVATION_SECRET";
  var val = p.getProperty(name);
  if (!val && create) {
    val = [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid()].join("-");
    p.setProperty(name, val);
  }
  if (!val) throwUatError_(503, "UAT activation signing is not configured");
  return val;
}
function uatActivationDigest_(code) {
  return sessionB64_(Utilities.computeHmacSha256Signature("activate:" + String(code || ""), uatActivationSecret_(false)));
}
function uatActivationFind_(store, email) {
  var normalized = normalizeUatCorporateEmail_(email);
  if (!normalized || !uatCorporateDomainAllowed_(normalized)) throwUatError_(401, "Invalid activation credentials");
  // Duplicate email across inactive and active accounts must fail closed:
  // an inactive duplicate must not make the active identity ambiguous.
  var matches = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows.filter(function (u) {
    return normalizeUatCorporateEmail_(u.email) === normalized;
  });
  if (matches.length !== 1 || String(matches[0].status || "").toLowerCase() !== "active" ||
      !normalizeEmployeeId_(matches[0].employee_id))
    throwUatError_(401, "Invalid activation credentials");
  var uid = String(matches[0].user_id || "").trim();
  var credentials = store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows
    .filter(function (c) { return String(c.user_id || "").trim() === uid; });
  if (!uid || credentials.length !== 1 ||
      normalizeEmployeeId_(credentials[0]["employee_id / username"]) !== normalizeEmployeeId_(matches[0].employee_id))
    throwUatError_(401, "Invalid activation credentials");
  return { user: matches[0], credential: credentials[0] };
}
function uatActivationRate_(email, success) {
  var cache = CacheService.getScriptCache();
  var key = "GEO_UAT_ACTFAIL_" +
    sessionB64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(email || ""))).slice(0, 24);
  if (success) { cache.remove(key); return; }
  var count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 600);
}
function uatActivationTicket_(uid, digest) {
  var ts = Math.floor(Date.now() / 1000);
  var payload = sessionB64_(Utilities.newBlob(JSON.stringify({
    v: 1, typ: "uat_activate", sub: uid, fp: digest, iat: ts, exp: ts + 600
  })).getBytes());
  return payload + "." + sessionB64_(Utilities.computeHmacSha256Signature(
    payload, uatActivationSecret_(false)));
}
function uatReadActivationTicket_(ticket) {
  if (typeof ticket !== "string" ||
      !/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(ticket)) throwUatError_(401, "Activation expired. Verify your code again.");
  var parts = ticket.split(".");
  var expected = sessionB64_(Utilities.computeHmacSha256Signature(
    parts[0], uatActivationSecret_(false)));
  if (!uatConstantTimeEqual_(expected, parts[1])) throwUatError_(401, "Activation expired. Verify your code again.");
  var data;
  try {
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString("UTF-8"));
  } catch (err) { throwUatError_(401, "Activation expired. Verify your code again."); }
  var ts = Math.floor(Date.now() / 1000);
  if (data.v !== 1 || data.typ !== "uat_activate" || !data.sub ||
      typeof data.fp !== "string" || !Number.isInteger(data.exp) ||
      !Number.isInteger(data.iat) || data.iat > ts + 60 ||
      data.exp <= ts || data.exp - data.iat > 600) {
    throwUatError_(401, "Activation expired. Verify your code again.");
  }
  return data;
}
function verifyUatActivation_(store, body) {
  if (!uatActivationEnabled_()) throwUatError_(503, "Account activation is not enabled");
  var email = normalizeUatCorporateEmail_(body.email);
  var cache = CacheService.getScriptCache();
  var key = "GEO_UAT_ACTFAIL_" +
    sessionB64_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email)).slice(0, 24);
  if (Number(cache.get(key) || 0) >= 5) throwUatError_(429, "Too many attempts. Try again later.");
  try {
    var item = uatActivationFind_(store, email);
    var c = item.credential;
    if (String(c.credential_status || "") !== "pending_activation" ||
        !c.activation_code_hash || c.activation_used_at ||
        !(Date.parse(String(c.activation_expires_at || "")) > Date.now()) ||
        !uatConstantTimeEqual_(String(c.activation_code_hash), uatActivationDigest_(body.code))) {
      throwUatError_(401, "Invalid activation credentials");
    }
    uatActivationRate_(email, true);
    return { activation_ticket: uatActivationTicket_(String(item.user.user_id), String(c.activation_code_hash)),
      expires_in_seconds: 600 };
  } catch (err) {
    if (err.status === 401) uatActivationRate_(email, false);
    throw err;
  }
}
function uatCheckNewPassword_(value, email) {
  var password = String(value || "");
  if (password.length < 10 || password.length > 128 ||
      /[\x00-\x1f\x7f]/.test(password) ||
      (email && password.toLowerCase().includes(String(email).split("@")[0].toLowerCase())) ||
      /^(password|123456|qwerty|letmein)/i.test(password)) {
    throwUatError_(400, "Use a unique password of 10–128 characters without your email name");
  }
  return password;
}
function completeUatActivation_(store, body) {
  if (!uatActivationEnabled_()) throwUatError_(503, "Account activation is not enabled");
  var ticket = uatReadActivationTicket_(body.activation_ticket);
  var allUsers = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows;
  var matches = allUsers.filter(function (u) { return String(u.user_id || "") === ticket.sub; });
  if (matches.length !== 1 || String(matches[0].status || "").toLowerCase() !== "active" ||
      !normalizeEmployeeId_(matches[0].employee_id) ||
      !uatCorporateDomainAllowed_(normalizeUatCorporateEmail_(matches[0].email)) ||
      allUsers.filter(function (u) {
        return normalizeUatCorporateEmail_(u.email) === normalizeUatCorporateEmail_(matches[0].email);
      }).length !== 1)
    throwUatError_(401, "Activation expired. Verify your code again.");
  var creds = store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows
    .filter(function (c) { return String(c.user_id || "") === ticket.sub; });
  if (creds.length !== 1 ||
      normalizeEmployeeId_(creds[0]["employee_id / username"]) !== normalizeEmployeeId_(matches[0].employee_id))
    throwUatError_(401, "Activation expired. Verify your code again.");
  var c = creds[0];
  if (String(c.credential_status || "") !== "pending_activation" ||
      !c.activation_code_hash || c.activation_used_at ||
      !uatConstantTimeEqual_(String(c.activation_code_hash), ticket.fp) ||
      !(Date.parse(String(c.activation_expires_at || "")) > Date.now()))
    throwUatError_(401, "Activation expired. Verify your code again.");
  var password = uatCheckNewPassword_(body.new_password, normalizeUatCorporateEmail_(matches[0].email));
  if (password !== String(body.confirm_password || "")) throwUatError_(400, "Passwords do not match");
  geoAssertUatCredentialRowWritable_(store, c);
  // Pepper provisioning is an editor-only preflight, not a web-side key generator.
  var pepper = uatPasswordPepper_(false);
  if (!pepper) throwUatError_(503, "UAT password hashing not configured");
  var salt = Utilities.getUuid().replace(/-/g, "");
  var hash = GEO_UAT_PASSWORD_HASH_SCHEME_ + "$" + salt + "$" + uatPasswordDigest_(salt, password);
  var now = new Date().toISOString();
  c.password_hash = hash;
  c.password_hash_version = GEO_UAT_PASSWORD_HASH_SCHEME_;
  c.temporary_password = ""; // UAT transition: never retain an active plaintext fallback.
  c.password_set_at = now;
  c.password_changed_at = now;
  c.credential_status = "active";
  c.activation_used_at = now;
  c.activation_code_hash = "";
  c.activation_expires_at = "";
  store.touch("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials");
  store.geoCredentialUserToVerify = ticket.sub; // server-only; never sent to browser
  // No login token here; employee signs in separately with the new password.
  return { activated: true };
}
// Read-only UAT setup audit. Returns aggregate counts ONLY; no staff PII,
// credential values, email addresses, hashes, or keys are exposed.
function debugUatEmailActivationReadiness() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var store = new SheetStore_();
    var users = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows;
    var credentials = store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows;
    var seen = Object.create(null), counts = {
      active_users: 0, active_missing_email: 0, active_invalid_domain: 0,
      duplicate_corporate_emails: 0, active_missing_employee_id: 0,
      missing_or_ambiguous_credentials: 0, credential_employee_id_mismatch: 0,
      ready_for_activation: 0
    };
    users.forEach(function (user) {
      var email = normalizeUatCorporateEmail_(user.email);
      if (email) seen[email] = (seen[email] || 0) + 1;
    });
    Object.keys(seen).forEach(function (key) {
      if (seen[key] > 1) counts.duplicate_corporate_emails++;
    });
    users.forEach(function (user) {
      if (String(user.status || "").toLowerCase() !== "active") return;
      counts.active_users++;
      var email = normalizeUatCorporateEmail_(user.email);
      var employee = normalizeEmployeeId_(user.employee_id);
      if (!email) counts.active_missing_email++;
      else if (!uatCorporateDomainAllowed_(email)) counts.active_invalid_domain++;
      if (!employee) counts.active_missing_employee_id++;
      var found = credentials.filter(function (c) {
        return String(c.user_id || "").trim() === String(user.user_id || "").trim();
      });
      if (found.length !== 1) counts.missing_or_ambiguous_credentials++;
      else if (!employee || normalizeEmployeeId_(found[0]["employee_id / username"]) !== employee)
        counts.credential_employee_id_mismatch++;
      if (email && seen[email] === 1 && uatCorporateDomainAllowed_(email) &&
          employee && found.length === 1 &&
          normalizeEmployeeId_(found[0]["employee_id / username"]) === employee) {
        counts.ready_for_activation++;
      }
    });
    return counts;
  } finally { lock.releaseLock(); }
}

// ---- Credentials Sheet integrity guard ------------------------------------
// Google Sheets can have dropdown validations on the wrong columns after an
// import. The password hash, expiry dates and display name MUST NOT accept a
// Role dropdown; otherwise a valid password is rejected at Sheets.setValues.
// All checks below are internal; they never return passwords or hash values.
var GEO_CREDENTIAL_FILE_ = "B2B_GEO_UAT_Credentials_Distribution.xlsx";
var GEO_CREDENTIAL_TAB_ = "UAT_Credentials";
var GEO_CREDENTIAL_FREE_COLUMNS_ = [
  "temporary_password", "password_hash", "activation_code_hash",
  "activation_expires_at", "activation_used_at", "password_set_at",
  "password_changed_at", "password_hash_version", "display_name"
];
var GEO_ROLE_VALUES_ = ["AE", "SM", "Management", "Admin"];

function geoUatCredentialSheet_(store) {
  var id = sheetIdFor_(GEO_CREDENTIAL_FILE_);
  if (!id) throwUatError_(503, "Credential workbook binding is missing");
  var book = store ? store.book_(GEO_CREDENTIAL_FILE_) : SpreadsheetApp.openById(id);
  if (book.getName() !== "UAT_Credentials")
    throwUatError_(503, "Unexpected Credentials workbook; no password was changed");
  var ws = book.getSheetByName(GEO_CREDENTIAL_TAB_);
  if (!ws || ws.getLastRow() < 1) throwUatError_(503, "Credential tab is missing");
  var headers = ws.getRange(1, 1, 1, ws.getLastColumn())
    .getDisplayValues()[0].map(function (v) { return String(v).trim(); });
  var required = ["user_id", "employee_id / username", "credential_status", "role"]
    .concat(GEO_CREDENTIAL_FREE_COLUMNS_);
  if (required.some(function (h) { return headers.indexOf(h) < 0; }) ||
      (new Set(headers)).size !== headers.length) {
    throwUatError_(503, "Credentials Sheet headers do not match the authentication contract");
  }
  return { ws: ws, headers: headers };
}

function geoIsRoleOnlyValidation_(rule) {
  if (!rule || rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST)
    return false;
  var values = rule.getCriteriaValues()[0];
  return Array.isArray(values) && values.length === GEO_ROLE_VALUES_.length &&
    GEO_ROLE_VALUES_.every(function (value) { return values.indexOf(value) >= 0; });
}

// This lightweight check runs ONLY while submitting a new password. It blocks
// an unwritable physical row BEFORE changing an in-memory credential record.
function geoAssertUatCredentialRowWritable_(store, credential) {
  var info = geoUatCredentialSheet_(store);
  var rows = store.table(GEO_CREDENTIAL_FILE_, GEO_CREDENTIAL_TAB_).rows;
  var index = rows.indexOf(credential);
  if (index < 0) throwUatError_(503, "Credential row could not be located");
  var rowNumber = index + 2;
  for (var i = 0; i < GEO_CREDENTIAL_FREE_COLUMNS_.length; i++) {
    var col = info.headers.indexOf(GEO_CREDENTIAL_FREE_COLUMNS_[i]) + 1;
    if (info.ws.getRange(rowNumber, col).getDataValidation()) {
      throwUatError_(503, "Credentials Sheet has incompatible field validation. Ask the system administrator to review the credential schema.");
    }
  }
}

// Confirmation is read from the *physical* Sheet after store.flush() returns;
// an in-memory object is never proof that a password was committed. Compare
// exact values without logging/returning any hash, identity or ticket.
function geoVerifyUatCredentialPersisted_(store) {
  var uid = String(store.geoCredentialUserToVerify || "");
  if (!uid) throwUatError_(503, "Password write verification was not initialized");
  var info = geoUatCredentialSheet_(store);
  var rows = store.table(GEO_CREDENTIAL_FILE_, GEO_CREDENTIAL_TAB_).rows;
  var matches = [];
  rows.forEach(function (row, index) {
    if (String(row.user_id || "").trim() === uid) matches.push({ index: index, row: row });
  });
  if (matches.length !== 1) throwUatError_(503, "Credential persistence identity is ambiguous");
  var target = matches[0], fields = [
    "password_hash", "password_hash_version", "credential_status",
    "password_set_at", "password_changed_at", "temporary_password"
  ];
  var written = info.ws.getRange(target.index + 2, 1, 1, info.headers.length)
    .getDisplayValues()[0];
  var consistent = fields.every(function (field) {
    var col = info.headers.indexOf(field);
    return String(written[col] == null ? "" : written[col]) ===
      String(target.row[field] == null ? "" : target.row[field]);
  });
  if (!consistent || !target.row.password_hash ||
      String(target.row.credential_status) !== "active") {
    throwUatError_(503, "Credential save could not be verified. Contact your system administrator with the backend error reference.");
  }
}

// Editor-only READ-ONLY schema audit. Read validation rules, never secrets.
function debugUatCredentialValidationReadiness() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var info = geoUatCredentialSheet_();
    var result = { rows: Math.max(0, info.ws.getLastRow() - 1),
      role_dropdowns_on_password_fields: 0, other_rules_on_password_fields: 0,
      writable: true };
    var count = info.ws.getMaxRows() - 1;
    if (count <= 0) return result;
    GEO_CREDENTIAL_FREE_COLUMNS_.forEach(function (field) {
      var col = info.headers.indexOf(field) + 1;
      info.ws.getRange(2, col, count, 1).getDataValidations().forEach(function (line) {
        var rule = line[0];
        if (!rule) return;
        if (geoIsRoleOnlyValidation_(rule)) result.role_dropdowns_on_password_fields++;
        else result.other_rules_on_password_fields++;
      });
    });
    result.writable = result.role_dropdowns_on_password_fields === 0 &&
      result.other_rules_on_password_fields === 0;
    console.log(JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}

// Opt-in, editor-only correction. No cell values, user roles, passwords,
// salts, pepper or sessions are touched. Preserve legitimate status/role
// validations (columns E and M in the current credentials workbook).
function repairUatCredentialValidationApproved() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("GEO_ENVIRONMENT") !== "UAT" ||
      props.getProperty("GEO_UAT_CREDENTIAL_VALIDATION_FIX_APPROVED") !== "YES")
    throw Error("Credential validation repair requires explicit UAT approval");
  var approvedId = props.getProperty("GEO_APPROVED_CREDENTIALS_SHEET_ID");
  if (!approvedId || approvedId !== sheetIdFor_(GEO_CREDENTIAL_FILE_))
    throw Error("Credential workbook differs from the administrator-approved binding");
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var info = geoUatCredentialSheet_();
    var count = info.ws.getMaxRows() - 1, clearedColumns = 0;
    if (count > 0) {
      // Abort BEFORE any mutation when an unexpected validation exists.
      GEO_CREDENTIAL_FREE_COLUMNS_.forEach(function (field) {
        var col = info.headers.indexOf(field) + 1;
        info.ws.getRange(2, col, count, 1).getDataValidations().forEach(function (line) {
          if (line[0] && !geoIsRoleOnlyValidation_(line[0]))
            throw Error("Unexpected validation in credential field; manual review required");
        });
      });
      GEO_CREDENTIAL_FREE_COLUMNS_.forEach(function (field) {
        var col = info.headers.indexOf(field) + 1;
        info.ws.getRange(2, col, count, 1).clearDataValidations();
        clearedColumns++;
      });
      SpreadsheetApp.flush();
      // Re-read after mutation: never report success on a partial schema fix.
      GEO_CREDENTIAL_FREE_COLUMNS_.forEach(function (field) {
        var col = info.headers.indexOf(field) + 1;
        if (info.ws.getRange(2, col, count, 1).getDataValidations()
          .some(function (line) { return !!line[0]; }))
          throw Error("Credential validation repair not verified");
      });
    }
    props.deleteProperty("GEO_UAT_CREDENTIAL_VALIDATION_FIX_APPROVED");
    return { ok: true, cleared_columns: clearedColumns, values_changed: 0 };
  } finally { lock.releaseLock(); }
}

// Editor-only, READ-ONLY diagnostic for the UAT first-login password flow.
// Run from Apps Script editor; no staff data, secrets, workbook IDs or passwords
// are returned or logged. Never expose this function as an HTTP endpoint.
function debugUatPasswordSetupReadiness() {
  var p = PropertiesService.getScriptProperties();
  var report = {
    environment_is_uat: p.getProperty("GEO_ENVIRONMENT") === "UAT",
    temporary_password_setup_enabled: p.getProperty("GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED") === "true",
    activation_signing_secret_present: !!p.getProperty("GEO_UAT_ACTIVATION_SECRET"),
    password_pepper_present: !!p.getProperty(GEO_UAT_PASSWORD_PEPPER_PROPERTY_),
    user_master_binding_present: !!sheetIdFor_("B2B_GEO_User_Org_Master.xlsx"),
    credentials_binding_present: !!sheetIdFor_("B2B_GEO_UAT_Credentials_Distribution.xlsx"),
    sheet_read_ok: false,
    user_count: 0,
    credentials_count: 0,
    active_users_missing_employee_id: 0,
    pending_setup_accounts: 0,
    already_personal_password_accounts: 0
  };
  // The editor function verifies real, current workbook access and headers
  // without writing cells or disclosing employee identifiers.
  try {
    var store = new SheetStore_();
    var us = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows;
    var cs = store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows;
    report.sheet_read_ok = true;
    report.user_count = us.length;
    report.credentials_count = cs.length;
    us.forEach(function (u) {
      if (String(u.status || "").toLowerCase() !== "active") return;
      var eid = normalizeEmployeeId_(u.employee_id);
      if (!eid) { report.active_users_missing_employee_id++; return; }
      var matches = cs.filter(function (c) {
        return String(c.user_id || "").trim() === String(u.user_id || "").trim() &&
          normalizeEmployeeId_(c["employee_id / username"]) === eid;
      });
      if (matches.length !== 1) return;
      if (uatTemporaryCredentialPending_(matches[0])) report.pending_setup_accounts++;
      if (String(matches[0].credential_status || "") === "active" &&
          String(matches[0].password_set_at || "").trim() &&
          String(matches[0].password_hash || "").trim()) report.already_personal_password_accounts++;
    });
  } catch (err) {
    // No exception messages here: they can contain private spreadsheet names/IDs.
    report.sheet_read_ok = false;
  }
  report.ready_for_existing_temporary_passwords =
    report.environment_is_uat &&
    report.temporary_password_setup_enabled &&
    report.activation_signing_secret_present &&
    report.password_pepper_present &&
    report.user_master_binding_present &&
    report.credentials_binding_present &&
    report.sheet_read_ok;
  console.log(JSON.stringify(report));
  return report;
}

// Editor-only: safely initialize secrets after checking for existing hashes.
// Do not log or return the secret/pepper values.
function prepareUatEmailActivation() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty("GEO_ENVIRONMENT") !== "UAT")
      throw Error("Must set GEO_ENVIRONMENT=UAT");
    var store = new SheetStore_();
    var creds = store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows;
    var hashCount = creds.filter(function (c) { return !!c.password_hash; }).length;
    if (!props.getProperty(GEO_UAT_PASSWORD_PEPPER_PROPERTY_) && hashCount)
      throw Error("Missing password pepper with existing hashes: restore the original secret; DO NOT generate a new pepper.");
    if (!props.getProperty(GEO_UAT_PASSWORD_PEPPER_PROPERTY_)) uatPasswordPepper_(true);
    uatActivationSecret_(true);
    return { ok: true, hashedAccounts: hashCount, activationEnabled:
      props.getProperty("GEO_UAT_EMAIL_ACTIVATION_ENABLED") === "true",
      emailLoginEnabled: props.getProperty("GEO_UAT_EMAIL_LOGIN_ENABLED") === "true" };
  } finally { lock.releaseLock(); }
}
// Editor-only: custodian must verify mailbox ownership and securely deliver code.
// Requires explicit one-time approval property; returns code ONCE, never logs it.
function issueUatActivationCode(email) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var p = PropertiesService.getScriptProperties();
    if (p.getProperty("GEO_ENVIRONMENT") !== "UAT" ||
        p.getProperty("GEO_UAT_ACTIVATION_ISSUANCE_APPROVED") !== "YES")
      throw Error("UAT activation issuance requires approved custodian process");
    var store = new SheetStore_(), item = uatActivationFind_(store, email);
    var c = item.credential;
    if (String(c.credential_status || "") === "active" && c.password_set_at)
      throw Error("Account already activated: do not issue an activation code");
    if (String(c.credential_status || "") === "disabled")
      throw Error("Disabled account cannot be activated");
    if (!p.getProperty("GEO_UAT_ACTIVATION_SECRET") ||
        !p.getProperty(GEO_UAT_PASSWORD_PEPPER_PROPERTY_))
      throw Error("Run prepareUatEmailActivation() first");
    var code = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
    var expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    c.credential_status = "pending_activation";
    c.activation_code_hash = uatActivationDigest_(code);
    c.activation_expires_at = expiry;
    c.activation_used_at = "";
    store.touch("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials");
    store.flush();
    p.deleteProperty("GEO_UAT_ACTIVATION_ISSUANCE_APPROVED");
    return { activation_code: code, expires_at: expiry };
  } finally { lock.releaseLock(); }
}

// Editor-only wrapper: UAT coordinator specifies a verified mailbox as the
// GEO_UAT_ACTIVATION_TARGET_EMAIL Script Property, then runs this function.
// Code is returned only to the authorized caller. No password or token logging.
function issueUatActivationForApprovedTarget() {
  var p = PropertiesService.getScriptProperties();
  var email = normalizeUatCorporateEmail_(p.getProperty("GEO_UAT_ACTIVATION_TARGET_EMAIL"));
  if (!email) throw Error("Missing approved activation target email");
  try {
    return issueUatActivationCode(email);
  } finally {
    p.deleteProperty("GEO_UAT_ACTIVATION_TARGET_EMAIL");
  }
}

// UAT ONLY — provision one approved active User Master employee.
// An existing credential row is eligible ONLY when both password fields and
// all activation state are empty; it never resets an issued password, role, or region.
// Generated password format: XXXX-XXXX-XXXX (uppercase A-Z and digits 2-9).
// The authorized editor receives the password ONCE to deliver privately.
// Prerequisites: Script Properties GEO_ENVIRONMENT=UAT,
// GEO_UAT_NEW_CREDENTIAL_APPROVED=YES, GEO_UAT_NEW_EMPLOYEE_ID=<approved ID>.
// Do not run for an account that already has a temporary password, hash,
// nonblank credential status, or activation in progress.
function provisionOneNewUatEmployeePassword() {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty("GEO_ENVIRONMENT") !== "UAT" ||
      p.getProperty("GEO_UAT_NEW_CREDENTIAL_APPROVED") !== "YES")
    throw Error("New UAT credential provisioning is not approved");
  var employeeId = normalizeEmployeeId_(p.getProperty("GEO_UAT_NEW_EMPLOYEE_ID"));
  if (!employeeId) throw Error("Set a valid GEO_UAT_NEW_EMPLOYEE_ID");
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var store = new SheetStore_();
    var users = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows.filter(function (u) {
      return normalizeEmployeeId_(u.employee_id) === employeeId &&
        String(u.status || "Active").toLowerCase() === "active";
    });
    if (users.length !== 1 || !String(users[0].user_id || "").trim())
      throw Error("Employee ID must map to exactly one active approved User Master record");
    var creds = store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows;
    var uid = String(users[0].user_id).trim();
    var found = creds.filter(function (c) {
      return normalizeEmployeeId_(c["employee_id / username"]) === employeeId ||
        String(c.user_id || "").trim() === uid;
    });
    if (found.length > 1) throw Error("Ambiguous credential identity; no password changed");
    var existing = found.length === 1 ? found[0] : null;
    if (existing && (
      String(existing.user_id || "").trim() !== uid ||
      normalizeEmployeeId_(existing["employee_id / username"]) !== employeeId ||
      String(existing.temporary_password || "").trim() ||
      String(existing.password_hash || "").trim() ||
      String(existing.credential_status || "").trim() ||
      String(existing.activation_code_hash || "").trim() ||
      String(existing.activation_expires_at || "").trim() ||
      String(existing.activation_used_at || "").trim() ||
      String(existing.password_set_at || "").trim()
    )) throw Error("Credential is not an untouched blank UAT account; no password changed");
    var pepper = uatPasswordPepper_(false);
    if (!pepper) throw Error("UAT password pepper is missing; initialize via approved readiness procedure");
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var raw = (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
    var groups = [], group = "";
    for (var i = 0; i < 12; i++) {
      group += alphabet.charAt(parseInt(raw.charAt(i * 2), 16) * 2 + parseInt(raw.charAt(i * 2 + 1), 16) % 2);
      if (group.length === 4) { groups.push(group); group = ""; }
    }
    var password = groups.join("-");
    var salt = Utilities.getUuid().replace(/-/g, "");
    var hash = GEO_UAT_PASSWORD_HASH_SCHEME_ + "$" + salt + "$" + uatPasswordDigest_(salt, password);
    if (existing) {
      // Preserve the existing row, identifiers and every unrelated field.
      existing.password_hash = hash;
      existing.password_hash_version = GEO_UAT_PASSWORD_HASH_SCHEME_;
    } else {
      creds.push({
        user_id: uid,
        "employee_id / username": employeeId,
        temporary_password: "",
        password_hash: hash,
        credential_status: "",
        activation_code_hash: "",
        activation_expires_at: "",
        activation_used_at: "",
        password_set_at: "",
        password_changed_at: "",
        password_hash_version: GEO_UAT_PASSWORD_HASH_SCHEME_
      });
    }
    store.touch("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials");
    store.flush();
    p.deleteProperty("GEO_UAT_NEW_CREDENTIAL_APPROVED");
    p.deleteProperty("GEO_UAT_NEW_EMPLOYEE_ID");
    return { created: !existing, filled_blank: !!existing, one_time_password: password };
  } finally { lock.releaseLock(); }
}

// MANUAL, READ-ONLY health check in Apps Script editor. Never returns or logs
// names, employee IDs, temporary passwords, password hashes, or sheet contents.
function debugUatLoginReadiness() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var store = new SheetStore_();
    var users = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows;
    var credentials = store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows;
    var credentialIndex = Object.create(null);
    var userEmployeeCounts = Object.create(null);
    var duplicates = 0;
    credentials.forEach(function (row) {
      var id = normalizeEmployeeId_(row["employee_id / username"]);
      if (!id) return;
      if (Object.prototype.hasOwnProperty.call(credentialIndex, id)) duplicates++;
      credentialIndex[id] = row;
    });
    users.forEach(function (user) {
      var id = normalizeEmployeeId_(user.employee_id);
      if (id) userEmployeeCounts[id] = (userEmployeeCounts[id] || 0) + 1;
    });
    var result = {
      active_users: 0,
      credential_ready: 0,
      missing_employee_id: 0,
      missing_credential_record: 0,
      missing_password: 0,
      duplicate_credential_ids: duplicates,
      duplicate_user_employee_ids: Object.keys(userEmployeeCounts).filter(function (id) {
        return userEmployeeCounts[id] > 1;
      }).length,
      credential_user_id_mismatch: 0,
      by_role: {}
    };
    users.forEach(function (user) {
      if (String(user.status || "Active").toLowerCase() !== "active") return;
      var role = String(user.role || "Unknown");
      var item = result.by_role[role] || (result.by_role[role] = {
        active: 0, ready: 0, blocked: 0
      });
      result.active_users++;
      item.active++;
      var id = normalizeEmployeeId_(user.employee_id);
      if (!id) {
        result.missing_employee_id++;
        item.blocked++;
        return;
      }
      var credential = credentialIndex[id];
      if (!credential) {
        result.missing_credential_record++;
        item.blocked++;
        return;
      }
      if (userEmployeeCounts[id] !== 1 ||
          (String(credential.user_id || "").trim() &&
           String(credential.user_id).trim() !== String(user.user_id || "").trim())) {
        result.credential_user_id_mismatch++;
        item.blocked++;
        return;
      }
      if (!String(credential.password_hash || "") &&
          !String(credential.temporary_password || "")) {
        result.missing_password++;
        item.blocked++;
        return;
      }
      result.credential_ready++;
      item.ready++;
    });
    result.temporary_password_window_open = geoUatTemporaryPasswordWindowOpen_();
    result.hashed_passwords_required =
      PropertiesService.getScriptProperties().getProperty("GEO_UAT_REQUIRE_HASHED_PASSWORDS") === "true";
    console.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

// MANUAL UAT-ONLY recovery. Set GEO_ENVIRONMENT=UAT and
// GEO_UAT_TEMP_LOGIN_APPROVED=YES in Script Properties first; never expose as
// an HTTP route. Automatically expires after 14 days. No passwords are changed.
function enableUatTemporaryLoginFor14Days() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("GEO_ENVIRONMENT") !== "UAT" ||
      props.getProperty("GEO_UAT_TEMP_LOGIN_APPROVED") !== "YES") {
    throw Error("UAT recovery not approved. Set GEO_ENVIRONMENT=UAT and GEO_UAT_TEMP_LOGIN_APPROVED=YES.");
  }
  if (props.getProperty("GEO_UAT_REQUIRE_HASHED_PASSWORDS") === "true") {
    throw Error("Hashed-password-only mode is active; do not downgrade a migrated credential store.");
  }
  var readiness = debugUatLoginReadiness();
  if (readiness.credential_ready === 0 || readiness.duplicate_credential_ids) {
    throw Error("Credential readiness failed; review private workbook. No settings changed.");
  }
  var expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  props.setProperty("GEO_UAT_TEMP_PASSWORD_EXPIRES_AT", expiresAt);
  props.setProperty("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS", "true");
  props.deleteProperty("GEO_UAT_TEMP_LOGIN_APPROVED");
  return {
    enabled: true,
    expires_at: expiresAt,
    credential_ready: readiness.credential_ready,
    active_users: readiness.active_users,
    missing_employee_id: readiness.missing_employee_id,
    missing_credential_record: readiness.missing_credential_record,
    missing_password: readiness.missing_password
  };
}

// MANUAL revocation. Sets all UAT plaintext password checks to fail closed.
function disableUatTemporaryLogin() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty("GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS");
  props.deleteProperty("GEO_UAT_TEMP_PASSWORD_EXPIRES_AT");
  props.deleteProperty("GEO_UAT_TEMP_LOGIN_APPROVED");
  return { enabled: false };
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

// Editor-only, read-only UAT integrity preflight. All tables are read under
// one ScriptLock; no customer names, employee IDs, spreadsheet IDs or passwords
// are written to logs. Do not expose this through doGet/doPost.
function debugGeoPipelineDataIntegrity() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var store = new SheetStore_();
    var pipelines = store.table("B2B_GEO_Pipeline_DB.xlsx", "Pipelines").rows;
    var events = store.table("B2B_GEO_Pipeline_DB.xlsx", "Pipeline_Events").rows;
    var snapshots = store.table("B2B_GEO_Pipeline_DB.xlsx", "Snapshots").rows;
    var users = store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows;
    var stages = store.table("B2B_GEO_Pipeline_Config.xlsx", "Stages").rows;
    var categories = store.table("B2B_GEO_Pipeline_Config.xlsx", "Product_Categories").rows;
    var regions = store.table("B2B_GEO_User_Org_Master.xlsx", "Regions").rows;
    var idSet = function (records, field) {
      var set = new Set();
      records.forEach(function (r) { if (String(r[field] || "").trim()) set.add(String(r[field]).trim()); });
      return set;
    };
    var opportunityIds = idSet(pipelines, "opportunity_id");
    var knownOwners = idSet(users, "user_id");
    var knownStages = idSet(stages, "stage_id");
    var knownCategories = idSet(categories, "category_id");
    var knownRegions = idSet(regions, "region_id");
    var counts = {
      pipelines: pipelines.length, events: events.length, snapshots: snapshots.length,
      missing_updated_at: 0, missing_stage_entered_at: 0,
      missing_expected_close_month: 0, missing_region: 0, missing_stage: 0,
      invalid_owner: 0, invalid_handler: 0, invalid_stage: 0,
      invalid_region: 0, invalid_product_category: 0,
      orphan_events: 0, no_create_event: 0, duplicate_create_events: 0,
      snapshot_duplicate_period_pipeline: 0, snapshot_orphans: 0
    };
    var createCounts = Object.create(null);
    events.forEach(function (e) {
      var oid = String(e.opportunity_id || "").trim();
      if (!opportunityIds.has(oid)) counts.orphan_events++;
      if (String(e.event_type || "").toLowerCase() === "create") createCounts[oid] = (createCounts[oid] || 0) + 1;
    });
    pipelines.forEach(function (p) {
      if (!String(p.updated_at || "").trim()) counts.missing_updated_at++;
      if (!String(p.stage_entered_at || "").trim()) counts.missing_stage_entered_at++;
      if (!String(p.expected_close_month || "").trim()) counts.missing_expected_close_month++;
      if (!String(p.region_id || "").trim()) counts.missing_region++;
      if (!String(p.stage_id || "").trim()) counts.missing_stage++;
      if (p.owner_user_id && !knownOwners.has(String(p.owner_user_id))) counts.invalid_owner++;
      if (p.current_handler_user_id && !knownOwners.has(String(p.current_handler_user_id))) counts.invalid_handler++;
      if (p.stage_id && !knownStages.has(String(p.stage_id))) counts.invalid_stage++;
      if (p.region_id && !knownRegions.has(String(p.region_id))) counts.invalid_region++;
      if (p.product_category_id && !knownCategories.has(String(p.product_category_id))) counts.invalid_product_category++;
      var n = createCounts[String(p.opportunity_id)] || 0;
      if (!n) counts.no_create_event++;
      if (n > 1) counts.duplicate_create_events++;
    });
    var seenSnapshots = new Set();
    snapshots.forEach(function (r) {
      var key = String(r.snapshot_period || "") + "|" + String(r.opportunity_id || "");
      if (seenSnapshots.has(key)) counts.snapshot_duplicate_period_pipeline++;
      seenSnapshots.add(key);
      // A historical snapshot may refer to a Pipeline later archived or
      // removed. Report this count without silently deleting the history.
      if (!opportunityIds.has(String(r.opportunity_id || ""))) counts.snapshot_orphans++;
    });
    console.log(JSON.stringify(counts));
    return counts;
  } finally {
    lock.releaseLock();
  }
}

// An approved, narrow UAT correction for imported Pipelines whose updated_at
// was omitted by the legacy Sheet import. The ONE authoritative create event
// supplies the import transaction timestamp. Customer created_at and unknown
// stage/handler clocks are NEVER replaced or inferred.
function geoRevisionRepairPlan_(pipelines, events) {
  var byPipeline = Object.create(null);
  events.forEach(function (e) {
    var id = String(e.opportunity_id || "");
    (byPipeline[id] || (byPipeline[id] = [])).push(e);
  });
  var eligible = [];
  var skipped = 0;
  pipelines.forEach(function (p) {
    if (String(p.updated_at || "").trim()) return;
    var id = String(p.opportunity_id || "").trim();
    var history = byPipeline[id] || [];
    var created = history.length === 1 && String(history[0].event_type || "").toLowerCase() === "create";
    var stamp = created ? String(history[0].event_at || "").trim() : "";
    if (!id || !String(p.import_batch_id || "").trim() || !created ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(stamp) ||
        !Number.isFinite(Date.parse(stamp))) {
      skipped++;
      return;
    }
    eligible.push({ row: p, at: stamp });
  });
  return { eligible: eligible, skipped: skipped };
}
// Editor-only preview. No mutation, private identities, workbook IDs or values.
function debugGeoImportedRevisionRepair() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var store = new SheetStore_();
    var ps = store.table("B2B_GEO_Pipeline_DB.xlsx", "Pipelines").rows;
    var es = store.table("B2B_GEO_Pipeline_DB.xlsx", "Pipeline_Events").rows;
    var plan = geoRevisionRepairPlan_(ps, es);
    var summary = { total_pipelines: ps.length, missing_revisions: plan.eligible.length + plan.skipped,
      eligible: plan.eligible.length, unsafe_skipped: plan.skipped };
    console.log(JSON.stringify(summary));
    return summary;
  } finally { lock.releaseLock(); }
}
// Editor-only opt-in. Require exact approved candidate count, so a concurrent
// import cannot silently expand the repair. Never expose a public HTTP route.
function repairGeoImportedRevisionsApproved() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty("GEO_ENVIRONMENT") !== "UAT" ||
        props.getProperty("GEO_UAT_REVISION_REPAIR_APPROVED") !== "YES") {
      throw Error("UAT data revision repair requires explicit editor approval");
    }
    var expectedText = String(props.getProperty("GEO_UAT_REVISION_REPAIR_EXPECTED_COUNT") || "");
    if (!/^[1-9]\d*$/.test(expectedText)) throw Error("Expected count must be a positive integer");
    var store = new SheetStore_();
    var ps = store.table("B2B_GEO_Pipeline_DB.xlsx", "Pipelines").rows;
    var es = store.table("B2B_GEO_Pipeline_DB.xlsx", "Pipeline_Events").rows;
    var plan = geoRevisionRepairPlan_(ps, es);
    if (plan.skipped || plan.eligible.length !== Number(expectedText))
      throw Error("Live import changed or unsafe missing revisions found; no rows were modified");
    var audit = store.table("B2B_GEO_Pipeline_DB.xlsx", "Admin_Audit");
    var nowAt = new Date().toISOString();
    plan.eligible.forEach(function (item) {
      item.row.updated_at = item.at;
      audit.rows.push({
        audit_id: "AUD-" + Utilities.getUuid(),
        event_type: "IMPORT_REVISION_REPAIRED",
        source_file: "B2B_GEO_Pipeline_DB.xlsx", source_sheet: "Pipelines",
        source_record_id: String(item.row.opportunity_id),
        field_name: "updated_at", previous_value: "", new_value: item.at,
        actor_user_id: "SYSTEM_APPROVED_UAT_REPAIR", actor_name: "Editor-approved UAT data repair",
        actor_role: "system", event_at: nowAt
      });
    });
    store.touch("B2B_GEO_Pipeline_DB.xlsx", "Pipelines");
    store.touch("B2B_GEO_Pipeline_DB.xlsx", "Admin_Audit");
    store.flush();
    props.deleteProperty("GEO_UAT_REVISION_REPAIR_APPROVED");
    props.deleteProperty("GEO_UAT_REVISION_REPAIR_EXPECTED_COUNT");
    return { repaired: plan.eligible.length, audit_entries: plan.eligible.length };
  } finally { lock.releaseLock(); }
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

// All configured runtime sheets must exist and retain their identity columns.
 // A missing workbook tab must never look like an empty Pipeline (zero records).
var GEO_REQUIRED_RUNTIME_HEADERS_ = {
  Pipelines: ["opportunity_id","business_id","customer_name","region_id","owner_user_id","current_handler_user_id","stage_id","status","expected_close_month","updated_at"],
  Pipeline_Events: ["event_id","opportunity_id","event_type","actor_user_id","event_at"],
  Pipeline_Tasks: ["task_instance_id","opportunity_id","task_id","scenario_id","stage_id","stage_entered_at","status","updated_at"],
  Scenario_Tasks: ["task_id","scenario_id","stage_id","task_name","sort_order","sla_days","day_type","start_policy","active"],
  Aging_Settings: ["setting_id","stage_watch_days"],
  Stages: ["stage_id","sla_days"],
  Support_Requests: ["request_id","opportunity_id","region_id","status","assigned_to_user_id","updated_at"],
  Handoff_Notifications: ["notification_id","recipient_user_id","opportunity_id","read_at"],
  Users: ["user_id","employee_id","role","status"],
  User_Region: ["user_region_id","user_id","region_id"],
  UAT_Credentials: ["employee_id / username", "user_id", "password_hash", "credential_status",
    "activation_code_hash", "activation_expires_at", "activation_used_at", "password_set_at",
    "password_changed_at", "password_hash_version"],
  Lost_Reasons: ["reason_id"]
};
function geoSchemaError_(code, detail) {
  var err = new Error(code + ": " + detail);
  err.status = 503;
  err.publicCode = code;
  return err;
}
function geoAssertSheetSchema_(file, sheet, headers) {
  if (!headers.length || headers.some(function (h) { return !h; }) ||
      new Set(headers).size !== headers.length) {
    throw geoSchemaError_("SCHEMA_MISMATCH", file + " / " + sheet + " has blank or duplicate header names");
  }
  var rule = GEO_CONTRACT.access.files[file] && GEO_CONTRACT.access.files[file].sheets &&
    GEO_CONTRACT.access.files[file].sheets[sheet];
  var required = (GEO_REQUIRED_RUNTIME_HEADERS_[sheet] || []).slice();
  if (rule && rule.primary_key && required.indexOf(rule.primary_key) < 0) required.push(rule.primary_key);
  var missing = required.filter(function (h) { return headers.indexOf(h) < 0; });
  if (missing.length) {
    throw geoSchemaError_("SCHEMA_MISMATCH", file + " / " + sheet + " missing columns: " + missing.join(", "));
  }
}
SheetStore_.prototype.table = function (file, sheet) {
  var key = file + "|" + sheet;
  if (this.tables[key]) return this.tables[key];
  var ws = this.book_(file).getSheetByName(sheet);
  if (!ws) throw geoSchemaError_("REQUIRED_SHEET_MISSING", file + " / " + sheet);
  if (ws.getLastRow() < 1 || ws.getLastColumn() < 1) {
    throw geoSchemaError_("SCHEMA_MISMATCH", file + " / " + sheet + " has no header row");
  }
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
      if (has) {
        // Never compact physical row positions. writeDirty_ updates row i+2,
        // so an interior blank row would otherwise overwrite another record.
        if (rows.length !== i - 1) {
          throw geoSchemaError_("SCHEMA_MISMATCH",
            file + " / " + sheet + " has an interior blank row at " + (rows.length + 2) +
            "; remove the gap before writing");
        }
        rows.push(rec);
      }
    }
  }
  geoAssertSheetSchema_(file, sheet, headers);
  // Reject duplicate primary keys before any update could target the wrong row.
  var schemaRule = GEO_CONTRACT.access.files[file] && GEO_CONTRACT.access.files[file].sheets &&
    GEO_CONTRACT.access.files[file].sheets[sheet];
  if (schemaRule && schemaRule.primary_key) {
    var seenPrimaryKeys = {};
    rows.forEach(function (row, index) {
      var id = String(row[schemaRule.primary_key] == null ? "" : row[schemaRule.primary_key]).trim();
      if (!id) throw geoSchemaError_("SCHEMA_MISMATCH",
        file + " / " + sheet + " missing " + schemaRule.primary_key + " in row " + (index + 2));
      if (Object.prototype.hasOwnProperty.call(seenPrimaryKeys, id))
        throw geoSchemaError_("SCHEMA_MISMATCH",
          file + " / " + sheet + " duplicate " + schemaRule.primary_key + " at rows " +
          seenPrimaryKeys[id] + " and " + (index + 2));
      seenPrimaryKeys[id] = index + 2;
    });
  }
  this.tables[key] = { headers: headers, rows: rows };
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
      try {
        copy.setName(name);
        copy.hideSheet();
      } catch (copyError) {
        // copyTo already created a new sheet. Clean it up even if naming or
        // hiding failed, before a transaction marker or live write exists.
        // Otherwise an orphan copy can retain sensitive Pipeline data.
        try { book.deleteSheet(copy); }
        catch (cleanupError) {
          console.error("Unfinished DB backup copy requires manual cleanup: " + cleanupError.message);
        }
        throw copyError;
      }
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
  owner_sales_code: true, owner_sale_name: true,
  partner_name: true, product_details: true, customer_location_text: true,
  import_source_system: true, import_source_record_id: true, import_source_product_id: true,
  import_source_rc: true, import_source_discount_pct: true, import_source_monthly_sale_plan: true,
  import_source_net_rc: true, import_source_customer_type: true,
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
    // Approved binding is stored privately in Script Properties; never in public source.
    var expectedId=String(props.getProperty("GEO_APPROVED_PIPELINE_DB_ID") || "");
    if(!expectedId)throw Error("Set private GEO_APPROVED_PIPELINE_DB_ID after workbook identity verification");
    var actualId=sheetIdFor_("B2B_GEO_Pipeline_DB.xlsx");
    if(actualId !== expectedId)throw Error("Pipeline DB binding differs from verified UAT workbook");
    var book=SpreadsheetApp.openById(actualId);
    if(book.getName()!=="B2B_GEO_Pipeline_DB")throw Error("Unexpected DB workbook name");
    // Existing 112 Pipelines require five NEW column headers for idempotent
    // imports and multiple collaborators. Append headers only; never rewrite
    // or reorder a customer row. An interrupted migration is resumable.
    var pipeline=book.getSheetByName("Pipelines");
    if(!pipeline || pipeline.getLastRow()<2)throw Error("Pipeline DB missing populated Pipelines sheet");
    var existing=pipeline.getRange(1,1,1,pipeline.getLastColumn()).getDisplayValues()[0].map(String);
    var required=["opportunity_id","business_id","region_id","owner_user_id","current_handler_user_id"];
    if(required.some(function(v){return existing.indexOf(v)<0}))
      throw Error("Canonical Pipelines headers are invalid; no extensions added");
    var trimmed=existing.map(function(v){return String(v).trim();});
    if(trimmed.some(function(v){return !v}) || (new Set(trimmed)).size!==trimmed.length)
      throw Error("Pipeline headers have blanks/duplicates; manual review required");
    var extensions=[
      "import_batch_id","import_row_number","import_row_signature",
      "working_with_team_ids","working_with_user_ids"
    ];
    var appended=[];
    extensions.forEach(function(name){
      if(existing.indexOf(name)>=0)return;
      var col=pipeline.getLastColumn()+1;
      if(col>pipeline.getMaxColumns())pipeline.insertColumnAfter(pipeline.getMaxColumns());
      pipeline.getRange(1,col).setNumberFormat("@").setValue(name);
      existing.push(name);
      appended.push(name);
    });
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
    console.log(JSON.stringify({ok:true,verifiedPipelineRows:book.getSheetByName("Pipelines").getLastRow()-1,
      appendedPipelineHeaders:appended,tables:result}));
    return {ok:true,appendedPipelineHeaders:appended,tables:result};
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
    var core=GeoCoreLib.createCore({contract:GEO_CONTRACT,store:store,
      now:function(){return new Date().toISOString();},
      uuid:function(){return Utilities.getUuid();}
    });
    var result=core.captureScheduledSnapshot(period);
    store.flush();
    console.log(JSON.stringify({ok:true,period:period,captured:result.captured,actor:"SYSTEM_MONTH_END"}));
    return {ok:true,period:period,captured:result.captured};
  } finally {lock.releaseLock();}
}


// The Ticket-based Support Requests workflow has been retired. Historical
// Support_Requests rows stay in the restricted workbook for audit/recovery.
// Never create new tickets from existing support_needed flags.
function backfillGeoPhase4SupportFlags() {
  throw Error("Retired: Needs Support is now a Pipeline toggle; do not backfill tickets.");
}
