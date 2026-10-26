import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("original Inter + IBM Plex Sans Thai fonts are restored across the application", () => {
  const css = source("src/index.css");
  const html = source("index.html");
  assert.ok(css.includes("family=IBM+Plex+Sans+Thai:wght@400;500;600&family=Inter:wght@400;500;600;700"));
  assert.ok(css.includes('font-heading: "Inter", "IBM Plex Sans Thai"'));
  assert.ok(css.includes('font-body: "Inter", "IBM Plex Sans Thai"'));
  assert.ok(css.includes('font-display: "Inter", "IBM Plex Sans Thai"'));
  assert.ok(!css.includes('"Kanit"'));
  assert.ok(!html.includes("family=Kanit"));
});

test("original font weights and Tailwind configuration are preserved", () => {
  const css = source("src/index.css");
  const config = source("tailwind.config.js");
  const authLayout = source("src/components/AuthLayout.jsx");
  for (const key of ["heading", "body", "display", "mono"])
    assert.ok(config.includes(key + ": ['var(--font-" + key + ")']"), key);
  assert.ok(config.includes("fontFamily"));
  assert.ok(css.includes("@apply bg-shell text-foreground font-body antialiased"));
  assert.ok(authLayout.includes("text-3xl font-bold"));
});
