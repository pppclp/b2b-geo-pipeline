import test from "node:test";
import assert from "node:assert/strict";
import { actionableErrorMessage } from "../src/lib/actionFeedback.js";

test("expired sessions offer sign-in without discarding drafts", () => {
  assert.match(actionableErrorMessage({ status: 401 }), /Sign in again.*draft/);
});
test("stale revision conflicts advise review before retry", () => {
  assert.match(actionableErrorMessage({ status: 409, code: "STALE_PIPELINE_REVISION" }), /refresh.*before saving/);
});
test("unrelated 409 errors preserve detailed backend message", () => {
  assert.equal(actionableErrorMessage({ status: 409, message: "Request ID in use" }), "Request ID in use");
});
test("network failure and timeout never falsely claim write was rejected", () => {
  for (const error of [new TypeError("Failed to fetch"), { status: 503 }]) {
    assert.match(actionableErrorMessage(error), /check whether the change was saved/);
  }
});
test("read errors offer a retry", () => {
  assert.match(actionableErrorMessage({ status: 503 }, "load"), /select Retry/);
});
test("contract mismatch warns about deployment incompatibility", () => {
  assert.match(actionableErrorMessage({ code: "API_CONTRACT_MISMATCH" }, "load"), /Contact your system administrator/);
});
test("business validation errors are preserved", () => {
  assert.equal(actionableErrorMessage({ status: 400, message: "Select a Lost Reason" }), "Select a Lost Reason");
});
test("missing revision requires refresh", () => {
  assert.match(actionableErrorMessage({ status: 428 }), /refresh before saving/);
});
