import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("LINE Seed Sans TH is used for Thai while English uses Inter Variable", () => {
  const css = source("src/index.css");
  const html = source("index.html");
  assert.ok(css.includes("family=Inter:wght@100..900&display=swap"));
  assert.ok(css.includes('font-family: "LINE Seed Sans TH"'));
  for (const font of ["LINESeedSansTH-Regular.woff2", "LINESeedSansTH-Bold.woff2"]) {
    assert.ok(css.includes(font), font);
  }
  assert.ok(css.includes("thai-web-fonts@7"), "Font CDN must be version pinned");
  assert.ok(css.includes("unicode-range: U+0E00-0E7F"), "Latin must continue using Inter");
  assert.ok(css.includes("size-adjust: 103%"), "Slight Thai optical size adjustment");
  assert.ok(css.includes("font-optical-sizing: auto"), "Variable Inter uses optical sizing");
  assert.ok(css.includes("font-weight: 400 500"), "Thai labels map to native Regular");
  assert.ok(css.includes("font-weight: 600 900"), "Thai headings map to native Bold");
  for (const key of ["heading", "body", "display"]) {
    assert.ok(css.includes('--font-' + key + ': "Inter", "LINE Seed Sans TH"'));
  }
  assert.ok(!css.includes('"IBM Plex Sans Thai"'));
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
