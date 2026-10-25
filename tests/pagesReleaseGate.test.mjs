import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assessChanges, isUiOnlyChange } from "../scripts/pages-release-gate.mjs";

test("Safe, isolated styling and quick view changes can be automatically published", () => {
  const safe = [
    "src/index.css",
    "index.html",
    "tailwind.config.js",
    "public/true-logo.svg",
    "src/pages/Dashboard.jsx",
    "src/pages/Pipeline.jsx",
    "src/components/AppLayout.jsx",
    "src/components/ui/button.jsx",
    "src/lib/pipelineListFilters.js",
    "tests/pagesReleaseGate.test.mjs",
  ];
  assert.ok(safe.every(isUiOnlyChange));
  assert.equal(assessChanges(safe).eligible, true);
});

test("Any backend, API, security, config, workflow or unknown file forces manual release", () => {
  const risky = [
    "server/core.js",
    "server/api.js",
    "apps-script/Main.js",
    "src/api/client.js",
    "src/lib/apiContract.js",
    "src/lib/dataContext.jsx",
    "src/lib/AuthContext.jsx",
    "src/components/OpportunityForm.jsx",
    "b2b_geo_pipeline.yaml",
    "package.json",
    "scripts/gas-build.mjs",
    ".github/workflows/deploy-pages.yml",
    "new-unspecified-file.ts",
  ];
  for (const file of risky) {
    assert.equal(isUiOnlyChange(file), false, file);
    assert.deepEqual(assessChanges(["src/index.css", file]).blocked, [file]);
    assert.equal(assessChanges(["src/index.css", file]).eligible, false);
  }
  assert.equal(assessChanges([]).eligible, false);
});

test("Pages workflow runs CI automatically and requires an explicit verification for backend changes", () => {
  const workflow = fs.readFileSync(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8");
  assert.ok(workflow.includes("  push:"), "Auto-update must be enabled for safe UI changes");
  assert.ok(workflow.includes("  workflow_dispatch:"), "Coordinated manual backend release remains supported");
  assert.ok(workflow.includes("backend_verified:"));
  assert.ok(workflow.includes("scripts/pages-release-gate.mjs"));
  assert.ok(workflow.includes("fetch-depth: 0"), "Gate needs successful published base SHA history");
  assert.ok(workflow.includes("needs.preflight.outputs.release_allowed == 'true'"));
  assert.ok(workflow.includes("npm run lint"));
  assert.ok(workflow.includes("node --test tests/*.test.mjs"));
  assert.ok(workflow.includes("npm run build"));
});
