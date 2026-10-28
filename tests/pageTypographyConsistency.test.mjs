import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Dashboard and Pipeline reuse the same aligned heading and page padding", () => {
  const dashboard = read("src/pages/Dashboard.jsx");
  const pipeline = read("src/pages/Pipeline.jsx");
  const shared = read("src/components/PageHeader.jsx");

  assert.match(shared, /geo-page-header/);
  assert.match(shared, /geo-page-title/);
  assert.match(shared, /geo-page-description/);
  for (const source of [dashboard, pipeline]) {
    assert.match(source, /import PageHeader from "@\/components\/PageHeader"/);
    assert.match(source, /className="geo-page"/);
    assert.match(source, /<PageHeader/);
    assert.doesNotMatch(source, /p-5 md:p-7 max-w-\[1400px\]/);
  }
  assert.match(dashboard, /title="Dashboard"/);
  assert.match(pipeline, /title="Pipeline"/);
  assert.doesNotMatch(dashboard, /"Management Dashboard"/);
  assert.doesNotMatch(pipeline, /md:text-xl">Pipeline<\/h1>/);
});

test("Visual hierarchy remains intentional without changing access or calculations", () => {
  const css = read("src/index.css");
  const dashboard = read("src/pages/Dashboard.jsx");
  const pipeline = read("src/pages/Pipeline.jsx");
  const filters = read("src/components/FilterBar.jsx");
  const layout = read("src/components/AppLayout.jsx");

  for (const token of ["geo-page", "geo-page-title", "geo-page-description",
    "geo-filter-label", "geo-panel-title", "geo-metric-label", "geo-metric-value", "geo-metric-note"]) {
    assert.ok(css.includes("." + token), token);
  }
  assert.match(css, /font-size: 24px/);
  assert.match(css, /font-size: 22px/);
  assert.match(css, /font-size: clamp\(20px, 2vw, 26px\)/);
  assert.match(dashboard, /geo-metric-label/);
  assert.match(dashboard, /geo-metric-value/);
  assert.match(dashboard, /geo-panel-title/);
  assert.match(filters, /geo-filter-label/);
  assert.match(layout, /text-\[13px\] font-medium transition-colors/);
  assert.match(pipeline, /aria-label="Pipeline records table"/);
});

test("Thai and Latin display use separate deliberate font faces", () => {
  const css = read("src/index.css");
  assert.match(css, /Inter:wght@100\.\.900/);
  assert.match(css, /font-family: "LINE Seed Sans TH"/);
  assert.match(css, /unicode-range: U\+0E00-0E7F/);
  assert.match(css, /--font-heading: "Inter", "LINE Seed Sans TH"/);
  assert.match(css, /--font-body: "Inter", "LINE Seed Sans TH"/);
  assert.match(css, /--font-display: "Inter", "LINE Seed Sans TH"/);
});
