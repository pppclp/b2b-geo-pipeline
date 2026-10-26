import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/components/AppLayout.jsx", import.meta.url), "utf8");
test("mobile menu exposes labelled dialog and trigger semantics", () => {
  assert.match(source, /role="dialog" aria-modal="true" aria-label="Mobile navigation"/);
  assert.match(source, /aria-expanded=\{open\} aria-controls="mobile-navigation"/);
  assert.match(source, /aria-label="Close navigation"/);
});
test("mobile menu provides escape, tab trap, inert background and focus restoration", () => {
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /mobileCloseRef\.current\?\.focus\(\)/);
  assert.match(source, /previouslyFocused\.focus\(\)/);
  assert.match(source, /inert=\{open \? "" : undefined\}/);
});
