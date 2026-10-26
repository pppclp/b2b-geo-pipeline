import test from "node:test";
import assert from "node:assert/strict";
import { businessIdError, normalizeCustomerType, netRcReconciliation } from "../src/lib/pipelineValidation.js";
test("Business ID is optional and accepts up to 40 digits without losing leading zeros", () => {
  assert.equal(businessIdError(""), "");
  assert.equal(businessIdError("0012345678901"), "");
  assert.equal(businessIdError("123456789012"), "");
  assert.equal(businessIdError("000123"), "");
  assert.equal(businessIdError("1".repeat(40)), "");
  assert.match(businessIdError("1".repeat(41)), /40 digits/);
  assert.match(businessIdError("ABC123"), /digits only/);
  assert.match(businessIdError("2.05565E+11"), /digits only/);
});
test("Industrial is an explicit supported customer type", () => {
  assert.equal(normalizeCustomerType("industrial"), "Industrial");
  assert.equal(normalizeCustomerType(" Enterprise "), "Enterprise");
  assert.equal(normalizeCustomerType("Unapproved type"), "");
});
test("reconcile source monthly amounts instead of silently changing Net RC formula", () => {
  assert.deepEqual(netRcReconciliation({expected:"",calculated:600}),{checked:false,matches:null});
  assert.equal(netRcReconciliation({expected:"300",calculated:600}).matches,false);
  assert.equal(netRcReconciliation({expected:"600.00",calculated:600}).matches,true);
  assert.equal(netRcReconciliation({expected:"invalid",calculated:600}).matches,false);
});
