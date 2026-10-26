import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareStaticHost } from "../scripts/prepare-static-host.mjs";
import { latestVerifiedPagesSource } from "../scripts/pages-release-gate.mjs";

test("GitHub project path retains 404 fallback; root Cloudflare host uses native SPA routing",()=>{
  const dir=mkdtempSync(join(tmpdir(),"geo-static-"));
  try {
    writeFileSync(join(dir,"index.html"),"<html><div id='root'></div></html>");
    const github=prepareStaticHost({basePath:"/b2b-geo-pipeline/",outputDir:dir});
    assert.equal(github.fallback,"404");
    assert.equal(readFileSync(join(dir,"404.html"),"utf8"),readFileSync(join(dir,"index.html"),"utf8"));
    assert.equal(existsSync(join(dir,"_redirects")),false);
    const root=prepareStaticHost({basePath:"/",outputDir:dir});
    assert.equal(root.fallback,"native-spa");
    assert.equal(existsSync(join(dir,"404.html")),false);
    assert.equal(existsSync(join(dir,"_redirects")),false);
    assert.throws(()=>prepareStaticHost({basePath:"relative/path",outputDir:dir}),/VITE_BASE_PATH/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

function fakeGitHub({standard=[],recovery=[],jobs={}}) {
  const urls=[];
  const stub=async url=>{
    urls.push(url);
    const result=url.includes("workflows/deploy-pages.yml")?{workflow_runs:standard}:
      url.includes("workflows/recover-approved-ui.yml")?{workflow_runs:recovery}:
      {jobs:jobs[Number(/runs\/(\d+)\/jobs/.exec(url)?.[1])]??[]};
    return {ok:true,json:async()=>result};
  };
  return {stub,urls};
}
const run=(id,workflow,date,sha)=>({
  id,head_sha:sha,conclusion:"success",created_at:date,workflow
});

test("skipped build/deploy jobs never count as a published GitHub Pages revision",async()=>{
  const x=fakeGitHub({standard:[
    run(10,"deploy-pages.yml","2026-10-26T09:00:00Z","new-unpublished"),
    run(9,"deploy-pages.yml","2026-10-25T08:00:00Z","real-deployed"),
  ],jobs:{10:[{name:"preflight",conclusion:"success"},{name:"deploy",conclusion:"skipped"}],
    9:[{name:"deploy",conclusion:"success"}]}});
  const found=await latestVerifiedPagesSource({repo:"test/repo",token:"test-only",fetchImpl:x.stub});
  assert.deepEqual(found,{sha:"real-deployed",reason:"verified-pages-deploy"});
  assert.ok(x.urls.some(x=>x.includes("runs/9/jobs")));
});

test("pinned recovery deployment blocks auto-releasing unverified main",async()=>{
  const x=fakeGitHub({standard:[
    run(9,"deploy-pages.yml","2026-10-25T08:00:00Z","old-main"),
  ],recovery:[
    run(11,"recover-approved-ui.yml","2026-10-26T09:00:00Z","trigger-not-checked-out"),
  ],jobs:{11:[{name:"deploy",conclusion:"success"}],9:[{name:"deploy",conclusion:"success"}]}});
  assert.deepEqual(await latestVerifiedPagesSource({repo:"test/repo",token:"test-only",fetchImpl:x.stub}),
    {sha:null,reason:"pinned-recovery"});
});

test("no completed deploy job is a fail-closed publishing baseline",async()=>{
  const x=fakeGitHub({standard:[run(10,"deploy-pages.yml","2026-10-26T09:00:00Z","skipped")],
    jobs:{10:[{name:"build",conclusion:"skipped"}]}});
  assert.deepEqual(await latestVerifiedPagesSource({repo:"test/repo",token:"test-only",fetchImpl:x.stub}),
    {sha:null,reason:"no-confirmed-deploy"});
});

test("release gate fails closed if GitHub job metadata cannot be verified",async()=>{
  const x=fakeGitHub({standard:[run(10,"deploy-pages.yml","2026-10-26T09:00:00Z","candidate")]});
  await assert.rejects(()=>latestVerifiedPagesSource({repo:"test/repo",token:"test-only",fetchImpl:async url=>{
    if(url.includes("/runs/10/jobs"))return {ok:false,status:403};
    return x.stub(url);
  }}),/HTTP 403/);
});

test("last completed publisher wins when workflow creation and completion order differ",async()=>{
  const standard=run(14,"deploy-pages.yml","2026-10-26T09:20:00Z","main-from-normal");
  standard.updated_at="2026-10-26T09:21:00Z";
  const recovery=run(13,"recover-approved-ui.yml","2026-10-26T09:00:00Z","recovery-trigger-sha");
  recovery.updated_at="2026-10-26T09:24:00Z";
  const x=fakeGitHub({standard:[standard],recovery:[recovery],
    jobs:{14:[{name:"deploy",conclusion:"success"}],13:[{name:"deploy",conclusion:"success"}]}});
  assert.deepEqual(await latestVerifiedPagesSource({repo:"test/repo",token:"test-only",fetchImpl:x.stub}),
    {sha:null,reason:"pinned-recovery"});
});
