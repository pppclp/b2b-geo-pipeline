import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const load = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Create and Edit show the approved optional partner label", () => {
  for (const path of ["src/components/CreatePipelineModal.jsx", "src/components/OpportunityForm.jsx"]) {
    const source = load(path);
    assert.match(source, /ชื่อพาร์ทเนอร์ \(ถ้ามี\)/);
    assert.doesNotMatch(source, /ชื่อพาร์ทเนอร์ \(ใน\s*UAT\)/);
  }
});

test("Create keeps Partner Name optional and only submits it for premium partners", () => {
  const source = load("src/components/CreatePipelineModal.jsx");
  assert.match(source, /partner_name:\s*form\.sales_channel === "B2B Premium Partner" \? form\.partner_name\.trim\(\) : ""/);
  assert.doesNotMatch(source, /errors\.partner_name\s*=/);
});

test("Edit retains an existing Partner Name when the sales channel changes", () => {
  const source = load("src/components/OpportunityForm.jsx");
  assert.match(source, /partner_name:\s*String\(form\.partner_name \|\| ""\)\.trim\(\)/);
  assert.match(source, /form\.sales_channel === "B2B Premium Partner" \|\| Boolean\(String\(opportunity\?\.partner_name \|\| ""\)\.trim\(\)\)/);
  assert.doesNotMatch(source, /partner_name:\s*form\.sales_channel === "B2B Premium Partner" \?[^\n]*: ""/);
});

test("Detail label and Import mapping guidance keep AE versus Partner identities separate", () => {
  const detail = load("src/pages/OpportunityDetail.jsx");
  const importer = load("src/pages/Import.jsx");
  assert.match(detail, /label="ชื่อพาร์ทเนอร์ \(ถ้ามี\)"/);
  assert.match(importer, /Historical Sale Name may refer to an AE or a Partner/);
  assert.match(importer, /Never infer either identity from Sale Name alone/);
});
