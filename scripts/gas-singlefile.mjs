// Build one copy/paste-ready Apps Script file after `npm run gas:build`.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dir = path.join(root, "apps-script");
const parts = ["SheetIds.js", "Contract.js", "GeoCore.js", "Main.js"];

for (const name of parts) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) throw new Error(`Missing ${p}; run npm run gas:build first`);
}

const content = [
  "// B2B GEO Pipeline API — copy this whole file into Code.gs",
  "// Generated from the current repository. Do not edit generated contract/core sections by hand.",
  "",
  ...parts.map((name) => `// ===== ${name} =====\n${fs.readFileSync(path.join(dir, name), "utf8").trim()}\n`),
].join("\n");

const out = path.join(dir, "Code.gs");
fs.writeFileSync(out, content + "\n");
console.log(`Wrote ${out} (${content.length} chars)`);
