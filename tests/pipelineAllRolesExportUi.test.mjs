import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/pages/Pipeline.jsx", import.meta.url), "utf8");
const backend = readFileSync(new URL("../server/core.js", import.meta.url), "utf8");
const contract = readFileSync(new URL("../b2b_geo_pipeline.yaml", import.meta.url), "utf8");

test("Export Excel button is visible without a separate per-role access request", () => {
  assert.match(page, /onClick=\{exportExcel\}[\s\S]*?Export Excel/);
  assert.ok(!page.includes("{canExport &&"), "export must not be hidden on access lookup error");
  assert.ok(!page.includes("setCanExport("), "no separate access-probe state gate");
  assert.ok(!page.includes("db.access()"), "no secondary permission endpoint needed for visibility");
});

test("Excel contains only filtered, freshly server-authorized Pipeline IDs", () => {
  assert.ok(page.includes("const authorized = await db.exports.pipelines()"));
  assert.ok(page.includes("new Set(sorted.map((o) => String(o.id)))"));
  assert.ok(page.includes("authorized.filter((o) => filteredIds.has(String(o.id)))"));
  assert.ok(page.includes("downloadPipelineExcel(authorizedAndFiltered, maps)"));
  assert.ok(backend.includes('need(actor, b, "read")'));
  assert.ok(backend.includes('need(actor, b, "export")'));
  assert.ok(backend.includes('return entityApi.list("Opportunity", actor)'));
});

test("The real Pipelines export contract authorizes AE/SM/Management/Admin without hard-delete access", () => {
  const section = contract.split('"B2B_GEO_Pipeline_DB.xlsx":')[1]?.split("Pipeline_Tasks:")[0] || "";
  assert.match(section, /export:\s*\["AE",\s*"SM",\s*"Management",\s*"Admin"\]/);
  assert.match(section, /delete:\s*\[\]/);
});
