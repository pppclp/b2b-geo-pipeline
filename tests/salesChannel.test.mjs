import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { SALES_CHANNELS, normalizeSalesChannel } from "../src/lib/salesChannel.js";

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

test("contract documents only the three active channel options, preserving legacy aliases", () => {
  const source = readFileSync(new URL("../b2b_geo_pipeline.yaml", import.meta.url), "utf8");
  const section = source.split("    sales_channel:\n      source: \"AE / SM input\"")[1]?.split("    contact_name:")[0];
  assert.ok(section, "Opportunity sales channel field must exist in the contract");
  assert.match(section, /allowed:\s+- "AE Self"\s+- "Premium Partner"\s+- "Dealer"/);
  assert.match(section, /"AE B2B GEO": "AE Self"/);
  assert.match(section, /"B2B Premium Partner": "Premium Partner"/);
  assert.match(section, /sales_channel = Premium Partner or Dealer/);
});
