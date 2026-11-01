import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src=(name)=>readFileSync(new URL("../src/"+name,import.meta.url),"utf8");
const page=src("pages/Pipeline.jsx");

test("Only Overdue work view owns the unique urgent emoji",()=>{
  assert.equal((page.match(/🚨/gu)||[]).length,1,"one central emoji literal, not repeated in tags");
  assert.match(page, /id: "stage-overdue"[^\n]*emoji: "🚨"/u);
  assert.equal((page.match(/item\.emoji/g)||[]).length>=4,true,"mobile and desktop share emoji metadata");
  const prefix=page.slice(page.indexOf('const quickViews = ['),page.indexOf('const activeQuickView'));
  assert.equal((prefix.match(/emoji:/g)||[]).length,1);
  assert.ok(!src("components/OverdueTags.jsx").includes("🚨"),"no duplicates in row alert chips");
});

test("Overdue remains urgent red when not selected, on both desktop and mobile",()=>{
  assert.ok(page.includes('bg-red-50/50 text-red-700 hover:bg-red-50'),"mobile inactive overdue red");
  assert.ok(page.includes('border-transparent font-medium text-red-700 hover:border-red-200'),"desktop inactive overdue red");
  assert.ok(page.includes('border-red-600 font-semibold text-red-700'),"desktop active overdue red");
  assert.ok(page.includes('font-semibold text-red-700'),"overdue counts red");
  assert.ok(page.includes('item.emoji && <span aria-hidden="true"'),"emoji decorative for screenreaders");
});

test("Lost is distinct cocoa in list, details, and close action while Won stays green",()=>{
  const detail=src("pages/OpportunityDetail.jsx");
  const close=src("components/PipelineCloseActions.jsx");
  assert.ok(page.includes('lost: "border-[#D4C5BE] bg-[#EDE6E2] text-[#675149]"'));
  assert.ok(detail.includes('lost: "bg-[#EDE6E2] text-[#675149] border border-[#D4C5BE]"'));
  assert.ok(close.includes('border-[#D4C5BE] text-[#675149] hover:bg-[#EDE6E2]'));
  assert.ok(close.includes('bg-[#675149] text-white hover:bg-[#56423A]'));
  assert.ok(page.includes('won: "border-emerald-100 bg-emerald-50 text-emerald-800"'));
});

test("Prior work views, actions and stage semantics survive visual-only edit",()=>{
 for(const label of ["All Open","With Me","Overdue","Due This Month","สร้าง Pipeline","Export Excel","Review Queue","Quick filter by Stage"])
   assert.ok(page.includes(label),label);
 assert.ok(page.includes('selectQuickView(item.id)'));
 assert.ok(page.includes('workCounts["stage-overdue"]'));
});
