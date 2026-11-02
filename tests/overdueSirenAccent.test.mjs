import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src=(name)=>readFileSync(new URL("../src/"+name,import.meta.url),"utf8");
const page=src("pages/Pipeline.jsx");
const tags=src("components/OverdueTags.jsx");

test("Overdue tabs stay clean; every distinct record alert carries ⚠",()=>{
  assert.ok(page.includes('id: "stage-overdue"'));
  assert.ok(page.includes('icon: null'));
  assert.ok(!page.includes("🚨") && !page.includes("⚠"),"no emoji in desktop/mobile work-view tabs");
  assert.ok(!page.includes("item.urgent") && !page.includes("item.emoji"),"no special urgent coloring or emoji in work tabs");
  assert.ok(page.includes("{Icon && <Icon"),"mobile ordinary tab icons remain; Overdue has none");
  assert.ok((tags.match(/⚠/gu)||[]).length >= 4,"each alert type has its own warning");
  assert.ok(!tags.includes("🚨"));
  assert.ok(!tags.includes("Stage Aging ·"),"Stage Aging is informational, not an alert");
  assert.ok(tags.includes("⚠ Stage SLA"));
  assert.ok(tags.includes("AE Aging"));
  assert.ok(tags.includes("SM Aging"));
  assert.ok(tags.includes("⚠ With "));
  assert.ok(tags.includes("⚠ Task Overdue"));
});

test("Overdue work tab matches the other tabs; alert tags use solid red",()=>{
  assert.ok(page.includes('className="text-xl font-semibold leading-none tabular-nums"'));
  assert.ok(page.includes('className={`tabular-nums ${active ? "font-semibold text-red-600" : "font-medium text-muted-foreground"}`}'));
  assert.ok(page.includes('border-red-500 font-semibold text-foreground'));
  assert.ok(!page.includes("text-red-700") || !page.includes("item.urgent"));
  assert.ok(tags.includes('bg-[#C83F40] px-1.5 py-0.5 font-medium text-white'));
});

test("Approved pastel Won/Lost stay separate from Stage and solid-red Overdue tags",()=>{
  const detail=src("pages/OpportunityDetail.jsx");
  const close=src("components/PipelineCloseActions.jsx");
  assert.ok(page.includes('lost: "border-transparent bg-[#F3C4C4] text-[#9A3340]"'));
  assert.ok(detail.includes('lost: "bg-[#F3C4C4] text-[#9A3340] border border-transparent"'));
  assert.ok(close.includes('border-transparent bg-[#F3C4C4] text-[#9A3340] hover:bg-[#ECAFAF] hover:text-[#9A3340]'));
  assert.ok(page.includes('won: "border-transparent bg-[#AFE0C2] text-[#166534]"'));
  assert.ok(detail.includes('won: "bg-[#AFE0C2] text-[#166534] border border-transparent"'));
  assert.ok(close.includes('border-transparent bg-[#AFE0C2] text-[#166534] hover:bg-[#96D5B0] hover:text-[#166534]'));
  assert.ok(close.includes('bg-[#F3C4C4] text-[#9A3340] hover:bg-[#ECAFAF]'));
  assert.ok(close.includes('bg-[#AFE0C2] text-[#166534] hover:bg-[#96D5B0]'));
});

test("Original work views, actions, stage review, and calculations stay intact",()=>{
  for(const label of ["All Open","With Me","Overdue","Due This Month","สร้าง Pipeline","Export Excel","Quick filter by Stage"])assert.ok(page.includes(label),label);
  assert.ok(page.includes('selectQuickView(item.id)'));
  assert.ok(page.includes('workCounts["stage-overdue"]'));
  assert.ok(page.includes('navigate("/review-queue?tab=stage")'));
  assert.ok(src("lib/overdueSummary.js").includes('Boolean(stageSla || handler || workingWithTeams.length || overdueTasks.length)'));
});
