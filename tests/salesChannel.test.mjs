import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { SALES_CHANNELS, normalizeSalesChannel, salesChannelDisplay } from "../src/lib/salesChannel.js";
import { matchesPipelineFilters } from "../src/lib/pipelineListFilters.js";

test("exactly three canonical sales channels", () => {
  assert.deepEqual(SALES_CHANNELS, ["AE Self", "Premium Partner", "Retail Partner"]);
});

test("legacy source channels map to canonical values", () => {
  const aliases = new Map([
    ["AE B2B GEO", "AE Self"], ["AE Self", "AE Self"],
    ["B2B Premium Partner", "Premium Partner"], ["Premium Partner", "Premium Partner"],
    ["Retail Partner", "Retail Partner"], ["Dealer", "Retail Partner"], ["RP", "Retail Partner"], ["TA Dealer", "Retail Partner"],
    ["True Agent Dealer", "Retail Partner"], ["True Partner", "Retail Partner"],
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
  assert.equal(salesChannelDisplay("RP"), "Retail Partner");
  assert.equal(salesChannelDisplay("Other"), "Other (รอตรวจสอบ)");
  assert.equal(salesChannelDisplay(""), "—");
});

test("canonical filters include legacy aliases but never guess Other", () => {
  const context = { master: {}, maps: {}, config: {} };
  const historical = { sales_channel: "B2B Premium Partner" };
  assert.equal(matchesPipelineFilters(historical, { sales_channel: "Premium Partner" }, context), true);
  assert.equal(matchesPipelineFilters(historical, { sales_channel: "AE Self" }, context), false);
  assert.equal(matchesPipelineFilters({ sales_channel: "AE B2B GEO" }, { sales_channel: "AE Self" }, context), true);
  assert.equal(matchesPipelineFilters({ sales_channel: "RP" }, { sales_channel: "Retail Partner" }, context), true);
  assert.equal(matchesPipelineFilters({ sales_channel: "Other" }, { sales_channel: "AE Self" }, context), false);
  assert.equal(matchesPipelineFilters({ sales_channel: "Other" }, {}, context), true);
});

test("Create/Edit/Filter use Pipeline Config runtime options; backend validates against the same master",()=>{
 const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
 const ctx=read("src/lib/dataContext.jsx"),batch=read("src/lib/entityBatch.js"),core=read("server/core.js");
 assert.ok(batch.includes('config/sales-channels'));
 assert.ok(ctx.includes('salesChannelOptions'));
 assert.ok(core.includes('function activeSalesChannelOptions()'));
 assert.ok(core.includes('store.table("B2B_GEO_Pipeline_Config.xlsx", "Field_Options")'));
 assert.ok(core.includes('allowedSalesChannels: activeSalesChannelOptions().map(option => option.value)'));
 for(const file of ["src/components/CreatePipelineModal.jsx","src/components/OpportunityForm.jsx","src/components/FilterBar.jsx"]){
   const s=read(file);
   assert.ok(s.includes('salesChannelOptions.map'),file);
   assert.ok(!s.includes('SALES_CHANNELS.map'),file);
 }
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
    assert.match(source, /salesChannelDisplay|salesChannelOptions/, file);
  }
  const form = readFileSync(new URL("../src/components/OpportunityForm.jsx", import.meta.url), "utf8");
  assert.match(form, /กรุณายืนยันช่องทางการขายก่อนบันทึก/);
});

test("contract documents only the three active channel options, preserving legacy aliases", () => {
  const source = readFileSync(new URL("../b2b_geo_pipeline.yaml", import.meta.url), "utf8");
  const section = source.split("    sales_channel:\n      source: \"AE / SM input\"")[1]?.split("    contact_name:")[0];
  assert.ok(section, "Opportunity sales channel field must exist in the contract");
  assert.match(section, /allowed:\s+- "AE Self"\s+- "Premium Partner"\s+- "Retail Partner"/);
  assert.match(section, /"AE B2B GEO": "AE Self"/);
  assert.match(section, /"B2B Premium Partner": "Premium Partner"/);
  assert.match(section, /sales_channel = Premium Partner or Retail Partner/);
});
