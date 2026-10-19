import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const filter = readFileSync(new URL("../src/components/FilterBar.jsx",import.meta.url),"utf8");
const pipeline = readFileSync(new URL("../src/pages/Pipeline.jsx",import.meta.url),"utf8");

test("FilterBar keeps stable dropdown component identity and accessible labels",()=>{
  const selectorAt=filter.indexOf("const SelectWrap =");
  const pageAt=filter.indexOf("export default function FilterBar");
  assert.ok(selectorAt>=0 && selectorAt<pageAt,"SelectWrap must be declared outside render");
  assert.match(filter,/value=\{value \|\| "all"\}/);
  assert.match(filter,/aria-label=\{label\}/);
});

test("Compact English quick filters retain access to all existing advanced fields",()=>{
  for(const key of ["close_month","region","owner","stage","status",
    "created_month","handler","product_category","sales_channel",
    "ccp_check_result","scenario","working_with","support"]){
    assert.ok(filter.includes(`filters.${key}`),`${key} dropdown is missing`);
  }
  for(const component of ["Popover","SearchableSelect","MonthPicker"]){
    assert.ok(filter.includes(component),`${component} is missing`);
  }
  for(const label of ["Active Filters","Advanced Filters","Reset to Default","Show Results"]){
    assert.ok(filter.includes(label),`${label} is missing`);
  }
  assert.ok(!filter.includes("shouldShowDropdown"));
  assert.match(filter,/master\?\.Stage/);
  assert.match(filter,/master\?\.TeamMember/);
});

test("Pipeline board and list share one scoped filtered data set",()=>{
  assert.match(pipeline,/scopedOpportunities\.filter\(\(o\) =>/);
  assert.ok(!pipeline.includes("applyPipelineFilters"));
  assert.match(pipeline,/const sorted = useMemo\(\(\) => applySort\(filtered, sort\)/);
  assert.match(pipeline,/sorted\.filter\(\(o\) => o\.stage_id/);
  assert.match(pipeline,/sorted\.map\(\(o\) =>/);
  assert.match(pipeline,/error && \(/);
  assert.match(pipeline,/onClick=\{refresh\}/);
  assert.match(pipeline,/User_Region/);
  assert.match(pipeline,/filters\.status/);
});
