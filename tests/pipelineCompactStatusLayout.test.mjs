import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PIPELINE_STATUS_TABS,
  pipelineStatusCounts,
  nextPipelineStatusFilters,
  pipelineStageDisplay,
} from "../src/lib/pipelineStatusTabs.js";
import { reviewQueueCounts } from "../src/lib/pipelineReviewQueue.js";

const stages=[{id:"STG001",name:"Stage 1",active:true},{id:"STG002",name:"Stage 2",active:true}];
const map=Object.fromEntries(stages.map(stage=>[stage.id,stage]));
const rows=[
  {id:"P1",customer_name:"A",status:"open",stage_id:"STG001",region_id:"BMA",expected_close_month:"2026-10"},
  {id:"P2",customer_name:"B",status:"open",stage_id:"STG002",region_id:"BMA",expected_close_month:"2026-11"},
  {id:"P3",customer_name:"C",status:"open",stage_id:"STG003",region_id:"NORTH",expected_close_month:"2026-10"},
  {id:"P4",customer_name:"D",status:"won",stage_id:"STG003",region_id:"BMA",expected_close_month:"2026-10"},
  {id:"P5",customer_name:"E",status:"lost",stage_id:"STG002",region_id:"NORTH",expected_close_month:"2026-10"},
];
const context={master:{WorkingWithOption:[]},maps:{stage:map},config:{},viewerId:"U1",viewerRole:"management"};

test("Three visible statuses, counts are independent from selected Stage and Open work view",()=>{
 assert.deepEqual(PIPELINE_STATUS_TABS.map(t=>t.id),["open","won","lost"]);
 assert.deepEqual(pipelineStatusCounts(rows,{status:"open",stage:"STG001",stuck:"1"},context),{open:3,won:1,lost:1});
});
test("Status counts respect caller-scoped rows and independent filters",()=>{
 assert.deepEqual(pipelineStatusCounts(rows,{region:"BMA"},context),{open:2,won:1,lost:0});
 assert.deepEqual(pipelineStatusCounts(rows.slice(0,2),{},context),{open:2,won:0,lost:0});
 assert.deepEqual(pipelineStatusCounts(rows,{close_month:"2026-11"},context),{open:1,won:0,lost:0});
});
test("Selecting Won/Lost removes stale Open filters, retaining real independent choices",()=>{
 const f={status:"open",stage:"STG001",stuck:"1",due_this_month:"1",
   with_me:"1",handler:"U1",internal_overdue:"1",region:"BMA",
   search:"Company",product_category:"CAT",close_month:"2026-11",
   lost_month:"2026-09",lost_reason:"REASON",won_month:"2026-08"};
 const closed=nextPipelineStatusFilters(f,"won");
 assert.equal(closed.status,"won");
 for(const k of ["stage","stuck","due_this_month","with_me","handler","internal_overdue","lost_month","lost_reason","won_month"])
   assert.equal(closed[k],"",k);
 for(const k of ["region","search","product_category","close_month"])
   assert.equal(closed[k],f[k],k);
 assert.equal(f.stage,"STG001","input is immutable");
 assert.equal(nextPipelineStatusFilters(f,"archived").status,"archived");
 assert.equal(nextPipelineStatusFilters(f,"all").status,"all");
});
test("Stage 1 and Stage 2 semantic mapping remains intact independently of new color palette",()=>{
 assert.deepEqual(pipelineStageDisplay(rows[0],stages,map),{label:"Stage 1",tone:"stage1"});
 assert.deepEqual(pipelineStageDisplay(rows[1],stages,map),{label:"Stage 2",tone:"stage2"});
 assert.deepEqual(pipelineStageDisplay(rows[2],stages,map),{label:"รอยืนยัน Stage",tone:"review"});
 assert.deepEqual(pipelineStageDisplay(rows[3],stages,map),{label:"Won",tone:"won"});
 assert.deepEqual(pipelineStageDisplay(rows[4],stages,map),{label:"Lost",tone:"lost"});
 assert.equal(pipelineStageDisplay({...rows[0],stage_id:"STG004"},stages,map).tone,"review");
});
test("Stage Review count only includes Open records with retired Stage",()=>{
 const c=reviewQueueCounts(rows,stages,"management");
 assert.equal(c.stage,1);
});
test("Compact UI retains four work tabs, primary controls, all status tabs, Board, Export, and Review Queue link",()=>{
 const read=p=>fs.readFileSync(new URL("../src/"+p,import.meta.url),"utf8");
 const page=read("pages/Pipeline.jsx"),bar=read("components/FilterBar.jsx"),dashboard=read("pages/Dashboard.jsx");
 for(const name of ["All Open","With Me","Overdue","Due This Month"]) assert.ok(page.includes(name),name);
 assert.ok(page.includes("PIPELINE_STATUS_TABS.map"));
 assert.ok(page.includes('aria-label="Filter Pipelines by Status"'));
 assert.ok(page.includes('showStatusControl={false}'));
 assert.ok(page.includes("compactLayout"));
 assert.ok(page.includes("showRegionControl"));
 assert.ok(page.includes("<RegionQuickFilter"));
 assert.ok(page.includes('appearance="neutral"'));
 assert.ok(page.includes('showRegionControl={!hasRegionQuickFilter}'));
 assert.ok(page.includes('onClick={() => navigate("/review-queue?tab=stage")}'));
 assert.ok(page.includes("งานรอตรวจสอบ Stage"));
 assert.ok(page.includes("Export Excel"));
 assert.ok(page.includes("สร้าง Pipeline"));
 assert.ok(page.includes("setView(\"board\")"));
 assert.ok(bar.includes('!showStatusControl && <SelectWrap label={LABELS.status}'));
 assert.ok(bar.includes('"archived"'));
 assert.ok(dashboard.includes('navigate("/review-queue?tab=stage")'));
 assert.ok(!dashboard.includes("Historical Stage · รอตรวจสอบ:"));
});
test("Hover paints whole row and its sticky company cell the same surface; stage hues follow approved teal and blue palette",()=>{
 const src=fs.readFileSync(new URL("../src/pages/Pipeline.jsx",import.meta.url),"utf8");
 assert.ok(src.includes("cursor-pointer bg-card hover:bg-secondary transition-colors"));
 assert.ok(src.includes("bg-card px-3 py-2 transition-colors group-hover:bg-secondary"));
 assert.ok(!src.includes('group-hover:bg-secondary px-3 py-2'));
 assert.ok(src.includes("border-[#99D5CF] bg-[#E6F6F3] text-[#0D9488]"));
 assert.ok(src.includes("border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]"));
 assert.ok(src.includes('className="group h-[56px]'));
});
