import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { visibleFilterFields } from "../src/lib/roleFilterModel.js";

const filter=readFileSync(new URL("../src/components/FilterBar.jsx",import.meta.url),"utf8");
const pipeline=readFileSync(new URL("../src/pages/Pipeline.jsx",import.meta.url),"utf8");

test("Role Filter retains stable Radix dropdown component outside FilterBar scope",()=>{
  const selectorAt=filter.indexOf("function FilterDropdown(");
  const pageAt=filter.indexOf("export default function FilterBar");
  assert.ok(selectorAt>=0 && selectorAt<pageAt,"Dropdown must not remount on each parent render");
  assert.match(filter,/aria-label=\{label\}/);
  assert.match(filter,/onValueChange=\{/);
});

test("Every role sees Created Month and core controls; no duplicate sidebar views",()=>{
  for(const role of ["ae","sm","management","admin"]) {
    const keys=visibleFilterFields(role,["N","E"]).primary;
    for(const key of ["status","close_month","created_month","stage"])assert.ok(keys.includes(key),role+": "+key);
  }
  assert.match(filter,/\["status", "close_month", \.\.\.\(showCreatedMonth/);
  assert.ok(!filter.includes("OWNERSHIP_OPTIONS"),"Do not duplicate My/Handed Off/Assigned filters");
  assert.match(filter,/optionsFromVisiblePipelines\(key, scopedOpportunities, maps, master\)/);
  assert.ok(!filter.includes("shouldShowDropdown"));
});

test("Pipeline retains old-style scoped filtering, sidebar Handler deep links and backend load diagnostics",()=>{
  assert.match(pipeline,/scopedOpportunities\.filter\(\(o\) =>/);
  assert.match(pipeline,/params\.get\("view"\) === "assigned-to-me"/);
  assert.match(pipeline,/filters\.handler && o\.current_handler_id !== filters\.handler/);
  assert.ok(!pipeline.includes("roleOwnershipMatches"));
  assert.match(pipeline,/error && \(/);
  assert.match(pipeline,/onClick=\{refresh\}/);
  assert.match(pipeline,/User_Region/);
});
