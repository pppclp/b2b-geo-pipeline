// Local UAT parity for Employee ID -> temporary credential -> personal password.
// Apps Script implementation: apps-script/Main.js. Never a production identity provider.
import crypto from "node:crypto";

const failure = (status, message) => Object.assign(new Error(message), { status });
const hmac = (key, value) => crypto.createHmac("sha256", key).update(value).digest("base64url");
const same = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const employeeKey = v => String(v || "").trim();
const pending = c => !String(c.credential_status || "").trim() &&
  !String(c.password_set_at || "").trim() &&
  !String(c.activation_code_hash || "").trim() &&
  !String(c.activation_expires_at || "").trim() &&
  !String(c.activation_used_at || "").trim() &&
  !!(String(c.password_hash || "").trim() || String(c.temporary_password || "").trim());

export function createUatTemporaryPasswordSetup({ env = process.env, clock = () => Date.now() } = {}) {
  const attempts = new Map();
  const enabled = () => env.GEO_ENVIRONMENT === "UAT" &&
    env.GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED === "true";
  const secret = () => {
    const value = String(env.GEO_UAT_ACTIVATION_SECRET || "");
    if (value.length < 32) throw failure(503, "UAT password setup signing is not configured");
    return value;
  };
  const pepper = () => {
    const value = String(env.GEO_UAT_PASSWORD_PEPPER || "");
    if (value.length < 32) throw failure(503, "UAT password verification is not configured");
    return value;
  };
  const users = store => store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows;
  const credentials = store => store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows;
  function binding(store, key) {
    const selected = users(store).filter(u => employeeKey(u.employee_id) === key);
    if (selected.length !== 1 || !selected[0].user_id ||
      String(selected[0].status || "").toLowerCase() !== "active")
      throw failure(401, "Invalid username or password");
    const user = selected[0], uid = String(user.user_id).trim();
    const matches = credentials(store).filter(c =>
      employeeKey(c["employee_id / username"]) === key || employeeKey(c.user_id) === uid);
    if (matches.length !== 1 || employeeKey(matches[0].user_id) !== uid ||
      employeeKey(matches[0]["employee_id / username"]) !== key)
      throw failure(401, "Invalid username or password");
    return { user, credential: matches[0], uid };
  }
  function passwordMatches(c, password) {
    const value = String(password || "");
    const encoded = String(c.password_hash || "").trim();
    if (encoded) {
      const parts = encoded.split("$");
      if (parts.length !== 3 || parts[0] !== "hmac-sha256-v1" ||
        !/^[0-9a-f]{32}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{40,44}$/.test(parts[2]))
        throw failure(503, "UAT credential hash format is invalid");
      return same(parts[2], hmac(pepper(), parts[1] + ":" + value));
    }
    return !!String(c.temporary_password || "") && same(c.temporary_password, value);
  }
  const fingerprint = (uid, c) => {
    const digest = String(c.password_hash || "").trim();
    const material = digest ? "hash:" + digest : "temp:" + String(c.temporary_password || "");
    return hmac(secret(), "uat-temp-setup:" + uid + ":" + material);
  };
  function sign(uid, c) {
    const ts = Math.floor(clock() / 1000);
    const encoded = Buffer.from(JSON.stringify({
      v: 1, typ: "uat_temp_setup", sub: uid, fp: fingerprint(uid, c),
      iat: ts, exp: ts + 600,
    })).toString("base64url");
    return encoded + "." + hmac(secret(), encoded);
  }
  function read(ticket) {
    const parts = String(ticket || "").split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
      !same(parts[1], hmac(secret(), parts[0])))
      throw failure(401, "Password setup expired. Sign in again.");
    let data;
    try { data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); }
    catch { throw failure(401, "Password setup expired. Sign in again."); }
    const now = Math.floor(clock() / 1000);
    if (data.v !== 1 || data.typ !== "uat_temp_setup" ||
      typeof data.sub !== "string" || !data.sub || typeof data.fp !== "string" ||
      !Number.isInteger(data.iat) || !Number.isInteger(data.exp) ||
      data.iat > now + 60 || data.exp <= now || data.exp - data.iat !== 600)
      throw failure(401, "Password setup expired. Sign in again.");
    return data;
  }
  function count(key) {
    const k = hmac(secret(), key).slice(0,24);
    const entry = attempts.get(k);
    if (entry?.exp > clock() && entry.count >= 5) throw failure(429, "Too many login attempts. Try again in 10 minutes.");
    return k;
  }
  function login(store, employeeId, value) {
    if (!enabled()) throw failure(503, "UAT password setup is not enabled");
    const key = employeeKey(employeeId), rateKey = count(key);
    let selected;
    try {
      if (!key || key.includes("@") || !String(value || "")) throw failure(401, "Invalid username or password");
      selected = binding(store, key);
      const c = selected.credential;
      const eligible = pending(c);
      if (eligible ? !passwordMatches(c,value) :
        !(String(c.credential_status || "") === "active" && c.password_set_at &&
          String(c.password_hash || "").trim() && passwordMatches(c,value)))
        throw failure(401, "Invalid username or password");
      attempts.delete(rateKey);
      if (eligible) return {
        password_setup_required: true, password_setup_ticket: sign(selected.uid, c),
        expires_in_seconds: 600,
      };
      return { user_id: selected.uid, id: selected.uid,
        full_name: String(selected.user.display_name || ""), role: selected.user.role };
    } catch (e) {
      if (e.status === 401) {
        const item = attempts.get(rateKey), countValue = item?.exp > clock() ? item.count : 0;
        attempts.set(rateKey,{ count:countValue+1, exp:clock()+600000 });
      }
      throw e;
    }
  }
  function complete(store, ticket, password, confirm) {
    if (!enabled()) throw failure(503, "UAT password setup is not enabled");
    const claims = read(ticket);
    const selected = users(store).filter(u => String(u.user_id || "").trim() === claims.sub);
    if (selected.length !== 1 || String(selected[0].status || "").toLowerCase() !== "active" ||
      !employeeKey(selected[0].employee_id)) throw failure(401, "Password setup expired. Sign in again.");
    const { uid, credential:c } = binding(store, employeeKey(selected[0].employee_id));
    if (!pending(c) || !same(fingerprint(uid,c),claims.fp))
      throw failure(401, "Password setup expired. Sign in again.");
    const pw = String(password || ""), emailPart = String(selected[0].email || "").split("@")[0].toLowerCase();
    if (pw.length < 15 || pw.length > 128 || /[\x00-\x1f\x7f]/.test(pw) ||
      (emailPart && pw.toLowerCase().includes(emailPart)) ||
      pw.includes(employeeKey(selected[0].employee_id)) ||
      /^(password|123456|qwerty|letmein)/i.test(pw))
      throw failure(400, "Use a unique password of 15–128 characters without your Employee ID");
    if (pw !== String(confirm || "")) throw failure(400, "Passwords do not match");
    if (passwordMatches(c,pw)) throw failure(400, "New password must differ from the temporary password");
    const salt = crypto.randomBytes(16).toString("hex");
    const now = new Date(clock()).toISOString();
    Object.assign(c,{ password_hash:"hmac-sha256-v1$"+salt+"$"+hmac(pepper(),salt+":"+pw),
      password_hash_version:"hmac-sha256-v1",temporary_password:"",
      password_set_at:now,password_changed_at:now,credential_status:"active" });
    store.touch("B2B_GEO_UAT_Credentials_Distribution.xlsx","UAT_Credentials");
    return { password_set:true };
  }
  return { login, complete };
}
