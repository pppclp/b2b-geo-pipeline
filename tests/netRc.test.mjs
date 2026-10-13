import test from "node:test";
import assert from "node:assert/strict";
import { calculateNetRc, formatNetRc } from "../src/lib/netRc.js";
test("OC amortized by 12", () => {
  assert.equal(calculateNetRc({ quantity: 10, pricePerSub: 599, oc: 12000 }), 6990);
  assert.equal(calculateNetRc({ quantity: 3, pricePerSub: 4500, oc: 15000 }), 14750);
});
test("OC optional; divisor independent from Contract Period", () => {
  assert.equal(calculateNetRc({ quantity: 10, pricePerSub: 599, oc: "" }), 5990);
  assert.equal(calculateNetRc({ quantity: 10, pricePerSub: 599, oc: 12000, contractPeriod: 36 }), 6990);
});
test("rounding and currency formatting", () => {
  assert.equal(calculateNetRc({ quantity: 3, pricePerSub: 199.99, oc: 10 }), 600.8);
  assert.equal(formatNetRc(6990), "฿6,990.00");
});
test("validation", () => {
  assert.throws(() => calculateNetRc({ quantity: "", pricePerSub: 100 }), RangeError);
  assert.throws(() => calculateNetRc({ quantity: 1, pricePerSub: "" }), RangeError);
  assert.throws(() => calculateNetRc({ quantity: 0, pricePerSub: 100 }), RangeError);
  assert.throws(() => calculateNetRc({ quantity: 1, pricePerSub: -1 }), RangeError);
  assert.throws(() => calculateNetRc({ quantity: 1, pricePerSub: 100, oc: -1 }), RangeError);
});
