import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = path => fs.readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("Only one current release runbook; obsolete ticket migration instructions cannot be run",()=>{
  const runbook=src("docs/RELEASE_RUNBOOK.md");
  for(const old of ["docs/PHASE4_UAT_RELEASE_RUNBOOK.md","docs/UAT_RELEASE_GATES.md"]) {
    const s=src(old);
    assert.match(s,/Superseded/);
    assert.match(s,/RELEASE_RUNBOOK.md/);
    assert.doesNotMatch(s,/run \x60backfillGeoPhase4SupportFlags\(\)\x60 once/);
  }
  assert.match(runbook,/FINANCIAL_FIELD_SIGNOFF/);
  assert.match(runbook,/SYSTEM_MONTH_END/);
});
test("Public source does not hardcode a canonical Spreadsheet ID or deploy old Code.gs files",()=>{
  const main=src("apps-script/Main.js");
  assert.match(main,/GEO_APPROVED_PIPELINE_DB_ID/);
  assert.doesNotMatch(main,/var expectedId=["'][A-Za-z0-9_-]{25,}["']/);
  assert.equal(fs.existsSync(new URL("../releases/uat-login-2026-10-25/Code.gs",import.meta.url)),false);
  assert.equal(fs.existsSync(new URL("../releases/support-toggle-2026-10-25/Code.gs",import.meta.url)),false);
  assert.doesNotMatch(src("docs/RELEASE_RUNBOOK.md"),/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{25,}/);
});
test("Pages releases gate backend-changing updates and auto-publish UI-only changes",()=>{
  const yaml=src(".github/workflows/deploy-pages.yml");
  assert.match(yaml,/workflow_dispatch/);
  assert.match(yaml,/backend_verified/);
  assert.match(yaml,/branches: \[main\]/);
  assert.match(yaml,/scripts\/pages-release-gate\.mjs/);
  assert.match(yaml,/needs\.preflight\.outputs\.release_allowed == 'true'/);
  assert.match(yaml,/node --test tests\/\*\.test\.mjs/);
});
