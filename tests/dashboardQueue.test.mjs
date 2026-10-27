import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { managementTeamId, isWithMePipeline, withMePipelines } from "../src/lib/dashboardQueue.js";

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

test("Management Action Queue preserves With Me and Region after Support retirement", () => {
  const s=source("src/pages/Dashboard.jsx");
  assert.ok(s.includes('["with", "With Me"], ["overdue", "Overdue"]'));
  assert.ok(!s.includes('["support", "Needs Support"]'));
  assert.ok(s.includes('const assigned = withMePipelines(cohort, profile?.id, {'));
  assert.ok(s.includes('title="With Me"'));
  assert.ok(s.includes('regionColumn={isManagement}'));
  assert.ok(s.includes('{regionColumn && <th className="text-left font-medium py-2 pr-2">Region</th>}'));
  assert.ok(s.includes('className="h-[76px] border-b border-border last:border-0"'));
  assert.ok(s.includes('min-h-[16px]'));
  assert.ok(s.includes('selectedTab === "with" ? "handler_since"'));
  assert.ok(s.includes('const withMeQuery = isManagement ? { with_me: "1" } : { handler: profile?.id };'));
  assert.ok(s.includes('...(selectedTab === "with" ? withMeQuery : {}),'));
  assert.ok(s.includes('onClick={() => toPipeline({ status: "open", ...withMeQuery })}'));
});

test("Management Working With makes open Pipelines visible to every authorized manager without changing Handler", () => {
  const teams = [
    {id:"WW001",name:"Pre-sales",active:true},
    {id:"WW007",name:"Management",active:true},
  ];
  assert.equal(managementTeamId(teams),"WW007");
  const data = [
    {id:"assigned",status:"open",region_id:"R1",current_handler_id:"MGMT1",working_with_team_ids:""},
    {id:"management",status:"open",region_id:"R1",current_handler_id:"SM1",working_with_team_ids:"WW007"},
    {id:"multiTeam",status:"open",region_id:"R1",current_handler_id:"AE1",working_with_team_ids:" WW001, WW007 "},
    {id:"preSales",status:"open",region_id:"R1",current_handler_id:"SM1",working_with_team_ids:"WW001"},
    {id:"otherManager",status:"open",region_id:"R1",current_handler_id:"MGMT2",working_with_team_ids:""},
    {id:"closed",status:"won",region_id:"R1",current_handler_id:"MGMT1",working_with_team_ids:"WW007"},
    {id:"otherRegion",status:"open",region_id:"R2",current_handler_id:"SM2",working_with_team_ids:"WW007"},
  ];
  const management = {role:"management",teams};
  assert.deepEqual(withMePipelines(data,"MGMT1",management).map(o=>o.id),
    ["assigned","management","multiTeam","otherRegion"]);
  assert.deepEqual(withMePipelines(data,"MGMT2",management).map(o=>o.id),
    ["management","multiTeam","otherManager","otherRegion"]);
  assert.deepEqual(withMePipelines(data.filter(o=>o.region_id==="R1"),"MGMT2",management).map(o=>o.id),
    ["management","multiTeam","otherManager"]);
  assert.deepEqual(withMePipelines(data,"SM1",{role:"sm",teams}).map(o=>o.id),["management","preSales"]);
  assert.deepEqual(withMePipelines(data,"AE1",{role:"ae",teams}).map(o=>o.id),["multiTeam"]);
  assert.equal(data[1].current_handler_id,"SM1","Working With never changes Current Handler");
});

test("Management matching fails closed without a unique active configured team", () => {
  const row={status:"open",current_handler_id:"AE1",working_with_team_ids:"WW007",working_with:"Management"};
  for(const teams of [
    [],
    [{id:"WW007",name:"Management",active:false}],
    [{id:"WW007",name:"Management",active:true},{id:"WW008",name:"management",active:true}],
  ]) {
    assert.equal(isWithMePipeline(row,"MGMT1",{role:"management",teams}),false);
  }
  assert.equal(isWithMePipeline(row,"AE1",{role:"ae",teams:[]}),true,"Direct Handler is unaffected");
  assert.equal(isWithMePipeline(row,"MGMT1",{role:"sm",teams:[{id:"WW007",name:"Management",active:true}]}),false);
  assert.equal(isWithMePipeline(row,"",{role:"management",teams:[{id:"WW007",name:"Management",active:true}]}),false);
});

test("Legacy single-team Management rows remain visible; selected non-Management teams are authoritative", () => {
  const context={role:"management",teams:[{id:"WW007",name:"Management",active:true}]};
  assert.equal(isWithMePipeline({status:"open",current_handler_id:"SM1",working_with:"Management"},"MGMT1",context),true);
  assert.equal(isWithMePipeline({status:"open",current_handler_id:"SM1",working_with_id:"WW007"},"MGMT1",context),true);
  assert.equal(isWithMePipeline({status:"open",current_handler_id:"SM1",working_with:"Management",working_with_team_ids:"WW001"},"MGMT1",context),false);
});
