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
  // The Pipeline page still uses the approved shared UAT copy.
  assert.ok(file("src/pages/Pipeline.jsx").includes('from "@/lib/uiCopy"'));
  // Dashboard intentionally names records Pipeline instead of งาน.
  const dashboard = file("src/pages/Dashboard.jsx");
  assert.ok(dashboard.includes("DASHBOARD_VIEW_SUBTITLES"));
  assert.ok(dashboard.includes('with: "Pipeline ที่ส่งให้ฉัน"'));
  assert.ok(dashboard.includes('overdue: "Pipeline เกินกำหนด"'));
});

test("Dashboard cards keep concise Thai business headings and accurate Open + Won value context", () => {
  const source = file("src/pages/Dashboard.jsx");
  assert.ok(source.includes('title="มูลค่า Pipeline รวม"'));
  assert.ok(source.includes('note="Net RC · Open + Won"'));
  assert.ok(source.includes('fontSize: "13px"'));
  assert.ok(source.includes('meta={queue.length + " Pipelines"}'));
  assert.ok(source.includes('>สถานะ Pipeline</div>'));
  assert.ok(!source.includes('title="มูลค่างานรวม"'));
  assert.ok(!source.includes('>สถานะงาน</div>'));
  assert.ok(source.includes('title="มูลค่า Pipeline ที่เปิดอยู่"'));
  assert.ok(source.includes('"Net RC · ของฉัน"'));
  assert.ok(source.includes('"Net RC · ในภาค"'));
  const css = file("src/index.css");
  assert.ok(css.includes('font-size: clamp(22px, 1.9vw, 26px);'));
  assert.ok(!source.includes('subtitle="Open Pipeline Value"'));
  assert.ok(source.includes('title="Pipeline ที่ส่งให้ฉัน"'));
  assert.ok(source.includes('title="Pipeline เกินกำหนด"'));
  assert.ok(source.includes('note="ต้องติดตาม"'));
  assert.ok(source.includes('note="Net RC"'));
  assert.ok(source.includes('"Pipeline ที่ต้องดำเนินการ"'));
  assert.ok(!source.includes('"งานที่ส่งให้ฉัน"'));
  assert.ok(!source.includes('"งานเกินกำหนด"'));
  assert.ok(source.includes('DASHBOARD_VIEW_SUBTITLES'));
});

test("navigation and form data keys remain stable after label translation", () => {
  const nav = file("src/components/AppLayout.jsx");
  assert.ok(nav.includes('to: "/pipeline?view=assigned-to-me", label: "With Me"'));
  const form = file("src/components/CreatePipelineModal.jsx");
  assert.ok(form.includes('set("expected_close_month", v)'));
  assert.ok(form.includes('set("business_id",'));
});
