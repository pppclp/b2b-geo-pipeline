// Reads .env.local / .env (KEY=VALUE lines) without extra dependencies.
import fs from "node:fs";
import path from "node:path";

export function readEnv(root = process.cwd()) {
  const env = {};
  for (const name of [".env", ".env.local"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return { ...env, ...process.env };
}

// { "B2B_Product_Master.xlsx": "<sheet id>", ... } for every GEO_SHEET_ID_* that is set.
export function sheetIds(env) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([k, v]) => k.startsWith("GEO_SHEET_ID_") && v)
      .map(([k, v]) => [`${k.slice("GEO_SHEET_ID_".length)}.xlsx`, v])
  );
}
