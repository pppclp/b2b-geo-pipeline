// Local dev backend: HTTP adapter around core.js with Excel files in data/.
// The YAML contract is re-read whenever b2b_geo_pipeline.yaml changes.
import fs from "node:fs";
import crypto from "node:crypto";
import { ExcelStore } from "./store.js";
import { loadContract } from "./contract.js";
import { createCore } from "./core.js";
import { seedData } from "./seed.js";

const MASTER_FILES = ["B2B_GEO_User_Org_Master.xlsx", "B2B_Product_Master.xlsx", "B2B_GEO_Pipeline_Config.xlsx"];

export function createApi({ yamlPath, dataDir }) {
  const store = new ExcelStore(dataDir);
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
        const core = createCore({ contract: c, store, now: () => new Date().toISOString(), uuid: () => crypto.randomUUID() });
        try {
          const out = core.handle({
            method: req.method,
            path: url.pathname.replace(/^\/api\/?/, ""),
            query: Object.fromEntries(url.searchParams),
            body: payload,
            userId: req.headers["x-user-id"],
            demoAs: req.headers["x-demo-as"],
          });
          await store.flush();
          return out;
        } catch (e) {
          store.reset(); // drop half-applied in-memory changes; reload from disk next time
          throw e;
        }
      });
      send(res, 200, result);
    } catch (e) {
      if (!e.status) console.error("[geo-api]", e);
      send(res, e.status || 500, { message: e.message });
    }
  };
}
