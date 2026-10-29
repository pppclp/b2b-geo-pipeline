import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { activeOpenStages, isActiveOpenStage, legacyOpenStageRecords } from "../src/lib/openStagePolicy.js";
const read = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Stage count and order are derived from active Stage Master; Won is not a Stage",()=>{
 const master=[
  {id:"STG003",name:"Stage 3",order:3,active:false},
  {id:"STG002",name:"Stage 2",order:2,active:true},
  {id:"STG001",name:"Stage 1",order:1,active:true},
  {id:"STG004",name:"Stage 4",order:4,active:false},
 ];
 assert.deepEqual(activeOpenStages(master).map(s=>s.id),["STG001","STG002"]);
 assert.equal(isActiveOpenStage("STG003",activeOpenStages(master)),false);
 master[0].active=true;
 assert.deepEqual(activeOpenStages(master).map(s=>s.id),["STG001","STG002","STG003"]);
 master[3].active=true;
 assert.deepEqual(activeOpenStages(master).map(s=>s.id),["STG001","STG002","STG003","STG004"]);
});

test("legacy Open records stay visible for review but Won/Lost remain statuses",()=>{
 const active=[{id:"S1",active:true,order:1},{id:"S2",active:true,order:2}];
 const rec=[
  {id:"a",status:"open",stage_id:"S1"},
  {id:"b",status:"open",stage_id:"S3"},
  {id:"c",status:"won",stage_id:"S3"},
  {id:"d",status:"lost",stage_id:"S3"},
  {id:"e",status:"open",stage_id:"UNKNOWN"},
 ];
 assert.deepEqual(legacyOpenStageRecords(rec,active).map(x=>x.id),["b","e"]);
 assert.deepEqual(legacyOpenStageRecords(rec,[...active,{id:"S3",active:true}]).map(x=>x.id),["e"]);
});

test("Board, Quick Update and Edit form use active master list without fixed Stage count",()=>{
 const board=read("src/pages/Pipeline.jsx");
 const context=read("src/lib/dataContext.jsx");
 const quick=read("src/components/PipelineQuickView.jsx");
 const edit=read("src/components/OpportunityForm.jsx");
 assert.ok(context.includes("activeOpenStages(master?.Stage)"));
 assert.ok(board.includes("activeStages.map((stage) =>"));
 assert.ok(board.includes("legacyOpenStageRecords(sorted, activeStages)"));
 assert.ok(board.includes("closedBoardRecords"));
 assert.ok(quick.includes("activeStages.map((stage)"));
 assert.ok(edit.includes("activeStages.map((s)"));
 assert.ok(!context.includes('s.id === "STG003"'));
 assert.ok(!board.includes("activeStages.slice(0, 2)"));
});
