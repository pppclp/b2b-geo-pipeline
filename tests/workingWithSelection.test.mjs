import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  splitWorkingIds, toggleWorkingId, selectableWorkingPeople,
} from "../src/lib/workingWithSelection.js";

test("Working With team toggles add/remove stable IDs and persist multiple teams", () => {
  assert.deepEqual(splitWorkingIds("WW001, WW002"), ["WW001","WW002"]);
  assert.equal(toggleWorkingId("", "WW001", 8), "WW001");
  assert.equal(toggleWorkingId("WW001", "WW007", 8), "WW001,WW007");
  assert.equal(toggleWorkingId("WW001,WW007", "WW001", 8), "WW007");
  assert.equal(toggleWorkingId("WW001,WW007", "WW007", 8), "WW001");
});

test("Working With enforces max selections but permits deselection", () => {
  assert.equal(toggleWorkingId("A,B", "C", 2), "A,B");
  assert.equal(toggleWorkingId("A,B", "B", 2), "A");
});

test("individual options are scoped, with Management represented by Team instead", () => {
  const people = [
    {id:"AE1",name:"AE One",app_role:"ae",active:true,region_ids:["R1"]},
    {id:"SM1",name:"SM One",app_role:"sm",active:true,region_ids:["R1"]},
    {id:"AE2",name:"AE Other",app_role:"ae",active:true,region_ids:["R2"]},
    {id:"M1",name:"Management",app_role:"management",active:true,region_ids:["R1"]},
    {id:"OLD",name:"Legacy",app_role:"management",active:false,region_ids:["R2"]},
  ];
  assert.deepEqual(selectableWorkingPeople(people,"R1").map(p=>p.id),["AE1","SM1"]);
  assert.deepEqual(selectableWorkingPeople(people,"R1","OLD").map(p=>p.id),["AE1","SM1","OLD"]);
});

test("Quick Actions allow Management on open Pipelines and show readonly reason", () => {
  const quick = readFileSync(new URL("../src/components/PipelineQuickView.jsx", import.meta.url),"utf8");
  const selector = readFileSync(new URL("../src/components/WorkingWithMultiSelect.jsx", import.meta.url),"utf8");
  assert.match(quick,/profile\?\.app_role === "management"/);
  assert.match(quick,/disabled=\{!canEdit \|\| saving\}/);
  assert.match(quick,/className="py-3 space-y-2"/);
  assert.match(selector,/type="checkbox" checked=\{checked\}/);
  assert.match(selector,/onChange=\{\(\) => onTeams\(toggleWorkingId/);
  assert.match(selector,/onChange=\{\(\) => onUsers\(toggleWorkingId/);
  assert.match(selector,/Read-only\. Changes are available/);
  assert.match(selector,/Add a person \(optional\)/);
  assert.match(selector,/Search name or Employee ID/);
});
