import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Kanit is loaded once as the app font for English, Thai, and numbers", () => {
  const html = source("index.html");
  const css = source("src/index.css");
  assert.ok(html.includes("family=Kanit:wght@300;400;500;600;700"));
  assert.ok(html.includes("display=swap"));
  assert.ok(!css.includes("IBM Plex Sans Thai"));
  assert.ok(!css.includes('"Inter"'));
  assert.ok(!css.includes("@import url("));
});

test("Every Tailwind font family uses the Kanit typography tokens", () => {
  const css = source("src/index.css");
  const config = source("tailwind.config.js");
  for (const key of ["heading", "body", "display", "mono"])
    assert.ok(css.includes('--font-' + key + ': "Kanit"'), key);
  for (const key of ["sans", "serif", "heading", "body", "display", "mono"])
    assert.ok(config.includes(key + ": ['var(--font-"), key);
});

test("Kanit covers forms, portals, headings and sensible weights", () => {
  const css = source("src/index.css");
  assert.ok(css.includes("html {"));
  assert.ok(css.includes("font-family: var(--font-body)"));
  for (const element of ["button", "input", "textarea", "select", "option"])
    assert.ok(css.includes(element), element);
  assert.ok(css.includes("font-family: inherit"));
  assert.ok(css.includes("h1, h2, h3, h4, h5, h6"));
  assert.ok(css.includes("font-weight: 400"));
  assert.ok(css.includes("font-weight: 600"));
  assert.ok(source("src/components/AuthLayout.jsx").includes("text-3xl font-semibold"));
});
