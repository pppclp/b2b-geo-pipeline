import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pipeline = readFileSync(new URL("../src/pages/Pipeline.jsx", import.meta.url), "utf8");
const filterBar = readFileSync(new URL("../src/components/FilterBar.jsx", import.meta.url), "utf8");

test("mobile work views display four cards in balanced two-column rows", () => {
  assert.match(pipeline, /grid grid-cols-2 gap-2[^"]*md:hidden/);
  assert.doesNotMatch(pipeline, /index < 3/);
  assert.match(pipeline, /onClick=\{\(\) => selectQuickView\(item.id\)\}/);
  assert.match(pipeline, /aria-pressed=\{active\}/);
  assert.match(pipeline, /hidden border-b border-border\/70 pb-2 md:block/);
});

test("mobile filter layout uses two columns without changing data filters", () => {
  assert.match(filterBar, /grid min-w-0 grid-cols-2 items-end gap-x-2\.5 gap-y-3 md:flex/);
  assert.match(filterBar, /col-span-2 min-w-0 space-y-1 md:w-\[250px\]/);
  assert.match(filterBar, /More Filters/);
  assert.match(filterBar, /Active Filters/);
  assert.match(filterBar, /Remove \$\{LABELS\[key\]\} filter/);
});

test("mobile list cards preserve sort, quick open, full values, alerts, and desktop table", () => {
  assert.match(pipeline, /space-y-2\.5 md:hidden/);
  assert.match(pipeline, /rounded-2xl border border-border bg-card px-3\.5 py-4/);
  assert.match(pipeline, /onClick=\{\(\) => openQuickView\(o.id\)\}/);
  assert.match(pipeline, /formatTHB\(o.pipeline_value\)/);
  assert.match(pipeline, /formatMonth\(o.expected_close_month\)/);
  assert.doesNotMatch(pipeline, /Needs Support/);
  assert.match(pipeline, /hidden overflow-x-auto md:block/);
  assert.match(pipeline, /sorted\.map\(\(o\) =>/);
  assert.match(pipeline, /Quick filter by Stage/);
});
