import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("all roles share a compact, single-line Pipeline table header", () => {
  const src = read("src/pages/Pipeline.jsx");
  const header = src.match(/<thead className="bg-secondary\/50[^]*?<\/thead>/)?.[0];
  assert.ok(header, "Pipeline table header exists");
  assert.ok(header.includes('<tr className="h-10">'), "40px table header");
  assert.ok(header.includes("py-1.5"), "compact header cell padding");
  assert.ok(header.includes("leading-4 whitespace-nowrap"), "consistent single-line labels");
  assert.ok(header.includes(">Pipeline</th>"), "user-facing Pipeline terminology");
  assert.ok(!header.includes(">Opportunity</th>"));
  assert.ok(src.includes('className="group h-[64px]'), "compact rows still allow two-line handling");
});

test("user supplied True logo is used on app shell and sign-in, not a placeholder", () => {
  const logo = read("public/true-logo.svg");
  const layout = read("src/components/AppLayout.jsx");
  const auth = read("src/components/AuthLayout.jsx");
  assert.ok(logo.includes('fill="#ec2127"'));
  assert.ok(logo.includes('viewBox="0 0 1725 626"'));
  assert.ok(layout.includes("true-logo.svg?v=20261025"));
  assert.ok(auth.includes("true-logo.svg?v=20261025"));
});

test("Vite GH Pages favicon uses original True logo mark and deployment base URL", () => {
  const html = read("index.html");
  const favicon = read("public/favicon.svg");
  assert.ok(html.includes('href="%BASE_URL%favicon.svg?v=20261025"'));
  assert.ok(favicon.includes('viewBox="-12 -10 406 640"'));
  assert.ok(favicon.includes('fill="#ec2127"'));
  assert.ok(!favicon.includes("data:image"));
});
