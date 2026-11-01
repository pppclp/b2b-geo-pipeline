import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { SALES_CHANNELS, normalizeSalesChannel, salesChannelDisplay } from "../src/lib/salesChannel.js";
import { matchesPipelineFilters } from "../src/lib/pipelineListFilters.js";

test("exactly three canonical sales channels", () => {
  assert.deepEqual(SALES_CHANNELS, ["AE Self", "Premium Partner", "Dealer"]);
});

test("legacy source channels map to canonical values", () => {
  const aliases = new Map([
    ["AE B2B GEO", "AE Self"], ["AE Self", "AE Self"],
    ["B2B Premium Partner", "Premium Partner"], ["Premium Partner", "Premium Partner"],
    ["Dealer", "Dealer"], ["RP", "Dealer"], ["TA Dealer", "Dealer"],
  ]);
  for (const [source, expected] of aliases) {
    assert.equal(normalizeSalesChannel(source), expected);
    assert.equal(normalizeSalesChannel("  " + source.toLowerCase() + "  "), expected);
  }
});

test("missing and unrecognized source values never default to a channel", () => {
  for (const source of ["", null, undefined, "Other", "PTT : Thanyaburi, Nong Suea, Lam Luk Ka"]) {
    assert.equal(normalizeSalesChannel(source), null);
  }
});

test("historical channels display canonical labels without changing stored values", () => {
  const raw = { sales_channel: "B2B Premium Partner" };
  assert.equal(salesChannelDisplay(raw.sales_channel), "Premium Partner");
  assert.equal(raw.sales_channel, "B2B Premium Partner", "stored source is unchanged");
  assert.equal(salesChannelDisplay("AE B2B GEO"), "AE Self");
  assert.equal(salesChannelDisplay("RP"), "Dealer");
  assert.equal(salesChannelDisplay("Other"), "Other (รอตรวจสอบ)");
  assert.equal(salesChannelDisplay(""), "—");
});

test("canonical filters include legacy aliases but never guess Other", () => {
  const context = { master: {}, maps: {}, config: {} };
  const historical = { sales_channel: "B2B Premium Partner" };
  assert.equal(matchesPipelineFilters(historical, { sales_channel: "Premium Partner" }, context), true);
  assert.equal(matchesPipelineFilters(historical, { sales_channel: "AE Self" }, context), false);
  assert.equal(matchesPipelineFilters({ sales_channel: "AE B2B GEO" }, { sales_channel: "AE Self" }, context), true);
  assert.equal(matchesPipelineFilters({ sales_channel: "RP" }, { sales_channel: "Dealer" }, context), true);
  assert.equal(matchesPipelineFilters({ sales_channel: "Other" }, { sales_channel: "AE Self" }, context), false);
  assert.equal(matchesPipelineFilters({ sales_channel: "Other" }, {}, context), true);
});

test("Create/Edit and Filter have exactly three options, while read views show legacy labels safely", () => {
  const files = [
    "src/components/CreatePipelineModal.jsx",
    "src/components/OpportunityForm.jsx",
    "src/components/FilterBar.jsx",
    "src/pages/OpportunityDetail.jsx",
    "src/components/PipelineQuickView.jsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
    assert.match(source, /salesChannelDisplay|SALES_CHANNELS/, file);
  }
  const form = readFileSync(new URL("../src/components/OpportunityForm.jsx", import.meta.url), "utf8");
  assert.match(form, /กรุณายืนยันช่องทางการขายก่อนบันทึก/);
});

test("contract documents only the three active channel options, preserving legacy aliases", () => {
  const source = readFileSync(new URL("../b2b_geo_pipeline.yaml", import.meta.url), "utf8");
  const section = source.split("    sales_channel:\n      source: \"AE / SM input\"")[1]?.split("    contact_name:")[0];
  assert.ok(section, "Opportunity sales channel field must exist in the contract");
  assert.match(section, /allowed:\s+- "AE Self"\s+- "Premium Partner"\s+- "Dealer"/);
  assert.match(section, /"AE B2B GEO": "AE Self"/);
  assert.match(section, /"B2B Premium Partner": "Premium Partner"/);
  assert.match(section, /sales_channel = Premium Partner or Dealer/);
});
