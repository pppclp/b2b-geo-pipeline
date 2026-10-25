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
  for(const label of ["Active Filters","More Filters","Reset to Default","Show Results"]){
    assert.ok(filter.includes(label),`${label} is missing`);
  }
  assert.ok(!filter.includes("shouldShowDropdown"));
  assert.match(filter,/master\?\.Stage/);
  assert.match(filter,/master\?\.TeamMember/);
});

test("Pipeline board and list share one scoped filtered data set",()=>{
  assert.match(pipeline,/scopedOpportunities\.filter\(\(o\) =>/);
  assert.ok(!pipeline.includes("applyPipelineFilters"));
  assert.match(pipeline,/const sorted = useMemo\(\(\) => sortPipelineRows\(filtered, sort\)/);
  assert.match(pipeline,/const filteredWithoutStage = useMemo/);
  assert.match(pipeline,/const filtered = useMemo\(\(\) => filters\.stage/);
  assert.match(pipeline,/sorted\.filter\(\(o\) => o\.stage_id/);
  assert.match(pipeline,/sorted\.map\(\(o\) =>/);
  assert.match(pipeline,/if \(loading \|\| error\) return \(/);
  assert.match(pipeline,/error&&<Button[^>]*onClick=\{refresh\}/);
  assert.match(pipeline,/User_Region/);
  assert.match(pipeline,/filters\.status/);
});


test("List is default while Sort and Stage quick filters share the canonical Pipeline filters",()=>{
  assert.match(pipeline,/const \[view, setView\] = useState\("list"\)/);
  assert.match(pipeline,/const \[sort, setSort\] = useState\("close_month"\)/);
  assert.match(pipeline,/Quick filter by Stage/);
  assert.match(pipeline,/onClick=\{\(\) => onFilter\("stage", stage\.id\)\}/);
  assert.match(pipeline,/aria-pressed=\{filters\.stage === stage\.id\}/);
  assert.match(pipeline,/min-w-\[1190px\]/);
  assert.match(pipeline,/stageCounts\.get\(stage\.id\)/);
});


test("Pipeline list uses owner-first identity, conditional Working With and contextual Region",()=>{
  assert.match(pipeline,/AE Owner \/ Handling/);
  assert.match(pipeline,/const ownerName = maps\.member\[o\.owner_id\]/);
  assert.match(pipeline,/const handler = maps\.member\[o\.current_handler_id\]/);
  assert.match(pipeline,/const handlerName = handler\?\.name/);
  assert.match(pipeline,/differentOwner &&/);
  assert.match(pipeline,/smWorkingWithTeamLabels\(o, handler, master\?\.WorkingWithOption/);
  assert.match(pipeline,/teamLabels\.length > 0/);
  assert.match(pipeline,/regionContext\.showColumn/);
  assert.match(pipeline,/maps\.region\[o\.region_id\]/);
  assert.match(pipeline,/o\.status !== "open"/);
  assert.match(pipeline,/o\.support_needed/);
  assert.match(pipeline,/isStageSlaOverdue\(o, maps\.stage\)/);
  assert.match(pipeline,/onClick=\{\(\) => openQuickView\(o\.id\)\}/);
  assert.match(pipeline,/Product details:/);
  assert.ok(!pipeline.includes('>Status</th>'),"Do not repeat default Open in a status column");
});
