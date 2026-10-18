import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const filter = readFileSync(new URL("../src/components/FilterBar.jsx", import.meta.url), "utf8");
const pipeline = readFileSync(new URL("../src/pages/Pipeline.jsx", import.meta.url), "utf8");

// Static UI regression guard. The Vite build in CI validates JSX and imports.
test("Classic filter keeps stable Select dropdown component outside rendering scope",()=>{
  const selectorAt=filter.indexOf("const SelectWrap =");
  const pageAt=filter.indexOf("export default function FilterBar");
  assert.ok(selectorAt>=0 && selectorAt<pageAt,"SelectWrap must not remount on each filter render");
  assert.match(filter,/value=\{value \|\| "all"\}/);
  assert.match(filter,/aria-label=\{label\}/);
});

test("All classic Dropdowns are visible regardless of result count",()=>{
  for(const filterKey of ["region","owner","handler","stage","status","product_category","sales_channel","ccp_check_result","scenario","working_with","support"]){
    assert.ok(filter.includes(`value={filters.${filterKey}}`),`${filterKey} dropdown missing`);
  }
  assert.ok(!filter.includes("shouldShowDropdown"));
  assert.ok(!filter.includes("availableFilterOptions"));
  assert.match(filter,/master\?\.Stage/);
  assert.match(filter,/master\?\.TeamMember/);
});

test("Restore classic Pipeline filtering while retaining diagnostics for backend failures",()=>{
  assert.match(pipeline,/scopedOpportunities\.filter\(\(o\) =>/);
  assert.ok(!pipeline.includes("applyPipelineFilters"));
  assert.match(pipeline,/error && \(/);
  assert.match(pipeline,/onClick=\{refresh\}/);
  assert.match(pipeline,/User_Region/);
  assert.match(pipeline,/filters\.status/);
});
