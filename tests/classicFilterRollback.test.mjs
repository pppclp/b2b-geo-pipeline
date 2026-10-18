import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const filter = readFileSync(new URL("../src/components/FilterBar.jsx", import.meta.url), "utf8");
const pipeline = readFileSync(new URL("../src/pages/Pipeline.jsx", import.meta.url), "utf8");
const model = readFileSync(new URL("../src/lib/roleFilterModel.js", import.meta.url), "utf8");

// Regression: PR25 removed important filter controls when options were sparse.
// PR29 stabilized the classic Radix Select; this evolution must preserve it.
test("Radix dropdown component is stable, outside FilterBar render scope",()=>{
  const at=filter.indexOf("function FilterDropdown(");
  const pageAt=filter.indexOf("export default function FilterBar");
  assert.ok(at>=0 && at<pageAt,"Dropdown should not remount on a filter change");
  assert.match(filter,/aria-label=\{label\}/);
  assert.match(filter,/normalizeFilterSelection\(fieldName, next\)/);
});

test("Search, Status, Expected Close and Stage remain visible for every role",()=>{
  assert.match(filter,/value=\{filters.search \|\| ""\}/);
  assert.match(filter,/\["status", "close_month", "stage"\]\.map\(renderField\)/);
  assert.ok(!filter.includes("shouldShowDropdown"));
  assert.ok(!filter.includes("availableFilterOptions"));
  assert.match(filter,/optionsFromVisiblePipelines/);
});

test("Classic backend-scoped Pipeline filtering and error/Retry remain intact",()=>{
  assert.match(pipeline,/scopedOpportunities\.filter\(\(o\) =>/);
  assert.ok(!pipeline.includes("applyPipelineFilters"));
  assert.match(pipeline,/error && \(/);
  assert.match(pipeline,/onClick=\{refresh\}/);
  assert.match(pipeline,/User_Region/);
  assert.match(pipeline,/filters\.status/);
  assert.match(pipeline,/roleOwnershipMatches/);
  assert.match(model,/regionIds/);
});
