import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WORK_VIEW_SUBTITLES, selectedCloseMonthSubtitle } from "../src/lib/uiCopy.js";
const file = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("approved UAT work view copy is shared", () => {
  assert.equal(WORK_VIEW_SUBTITLES.with, "งานที่ส่งให้ฉัน");
  assert.equal(WORK_VIEW_SUBTITLES.support, undefined);
  assert.equal(WORK_VIEW_SUBTITLES.overdue, "งานเกินกำหนด");
  assert.equal(WORK_VIEW_SUBTITLES.due, "งานที่คาดว่าจะปิดเดือนนี้");
  assert.equal(selectedCloseMonthSubtitle, "งานที่คาดว่าจะปิดเดือนที่เลือก");
  for (const path of ["src/pages/Dashboard.jsx", "src/pages/Pipeline.jsx"]) {
    assert.ok(file(path).includes('from "@/lib/uiCopy"'));
  }
});

test("Dashboard cards use approved Thai headings and Net RC", () => {
  const source = file("src/pages/Dashboard.jsx");
  assert.ok(source.includes('title="มูลค่างานที่คาดว่าจะปิด"'));
  assert.ok(source.includes('"มูลค่างานที่ยังเปิดอยู่ของฉัน"'));
  assert.ok(source.includes('note="Net RC"'));
  assert.ok(source.includes('"งานที่ต้องดำเนินการ"'));
});

test("navigation and form data keys remain stable after label translation", () => {
  const nav = file("src/components/AppLayout.jsx");
  assert.ok(nav.includes('to: "/pipeline?view=assigned-to-me", label: "With Me"'));
  const form = file("src/components/CreatePipelineModal.jsx");
  assert.ok(form.includes('set("expected_close_month", v)'));
  assert.ok(form.includes('set("business_id",'));
});
