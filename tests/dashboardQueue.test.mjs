import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { withMePipelines } from "../src/lib/dashboardQueue.js";

const source = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Management With Me contains only active Pipelines explicitly assigned as Current Handler", () => {
  const data = [
    { id:"approval",status:"open",current_handler_id:"MGMT-1",support_needed:false,region_id:"R1" },
    { id:"supportOnly",status:"open",current_handler_id:"SM-1",support_needed:true,region_id:"R1" },
    { id:"otherManager",status:"open",current_handler_id:"MGMT-2",support_needed:true,region_id:"R1" },
    { id:"closed",status:"won",current_handler_id:"MGMT-1",region_id:"R1" },
    { id:"otherRegion",status:"open",current_handler_id:"MGMT-1",region_id:"R2" },
  ];
  assert.deepEqual(withMePipelines(data, "MGMT-1").map(x=>x.id), ["approval","otherRegion"]);
  // Backend-scoped cohort is applied first. With Me cannot broaden access.
  assert.deepEqual(withMePipelines(data.filter(x=>x.region_id==="R1"),"MGMT-1").map(x=>x.id),["approval"]);
  assert.deepEqual(withMePipelines(data,""),[]);
});

test("Management Action Queue includes With Me, Needs Support, an explicit Region column and fixed row height", () => {
  const s=source("src/pages/Dashboard.jsx");
  assert.ok(s.includes('["with", "With Me"], ["support", "Needs Support"]'));
  assert.ok(s.includes('const assigned = withMePipelines(cohort, profile?.id);'));
  assert.ok(s.includes('title="With Me"'));
  assert.ok(s.includes('regionColumn={isManagement}'));
  assert.ok(s.includes('{regionColumn && <th className="text-left font-medium py-2 pr-2">Region</th>}'));
  assert.ok(s.includes('className="h-[76px] border-b border-border last:border-0"'));
  assert.ok(s.includes('min-h-[16px]'));
  assert.ok(s.includes('selectedTab === "with" ? "handler_since"'));
});
