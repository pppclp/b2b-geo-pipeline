// Downloads the Google Sheets bound in access_control into data/*.xlsx so the
// local Excel API works on the real master data.
//   npm run sheets:pull            masters + Pipeline DB (if its ID is set)
// Uses the sheet's xlsx export link, so it only works while the sheet is
// shared as "Anyone with the link". Local edits in data/ are overwritten.
import fs from "node:fs";
import path from "node:path";
import { readEnv, sheetIds } from "./env.mjs";
import ExcelJS from "exceljs";
import { loadContract } from "../server/contract.js";

const root = process.cwd();
const dataDir = path.join(root, process.env.GEO_DATA_DIR || "data");
const contract = loadContract(path.join(root, "b2b_geo_pipeline.yaml"));
const ids = sheetIds(readEnv(root));

const files = contract.access.files;
const bound = Object.keys(files).filter((file) => files[file].sheets || files[file].output);

// Output templates ship with sample rows; the app writes real data there, so start empty.
async function clearOutputSamples(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dataDir, file));
  for (const [sheet, cfg] of Object.entries(files[file].output)) {
    const ws = wb.getWorksheet(sheet);
    if (!ws || cfg.mode === "cells") continue;
    for (let r = 2; r <= ws.rowCount; r++) ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => (cell.value = null));
  }
  await wb.xlsx.writeFile(path.join(dataDir, file));
}

fs.mkdirSync(dataDir, { recursive: true });
let failed = false;
for (const file of bound) {
  const id = ids[file];
  if (!id) {
    console.log(`skip  ${file} — no GEO_SHEET_ID_${file.replace(/\.xlsx$/, "")} in .env.local`);
    continue;
  }
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`);
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("spreadsheetml")) {
    console.error(`FAIL  ${file} — HTTP ${res.status} (${type.split(";")[0]}). Is the sheet shared as "Anyone with the link"?`);
    failed = true;
    continue;
  }
  fs.writeFileSync(path.join(dataDir, file), Buffer.from(await res.arrayBuffer()));
  if (files[file].output) await clearOutputSamples(file);
  console.log(`ok    ${file}${files[file].output ? " (sample rows cleared)" : ""}`);
}
process.exit(failed ? 1 : 0);
