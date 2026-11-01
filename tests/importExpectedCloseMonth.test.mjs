import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mapImportHeaders, resolveImportExpectedCloseMonth } from "../src/lib/importHeaderMapping.js";
import { legacySourceMonth } from "../src/lib/legacyImport.js";

test("Historical GEO Monthly Sale Plan header maps to source evidence rather than a second duplicate column",()=>{
  const fields=[
    {key:"source_monthly_sale_plan",label:"Source Monthly Sale Plan"},
    {key:"expected_close_month",label:"Expected Close Month"},
  ];
  const m=mapImportHeaders(["Customer Name","Monthly Sale Plan"],fields);
  assert.equal(m.source_monthly_sale_plan,1);
  assert.equal(m.expected_close_month,undefined);
});

test("Imported Monthly Sale Plan fills Expected Close Month without losing evidence",()=>{
  const source=legacySourceMonth("ต.ค.-26");
  assert.equal(source,"2026-10");
  assert.deepEqual(resolveImportExpectedCloseMonth(source,""),{month:"2026-10",error:""});
  assert.equal(source,"2026-10");
});

test("An explicit Expected Close Month remains intact when source absent",()=>{
  assert.deepEqual(resolveImportExpectedCloseMonth("",legacySourceMonth("Dec-26")),{
    month:"2026-12",error:""
  });
});

test("Identical source and explicit Expected Close Month are accepted",()=>{
  assert.deepEqual(resolveImportExpectedCloseMonth("2026-10","2026-10"),{month:"2026-10",error:""});
});

test("Conflicting source and explicit months block import (no silent overwrite)",()=>{
  const decision=resolveImportExpectedCloseMonth("2026-10","2026-11");
  assert.equal(decision.month,"");
  assert.match(decision.error,/disagree/);
});

test("Missing months remain missing; unknown dates are never fabricated",()=>{
  assert.deepEqual(resolveImportExpectedCloseMonth("",""),{month:"",error:""});
  assert.equal(legacySourceMonth("invalid-month"),null);
  assert.equal(legacySourceMonth("2026-13"),null);
});

test("Import preview normalizes both months and applies reconciliation before row validation",()=>{
  const ui=fs.readFileSync(new URL("../src/pages/Import.jsx",import.meta.url),"utf8");
  assert.ok(ui.includes('f.key === "source_monthly_sale_plan" || f.key === "expected_close_month"'));
  assert.ok(ui.includes("const resolvedCloseMonth = resolveImportExpectedCloseMonth("));
  assert.ok(ui.includes("if (resolvedCloseMonth.error) errors.push(resolvedCloseMonth.error)"));
  assert.ok(ui.includes("else if (resolvedCloseMonth.month) rec.expected_close_month = resolvedCloseMonth.month"));
  assert.ok(ui.indexOf("const resolvedCloseMonth")<ui.indexOf('FIELDS.filter((f) => f.required)'));
});
