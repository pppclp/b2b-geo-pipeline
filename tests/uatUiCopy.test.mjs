import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WORK_VIEW_SUBTITLES, selectedCloseMonthSubtitle } from "../src/lib/uiCopy.js";
const file = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("UAT work views have the approved Thai subtitles", () => {
  assert.deepEqual(WORK_VIEW_SUBTITLES, {
    all: "งานที่ยังเปิดอยู่",
    with: "งานที่ส่งให้ฉัน",
    support: "งานที่ต้องการความช่วยเหลือ",
    overdue: "งานเกินกำหนด",
    due: "งานที่คาดว่าจะปิดเดือนนี้",
  });
  assert.equal(selectedCloseMonthSubtitle, "งานที่คาดว่าจะปิดเดือนที่เลือก");
});

test("Dashboard and Pipeline use the same presentation copy", () => {
  for (const p of ["src/pages/Dashboard.jsx", "src/pages/Pipeline.jsx"]) {
    assert.match(file(p), /from "@\\/lib\\/uiCopy"/);
  }
  const dashboard = file("src/pages/Dashboard.jsx");
  assert.match(dashboard, /title="มูลค่างานที่คาดว่าจะปิด"[^\\n]*note="Net RC"/);
  assert.match(dashboard, /"มูลค่างานที่ยังเปิดอยู่ของฉัน"/);
  assert.match(dashboard, /"งานที่ต้องดำเนินการ"/);
  assert.match(dashboard, /WORK_VIEW_SUBTITLES\\[id\\]/);
  const pipeline = file("src/pages/Pipeline.jsx");
  assert.match(pipeline, /subtitle: WORK_VIEW_SUBTITLES\\.with/);
  assert.match(pipeline, /subtitle: WORK_VIEW_SUBTITLES\\.support/);
  assert.match(pipeline, /subtitle: WORK_VIEW_SUBTITLES\\.overdue/);
});

test("UI label changes do not rename page URLs or backend ID fields", () => {
  const nav = file("src/components/AppLayout.jsx");
  assert.match(nav, /to: "\\/pipeline\\?view=assigned-to-me", label: "With Me"/);
  const form = file("src/components/CreatePipelineModal.jsx");
  assert.match(form, /onChange=\\{\\(v\\) => set\\("expected_close_month", v\\)\\}/);
  assert.match(form, /set\\("business_id",/);
});
