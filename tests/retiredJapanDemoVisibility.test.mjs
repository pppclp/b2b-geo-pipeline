import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isVisibleWorkspacePipeline, isVisibleWorkspaceRegion } from "../src/lib/pipelineVisibility.js";

const src = path => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

test("four deleted JP-DEMO Pipelines remain hidden even with a stale backend response", () => {
  const ids = ["DEMOJP-DORAEMON", "DEMOJP-NOBITA", "DEMOJP-SHIZUKA", "OPP000477"];
  const oldResponse = ids.map(id => ({
    id, region_id:"JP-DEMO", status:"open", deleted_at:"",
  }));
  assert.deepEqual(oldResponse.filter(isVisibleWorkspacePipeline), []);
  assert.equal(isVisibleWorkspacePipeline({id:"OPP000143", region_id:"N", status:"open"}), true);
});

test("Soft-deleted non-demo Pipeline is excluded regardless of business status", () => {
  assert.equal(isVisibleWorkspacePipeline({
    id:"OPP000029",region_id:"N",status:"won",deleted_at:"2026-11-08T10:25:01Z",
  }),false);
  assert.equal(isVisibleWorkspacePipeline({id:"X",region_id:"N",status:"won",deleted_at:""}),true);
  assert.equal(isVisibleWorkspacePipeline(null),false);
});

test("Japan demo and all inactive Regions are absent from active selectors, not master audit", () => {
  const regions = [
    {id:"JP-DEMO",name:"Japan",active:true},
    {id:"BMA-E",name:"BMA-East",active:true},
    {id:"N",name:"North",active:true},
    {id:"OLD",name:"Inactive",active:false},
  ];
  assert.deepEqual(regions.filter(isVisibleWorkspaceRegion).map(r=>r.id),["BMA-E","N"]);
  assert.equal(regions.length,4,"retired Region history is not deleted");
});

test("shared DataContext excludes demo and deleted records on load, refresh, and mutations", () => {
  const context = src("lib/dataContext.jsx");
  assert.ok(context.includes('setOpportunities((results[MASTER_ENTITIES.length] || []).filter(isVisibleWorkspacePipeline))'));
  assert.ok(context.includes('if (!profile || !isVisibleWorkspacePipeline(op)) return false'));
  assert.ok(context.includes('setOpportunities((ops) => isVisibleWorkspacePipeline(rec)'));
});

test("Pipeline, Dashboard and advanced filters exclude retired Regions without altering permissions", () => {
  for(const path of ["pages/Pipeline.jsx","pages/Dashboard.jsx","components/FilterBar.jsx"]) {
    assert.ok(src(path).includes("isVisibleWorkspaceRegion"), path);
  }
  const context = src("lib/dataContext.jsx");
  assert.ok(context.includes("profile.app_role === \"sm\""),"SM region scope still checked");
  assert.ok(context.includes("profile.app_role === \"admin\""),"Admin scope still checked");
});

test("Backend already filters soft deleted canonical records without physically deleting them", () => {
  const backend = readFileSync(new URL("../server/core.js",import.meta.url),"utf8");
  assert.ok(backend.includes('if (uiEntity === "Opportunity") out = out.filter((row) => !isSoftDeleted(row))'));
  assert.ok(backend.includes("Hard deletion is disabled"));
});
