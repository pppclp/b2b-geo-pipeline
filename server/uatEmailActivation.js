// Node-only parity for UAT corporate email activation. GAS equivalent is in
// apps-script/Main.js. Do not use this custom credentials store in production.
import crypto from "node:crypto";

const CODE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TICKET_LIFETIME_SEC = 600;
const hash = (key, value) => crypto.createHmac("sha256", key).update(value).digest("base64url");
const same = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const http = (status, message) => Object.assign(new Error(message), { status });
export const emailKey = v => {
  const s = String(v || "").trim().toLowerCase();
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
};
export function createUatEmailAuth({ env = process.env, clock = () => Date.now() } = {}) {
  const allowed = () => String(env.GEO_UAT_ALLOWED_EMAIL_DOMAINS || "").toLowerCase().split(",")
    .map(s => s.trim().replace(/^@/, "")).filter(Boolean);
  const validDomain = email => allowed().includes(emailKey(email).split("@")[1]);
  const secret = () => {
    const v = String(env.GEO_UAT_ACTIVATION_SECRET || "");
    if (v.length < 32) throw http(503, "UAT activation secret is missing");
    return v;
  };
  const pepper = () => {
    const v = String(env.GEO_UAT_PASSWORD_PEPPER || "");
    if (v.length < 32) throw http(503, "UAT password pepper is missing");
    return v;
  };
  const live = key => env.GEO_ENVIRONMENT === "UAT" && env[key] === "true";
  const users = store => store.table("B2B_GEO_User_Org_Master.xlsx", "Users").rows;
  const credentials = store => store.table("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials").rows;
  function account(store, value) {
    const email = emailKey(value);
    if (!validDomain(email)) throw http(401, "Invalid activation credentials");
    const matchingUsers = users(store).filter(u => emailKey(u.email) === email);
    if (matchingUsers.length !== 1 || String(matchingUsers[0].status || "").toLowerCase() !== "active" ||
      !String(matchingUsers[0].employee_id || "").trim())
      throw http(401, "Invalid activation credentials");
    const matches = credentials(store).filter(c => String(c.user_id || "").trim() === String(matchingUsers[0].user_id || "").trim());
    if (matches.length !== 1 ||
      String(matches[0]["employee_id / username"] || "").trim() !== String(matchingUsers[0].employee_id || "").trim())
      throw http(401, "Invalid activation credentials");
    return { email, user: matchingUsers[0], credential: matches[0] };
  }
  const validPassword = (pass, email) => {
    const pw = String(pass || "");
    if (pw.length < 10 || pw.length > 128 || /[\x00-\x1f\x7f]/.test(pw) ||
      pw.toLowerCase().includes(email.split("@")[0]) || /^(password|123456|qwerty|letmein)/i.test(pw))
      throw http(400, "Use a unique password of 10–128 characters without your email name");
    return pw;
  };
  function codeDigest(code) { return hash(secret(), "activate:" + String(code || "")); }
  function verify(store, email, code) {
    if (!live("GEO_UAT_EMAIL_ACTIVATION_ENABLED")) throw http(503, "Account activation is not enabled");
    const { user, credential: c } = account(store, email);
    if (c.credential_status !== "pending_activation" || !c.activation_code_hash ||
      c.activation_used_at || !(Date.parse(String(c.activation_expires_at || "")) > clock()) ||
      !same(c.activation_code_hash, codeDigest(code))) throw http(401, "Invalid activation credentials");
    const ts = Math.floor(clock() / 1000);
    const payload = Buffer.from(JSON.stringify({
      v: 1, typ: "uat_activate", sub: String(user.user_id), fp: String(c.activation_code_hash),
      iat: ts, exp: ts + TICKET_LIFETIME_SEC,
    })).toString("base64url");
    return { activation_ticket: payload + "." + hash(secret(), payload), expires_in_seconds: TICKET_LIFETIME_SEC };
  }
  function ticketVerify(ticket) {
    const pieces = String(ticket || "").split(".");
    if (pieces.length !== 2 || !same(hash(secret(), pieces[0]), pieces[1]))
      throw http(401, "Activation expired. Verify your code again.");
    let data;
    try { data = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8")); }
    catch { throw http(401, "Activation expired. Verify your code again."); }
    const ts = Math.floor(clock() / 1000);
    if (data.v !== 1 || data.typ !== "uat_activate" || !data.sub || typeof data.fp !== "string" ||
      !Number.isInteger(data.iat) || !Number.isInteger(data.exp) ||
      data.iat > ts + 60 || data.exp <= ts || data.exp - data.iat > TICKET_LIFETIME_SEC)
      throw http(401, "Activation expired. Verify your code again.");
    return data;
  }
  function complete(store, ticket, newPassword, confirm) {
    if (!live("GEO_UAT_EMAIL_ACTIVATION_ENABLED")) throw http(503, "Account activation is not enabled");
    const data = ticketVerify(ticket);
    const allUsers = users(store);
    const matching = allUsers.filter(u => String(u.user_id) === data.sub);
    if (matching.length !== 1 || String(matching[0].status || "").toLowerCase() !== "active" ||
      !String(matching[0].employee_id || "").trim() ||
      !validDomain(emailKey(matching[0].email)) ||
      allUsers.filter(u => emailKey(u.email) === emailKey(matching[0].email)).length !== 1)
      throw http(401, "Activation expired. Verify your code again.");
    const sameCredentials = credentials(store).filter(c => String(c.user_id || "") === data.sub);
    if (sameCredentials.length !== 1 ||
      String(sameCredentials[0]["employee_id / username"] || "").trim() !== String(matching[0].employee_id || "").trim())
      throw http(401, "Activation expired. Verify your code again.");
    const c = sameCredentials[0];
    if (c.credential_status !== "pending_activation" || !c.activation_code_hash ||
      c.activation_used_at || !same(c.activation_code_hash, data.fp) ||
      !(Date.parse(String(c.activation_expires_at || "")) > clock()))
      throw http(401, "Activation expired. Verify your code again.");
    const password = validPassword(newPassword, emailKey(matching[0].email));
    if (password !== String(confirm || "")) throw http(400, "Passwords do not match");
    const salt = crypto.randomBytes(16).toString("hex");
    const now = new Date(clock()).toISOString();
    Object.assign(c, {
      password_hash: "hmac-sha256-v1$" + salt + "$" + hash(pepper(), salt + ":" + password),
      password_hash_version: "hmac-sha256-v1",
      temporary_password: "", password_set_at: now, password_changed_at: now,
      credential_status: "active", activation_used_at: now, activation_code_hash: "", activation_expires_at: "",
    });
    store.touch("B2B_GEO_UAT_Credentials_Distribution.xlsx", "UAT_Credentials");
    return { activated: true };
  }
  function login(store, value, password) {
    if (!live("GEO_UAT_EMAIL_LOGIN_ENABLED")) throw http(503, "Email login not enabled");
    const { user, credential: c } = account(store, value);
    const valueParts = String(c.password_hash || "").split("$");
    const ok = c.credential_status === "active" && c.password_set_at &&
      valueParts.length === 3 && valueParts[0] === "hmac-sha256-v1" &&
      /^[a-f0-9]{32}$/.test(valueParts[1]) && same(valueParts[2],hash(pepper(),valueParts[1] + ":" + String(password || "")));
    if (!ok) throw http(401, "Invalid username or password");
    return { user_id: user.user_id, id: user.user_id, full_name: user.display_name, role: user.role };
  }
  return { verify, complete, login, codeDigest, codeLifetimeMs: CODE_LIFETIME_MS };
}
