import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("retired Needs Support is absent from visible Pipeline and management surfaces", () => {
  for (const path of [
    "src/pages/Dashboard.jsx", "src/pages/Pipeline.jsx",
    "src/pages/OpportunityDetail.jsx", "src/components/PipelineQuickView.jsx",
    "src/components/OpportunityForm.jsx", "src/components/PipelineCard.jsx",
    "src/components/FilterBar.jsx", "src/pages/Admin.jsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /Needs Support|SupportToggleAction|support_needed|support_type|support_note/, path);
  }
  assert.equal(existsSync(new URL("../src/components/SupportToggleAction.jsx", import.meta.url)), false);
});

test("retired Support cannot be enabled by a legacy filter or exported by the current UI", () => {
  assert.doesNotMatch(read("src/lib/pipelineFilterUi.js"), /support:/);
  assert.doesNotMatch(read("src/lib/pipelineListFilters.js"), /support-needed|f\\.support|filters\\.support/);
  assert.doesNotMatch(read("src/lib/pipelineExport.js"), /Support Needed|Support Type|Support Note|o\\.support_needed/);
  assert.doesNotMatch(read("src/pages/Import.jsx"), /key: "support_needed"|key: "support_type"|key: "support_note"/);
});

test("retired backend write guard preserves legacy audit schema and blocks further changes", () => {
  const code = read("server/core.js");
  assert.match(code, /function rejectRetiredSupportPayload\\(uiEntity, data\\)/);
  assert.match(code, /Needs Support has been retired/);
  assert.match(code, /Retired UAT feature/);
  assert.match(code, /Support feature has been retired/);
  assert.match(code, /support_type_id/);
});
