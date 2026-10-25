import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("Kanit is loaded exactly once for the entire app, including Thai and Latin text", () => {
  const html = source("index.html");
  const css = source("src/index.css");
  assert.match(html, /fonts\\.googleapis\\.com\\/css2\\?family=Kanit:wght@300;400;500;600;700/);
  assert.match(html, /display=swap/);
  assert.doesNotMatch(css, /IBM Plex Sans Thai|["']Inter["']|@import url\\(['"]https:\\/\\/fonts\\.googleapis/);
});

test("All Tailwind font utility families resolve to Kanit design tokens", () => {
  const css = source("src/index.css");
  const config = source("tailwind.config.js");
  for (const key of ["heading", "body", "display", "mono"])
    assert.match(css, new RegExp("--font-" + key + ': "Kanit"'));
  for (const key of ["sans", "serif", "heading", "body", "display", "mono"])
    assert.match(config, new RegExp(key + ": \\['var\\(--font-"));
});

test("Forms, dialogs, and headings use the global font and intentional weight hierarchy", () => {
  const css = source("src/index.css");
  assert.match(css, /html\\s*\\{[^}]*font-family: var\\(--font-body\\)/s);
  for (const el of ["button", "input", "textarea", "select", "option"])
    assert.match(css, new RegExp("\\b" + el + "\\b"));
  assert.match(css, /font-family: inherit/);
  assert.match(css, /h1, h2, h3, h4, h5, h6\\s*\\{[^}]*font-weight: 600/s);
  assert.match(css, /body\\s*\\{[^}]*font-weight: 400/s);
  assert.match(source("src/components/AuthLayout.jsx"), /text-3xl font-semibold/);
});
