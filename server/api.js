// Local dev backend: HTTP adapter around core.js with Excel files in data/.
// The YAML contract is re-read whenever b2b_geo_pipeline.yaml changes.
import fs from "node:fs";
import crypto from "node:crypto";
import { ExcelStore } from "./store.js";
import { loadContract } from "./contract.js";
import { createCore, HttpError } from "./core.js";
import { createSessionManager } from "./authSession.js";
import { createUatEmailAuth } from "./uatEmailActivation.js";
import { seedData } from "./seed.js";

const MASTER_FILES = ["B2B_GEO_User_Org_Master.xlsx", "B2B_Product_Master.xlsx", "B2B_GEO_Pipeline_Config.xlsx"];

export function createApi({ yamlPath, dataDir }) {
  const store = new ExcelStore(dataDir);
  // Ephemeral key by default for local UAT; use GEO_SESSION_SECRET for stable sessions.
  const sessions = createSessionManager(process.env.GEO_SESSION_SECRET || crypto.randomBytes(32).toString("hex"));
  const emailAuth = createUatEmailAuth();
  let cached = { mtime: 0, contract: null };

  function contract() {
    const mtime = fs.statSync(yamlPath).mtimeMs;
    if (mtime !== cached.mtime) cached = { mtime, contract: loadContract(yamlPath) };
    return cached.contract;
  }

  const boundFiles = (c) => Object.entries(c.access.files).filter(([, f]) => f.sheets).map(([file]) => file);
  const outputFiles = (c) => Object.entries(c.access.files).filter(([, f]) => f.output).map(([file]) => file);

  // Missing workbooks: full sample data when no master file exists yet,
  // otherwise empty sheets with the YAML columns (e.g. a fresh Pipeline DB).
  async function ensureFiles(c) {
    const missing = boundFiles(c).filter((f) => !store.exists(f));
    if (!missing.length) return;
    const sample = MASTER_FILES.every((f) => !store.exists(f)) ? seedData() : {};
    for (const file of missing) {
      await store.load(file);
      for (const [sheet, rule] of Object.entries(c.access.files[file].sheets)) {
        const t = store.table(file, sheet);
        t.headers = [...(c.columns[rule.entity] || [rule.primary_key])];
        t.rows = sample[file]?.[sheet] || [];
        store.touch(file, sheet);
      }
      console.log(`[geo-api] created data/${file}${sample[file] ? " (sample data)" : ""}`);
    }
    await store.flush();
  }

  async function body(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : undefined;
  }

  function send(res, status, payload) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  }

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    try {
      const payload = await body(req);
      const result = await store.run(async () => {
        const c = contract();
        await ensureFiles(c);
        await store.loadAll([...boundFiles(c), ...outputFiles(c)]);
        const core = createCore({
          contract: c,
          store,
          now: () => new Date().toISOString(),
          uuid: () => crypto.randomUUID(),
        });
        try {
          const path = url.pathname.replace(/^\/api\/?/, "");
          const loggingIn = req.method === "POST" && path === "session/login";
          const verifyingActivation = req.method === "POST" && path === "auth/activation/verify";
          const completingActivation = req.method === "POST" && path === "auth/activation/complete";
          const publicUatRequest = loggingIn || verifyingActivation || completingActivation;
          const token = /^Bearer (.+)$/i.exec(String(req.headers.authorization || ""))?.[1];
          const authenticatedUser = publicUatRequest ? null : sessions.verify(token);
          if (!publicUatRequest && !authenticatedUser) throw new HttpError(401, "Your session is invalid or has expired. Please sign in again.");
          let out;
          if (verifyingActivation) out = emailAuth.verify(store, payload?.email, payload?.code);
          else if (completingActivation) out = emailAuth.complete(store, payload?.activation_ticket, payload?.new_password, payload?.confirm_password);
          else if (loggingIn && process.env.GEO_UAT_EMAIL_LOGIN_ENABLED === "true")
            out = emailAuth.login(store, payload?.username, payload?.password);
          else out = core.handle({
            method: req.method,
            path,
            query: Object.fromEntries(url.searchParams),
            body: payload,
            // Never trust X-User-Id. Identity comes only from the signed bearer token.
            userId: authenticatedUser,
            demoAs: req.headers["x-demo-as"],
          });
          const result = loggingIn ? { ...out, session_token: sessions.issue(out.user_id) } : out;
          await store.flush();
          return result;
        } catch (e) {
          store.reset(); // drop half-applied in-memory changes; reload from disk next time
          throw e;
        }
      });
      send(res, 200, result);
    } catch (e) {
      const status = e.status || 500;
      const errorId = crypto.randomUUID();
      if (status >= 500) console.error("[geo-api]", errorId, e);
      send(res, status, status >= 500
        ? { message: "Backend request failed. Contact support with error ID " + errorId, code: e.publicCode || "BACKEND_ERROR", error_id: errorId }
        : { message: e.message, code: ({401:"UNAUTHENTICATED",403:"FORBIDDEN",409:"CONFLICT",410:"GONE",428:"PRECONDITION_REQUIRED",429:"RATE_LIMITED"}[status] || "REQUEST_ERROR") });
    }
  };
}
