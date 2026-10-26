import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readImportFile } from "../src/lib/importWorkbook.js";
import { normalizeHistoricalGeoSource } from "../src/lib/historicalGeoSource.js";
import { makeHistoricalImportBatches } from "../src/lib/importBatches.js";

const csvFile = (value) => ({
  name: "synthetic.csv", size: value.length, text: async () => value
});
const parse = (text) => text.split("\n").map(line => line.split(","));

test("CSV parser prevents corrupted Thai text, null bytes and empty headers", async () => {
  await assert.rejects(readImportFile(csvFile("Customer Name\n\uFFFD"), parse), /encoding is invalid/);
  await assert.rejects(readImportFile(csvFile("Customer Name\nA\u0000B"), parse), /encoding is invalid/);
  await assert.rejects(readImportFile(csvFile(",,\n1,2,3"), parse), /header row is empty/);
  const result = await readImportFile(csvFile("\uFEFFCustomer Name,Business ID\nลูกค้าจำลอง,0012345"), parse);
  assert.deepEqual(result.headers, ["Customer Name", "Business ID"]);
  assert.deepEqual(result.rows, [["ลูกค้าจำลอง", "0012345"]]);
});

test("Import route catches rendering errors and reports file read activity", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../src/pages/Import.jsx", import.meta.url), "utf8");
  const boundary = fs.readFileSync(new URL("../src/components/ImportErrorBoundary.jsx", import.meta.url), "utf8");
  assert.ok(app.includes("<ImportErrorBoundary><Suspense"));
  assert.ok(page.includes("setReadingFile(true)"));
  assert.ok(page.includes("setReadingFile(false)"));
  assert.ok(page.includes("Reading file…"));
  assert.ok(boundary.includes("Import preview could not be displayed"));
});

test("239-row source: mixed layouts normalize and requests never exceed 200", () => {
  const header = ["Create Month", "Business ID", ...Array.from({length:13}, (_,i)=>"Field "+i),
    "Monthly Sale Plan", "Stage (Current)", "", ""];
  const rows=Array.from({length:239},(_,i)=>{
    const base=["4-มิ.ย.-26","0012345",...Array.from({length:13},(_,j)=>"SYNTH-"+j)];
    return i%2===0
      ? [...base,"Oct-26","Stage 1. Demo","",""]
      : [...base,"12 month","Oct-26","Stage 2. Demo","Synthetic remark"];
  });
  const normalized=normalizeHistoricalGeoSource(header,rows);
  assert.equal(normalized.rows.length,239);
  assert.ok(normalized.layoutErrors.every(x=>!x));
  assert.equal(normalized.rows[0][16],"Oct-26");
  assert.equal(normalized.rows[1][15],"12 month");
  const batches=makeHistoricalImportBatches(normalized.rows.map((row,i)=>({source_record_id:"SYNTH-"+i})), "a".repeat(32));
  assert.deepEqual(batches.map(b=>b.items.length), [200,39]);
  assert.notEqual(batches[0].batchId,batches[1].batchId);
});
