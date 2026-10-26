import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHmac } from "node:crypto";

// Execute the real GAS session implementation with fake GAS services and clock.
// Do not touch Script Properties or customer data.
const source = fs.readFileSync(new URL("../apps-script/Main.js", import.meta.url), "utf8");
const start = source.indexOf("var GEO_UAT_SESSION_LIFETIME_SECONDS_");
const end = source.indexOf("function normalizeEmployeeId_", start);
assert.ok(start >= 0 && end > start, "GAS signed-session implementation must remain extractable");

function fixture() {
  const props = new Map();
  const clock = { now: 1_800_000_000_000 };
  const fakeDate = class extends Date { static now() { return clock.now; } };
  let uuidCounter = 0;
  const ctx = {
    Date: fakeDate,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => props.get(k) ?? null,
      setProperty: (k,v) => props.set(k,v),
    }) },
    Utilities: {
      getUuid: () => "fake-random-uuid-" + (++uuidCounter),
      newBlob: content => ({
        getBytes: () => [...Buffer.from(content)],
        getDataAsString: () => Buffer.from(content).toString("utf8"),
      }),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url"),
      base64DecodeWebSafe: text => [...Buffer.from(text, "base64url")],
      computeHmacSha256Signature: (body, secret) =>
        [...createHmac("sha256", secret).update(body).digest()],
    },
    console: { log: () => {} },
    throwUatError_: (status, message) => { const error = new Error(message); error.status = status; throw error; },
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end),ctx);
  return {ctx,props,clock};
}
const unauthorized = e => e?.status === 401;

test("valid signed GAS session authorizes only the signed identity", () => {
  const {ctx}=fixture();
  const token = ctx.issueUatSession_("AE1");
  assert.equal(ctx.verifyUatSession_(token),"AE1");
  assert.throws(()=>ctx.verifyUatSession_("AE1"),unauthorized);
});

test("payload, role claims and signature tampering are rejected", () => {
  const {ctx}=fixture();
  const token=ctx.issueUatSession_("AE1");
  const [body,mac]=token.split(".");
  const payload=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
  payload.sub="ADMIN1";
  const modified=Buffer.from(JSON.stringify(payload)).toString("base64url")+"."+mac;
  assert.throws(()=>ctx.verifyUatSession_(modified),unauthorized);
  assert.throws(()=>ctx.verifyUatSession_(body+"."+(mac[0] === "A" ? "B" : "A")+mac.slice(1)),unauthorized);
  assert.throws(()=>ctx.verifyUatSession_(body+"."+"A"),unauthorized);
});

test("expired, malformed, and future-dated GAS sessions fail closed", () => {
  const {ctx,clock}=fixture();
  const token=ctx.issueUatSession_("AE1");
  for (const bad of [null, "", "x.y.z", "%%%"]) {
    assert.throws(()=>ctx.verifyUatSession_(bad),unauthorized);
  }
  clock.now += 4 * 60 * 60 * 1000;
  assert.throws(()=>ctx.verifyUatSession_(token),unauthorized);
});

test("operator revocation invalidates old signed sessions without changing accounts", () => {
  const {ctx,props}=fixture();
  const existing=ctx.issueUatSession_("AE1");
  assert.equal(ctx.verifyUatSession_(existing),"AE1");
  ctx.revokeAllUatSessions();
  assert.throws(()=>ctx.verifyUatSession_(existing),unauthorized);
  const replacement=ctx.issueUatSession_("AE1");
  assert.equal(ctx.verifyUatSession_(replacement),"AE1");
  assert.ok(props.has("GEO_UAT_SESSION_SECRET"));
});
