import test from "node:test";
import assert from "node:assert/strict";
import { createSessionManager } from "../server/authSession.js";

const secret = "change-me-in-real-deployment-01234567890123456789";
let current = 1_800_000_000_000;
const sessions = createSessionManager(secret, { clock: () => current });
test("a valid login session identifies only its signed user", () => {
  const token = sessions.issue("USR01");
  assert.equal(sessions.verify(token), "USR01");
  assert.equal(sessions.verify(token + "x"), null);
  assert.equal(sessions.verify("USR02"), null);
});
test("tampering with the claimed user ID invalidates the token", () => {
  const [payload, signature] = sessions.issue("USR01").split(".");
  const record = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  record.sub = "ADMIN01";
  const changed = Buffer.from(JSON.stringify(record)).toString("base64url") + "." + signature;
  assert.equal(sessions.verify(changed), null);
});
test("sessions expire after four hours and cannot be accepted with another signing secret", () => {
  const token = sessions.issue("USR01");
  const rotated = createSessionManager("rotated-secret-for-test-012345678901234567", { clock: () => current });
  assert.equal(rotated.verify(token), null);
  current += 4 * 60 * 60 * 1000 + 1000;
  assert.equal(sessions.verify(token), null);
});
