import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Dashboard keeps metric labels in an established language hierarchy without new explanations", () => {
  const page = read("src/pages/Dashboard.jsx");
  assert.match(page, /<Metric title="มูลค่างานที่คาดว่าจะปิด"/);
  assert.match(page, /value=\{formatTHB\(closeValue\)\} note="Net RC"/);
  assert.match(page, /<Metric title="With Me"/);
  assert.match(page, /<Metric title=\{isManagement \? "Overdue" : "Overdue With Me"\}/);
  assert.match(page, /WORK_VIEW_SUBTITLES\.overdue/);
  assert.match(page, /WORK_VIEW_SUBTITLES\.with/);
  assert.match(page, /geo-metric-card/g);
  assert.match(page, /geo-metric-label/);
  assert.match(page, /geo-metric-value/);
  assert.match(page, /geo-metric-note/);
  assert.doesNotMatch(page, /Management overview|Regional overview|My overview/);
});

test("Visual copy removed without changing region/role/finance calculations", () => {
  const page = read("src/pages/Dashboard.jsx");
  assert.doesNotMatch(page, /All Expected Close Months|Selected Expected Close Month/);
  assert.doesNotMatch(page, /Metrics use the intersection of Created Month/);
  assert.doesNotMatch(page, /Current Handler assignments and Pipelines involving/);
  assert.doesNotMatch(page, /meta="Open · Net RC"/);
  assert.match(page, /const closeValue = sumValue\(won\) \+ sumValue\(open\);/);
  assert.match(page, /const openValue = sumValue\(open\);/);
  assert.match(page, /<RegionQuickFilter/);
  assert.match(page, /<PageHeader\s+title="Dashboard"/);
  assert.match(page, /<CloseStrip won=\{won\} open=\{open\} closeValue=\{closeValue\}/);
});

test("Metric cards align their three levels without changing font family or calculations", () => {
  const css = read("src/index.css");
  assert.match(css, /\.geo-metric-card\s*\{/);
  assert.match(css, /grid-template-rows: minmax\(56px, auto\) minmax\(32px, auto\) minmax\(30px, auto\)/);
  assert.match(css, /sm:items-start/);
  assert.match(css, /Inter:wght@100\.\.900/);
  assert.match(css, /font-family: "LINE Seed Sans TH"/);
});
