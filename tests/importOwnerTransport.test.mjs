import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const client = fs.readFileSync(new URL("../src/api/client.js", import.meta.url), "utf8");

// Exercise the real client request wrapper without a browser or external network.
function loadClient(apiUrl, fetchImpl) {
  const transformed = client
    .replaceAll("import.meta.env.VITE_GEO_API_URL", JSON.stringify(apiUrl))
    .replaceAll("import.meta.env.PROD", "false")
    .replace(/^export /gm, "");
  const memory = new Map();
  const sandbox = {
    URL,
    fetch: fetchImpl,
    window: {location:{origin:"http://localhost"}},
    localStorage: {getItem:k=>memory.get("local:"+k)||"",setItem:(k,v)=>memory.set("local:"+k,v),removeItem:k=>memory.delete("local:"+k)},
    sessionStorage: {getItem:k=>memory.get("session:"+k)||"",setItem:(k,v)=>memory.set("session:"+k,v),removeItem:k=>memory.delete("session:"+k)},
    setTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(transformed + "\nthis.__db = db;", sandbox);
  return sandbox.__db;
}

test("import Sales Code lookup sends {codes} in the REST request body", async () => {
  const calls = [];
  const db = loadClient("/api", async (url, options) => {
    calls.push({url:String(url),options});
    return {status:200,json:async()=>({owners:[]})};
  });
  const result = await db.imports.resolveOwners(["1001","1002"]);
  assert.deepEqual(Array.from(result.owners),[]);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"http://localhost/api/imports/resolve-owners");
  assert.equal(calls[0].options.method,"POST");
  assert.deepEqual(JSON.parse(calls[0].options.body),{codes:["1001","1002"]});
});

test("import Sales Code lookup uses signed Apps Script POST envelope", async () => {
  const calls = [];
  const url="https://script.google.com/macros/s/SYNTHETIC/exec";
  const db = loadClient(url, async (sent, options) => {
    calls.push({sent,options});
    return {json:async()=>({status:200,body:{owners:[]}})};
  });
  const result = await db.imports.resolveOwners(["1001"]);
  assert.deepEqual(Array.from(result.owners),[]);
  assert.equal(calls.length,1);
  assert.equal(calls[0].sent,url);
  assert.equal(calls[0].options.method,"POST");
  assert.match(calls[0].options.headers["Content-Type"],/^text\/plain/);
  const data=JSON.parse(calls[0].options.body);
  assert.equal(data.method,"POST");
  assert.equal(data.path,"imports/resolve-owners");
  assert.deepEqual(data.body,{codes:["1001"]});
  assert.equal(data.sessionToken,"");
});
