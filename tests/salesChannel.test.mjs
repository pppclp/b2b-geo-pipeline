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
