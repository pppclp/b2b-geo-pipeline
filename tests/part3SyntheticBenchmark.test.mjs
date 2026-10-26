import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("synthetic benchmark runs read-only, emits scoped list and batch timing summaries",()=>{
  const executable=fileURLToPath(new URL("../scripts/benchmark-part3-synthetic.mjs",import.meta.url));
  const run=spawnSync(process.execPath,[executable,"--rows","24","--requests","6","--clients","3"],
    {encoding:"utf8",timeout:30000,maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr);
  const items=run.stdout.trim().split("\n").map(line=>JSON.parse(line));
  assert.equal(items.length,4);
  assert.ok(items.some(x=>x.scenario.includes("batch")));
  for(const item of items){
    assert.equal(item.rows,24);
    assert.equal(item.requests,6);
    assert.equal(item.clients,3);
    assert.ok(item.p95_ms>=0);
    assert.ok(item.requests_per_second>0);
  }
});
