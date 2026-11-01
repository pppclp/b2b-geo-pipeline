import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src=(name)=>readFileSync(new URL("../src/"+name,import.meta.url),"utf8");
const page=src("pages/Pipeline.jsx");
const tags=src("components/OverdueTags.jsx");

test("Overdue tabs have no emoji; only the record warning tag contains ⚠",()=>{
  assert.ok(page.includes('id: "stage-overdue"'));
  assert.ok(page.includes('icon: null'));
  assert.ok(!page.includes("🚨") && !page.includes("⚠"),"no emoji in desktop/mobile work-view tabs");
  assert.ok(!page.includes("item.urgent") && !page.includes("item.emoji"),"no special urgent coloring or emoji in work tabs");
  assert.ok(page.includes("{Icon && <Icon"),"mobile ordinary tab icons remain; Overdue has none");
  assert.equal((tags.match(/⚠/gu)||[]).length,1,"single warning glyph source exclusively inside OverdueTags");
  assert.ok(!tags.includes("🚨"));
  assert.ok(tags.includes('const warning = <span aria-hidden="true"'));
  assert.ok(tags.includes('{warning} Stage Aging'));
  assert.ok(tags.includes('{!reasons.stageAging && warning} Stage SLA'));
  assert.ok(tags.includes('{!reasons.stageAging && !reasons.stageSla && warning} Task Overdue'));
});

test("Overdue work tab matches the other tabs; alert tags remain red",()=>{
  assert.ok(page.includes('className="text-xl font-semibold leading-none tabular-nums"'));
  assert.ok(page.includes('className={`tabular-nums ${active ? "font-semibold text-red-600" : "font-medium"}`}'));
  assert.ok(page.includes('border-red-500 font-semibold text-foreground'));
  assert.ok(!page.includes("text-red-700") || !page.includes("item.urgent"));
  assert.ok(tags.includes('bg-red-50 px-1.5 py-0.5 font-medium text-red-700'));
});

test("Lost cocoa and Won emerald stay independent from Stage and alerts",()=>{
  const detail=src("pages/OpportunityDetail.jsx");
  const close=src("components/PipelineCloseActions.jsx");
  assert.ok(page.includes('lost: "border-[#D4C5BE] bg-[#EDE6E2] text-[#675149]"'));
  assert.ok(detail.includes('lost: "bg-[#EDE6E2] text-[#675149] border border-[#D4C5BE]"'));
  assert.ok(close.includes('border-[#D4C5BE] text-[#675149] hover:bg-[#EDE6E2]'));
  assert.ok(page.includes('won: "border-emerald-100 bg-emerald-50 text-emerald-800"'));
});

test("Original work views, actions, stage review, and calculations stay intact",()=>{
  for(const label of ["All Open","With Me","Overdue","Due This Month","สร้าง Pipeline","Export Excel","Quick filter by Stage"])assert.ok(page.includes(label),label);
  assert.ok(page.includes('selectQuickView(item.id)'));
  assert.ok(page.includes('workCounts["stage-overdue"]'));
  assert.ok(page.includes('navigate("/review-queue?tab=stage")'));
  assert.ok(src("lib/overdueSummary.js").includes('stageAging || stageSla || overdueTasks.length > 0'));
});
