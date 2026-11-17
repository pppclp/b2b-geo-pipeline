import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasOpenPipelineAlert, overdueReasons } from "../src/lib/overdueSummary.js";

const read = path => readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
const oneAlert = { version:1, stageSla:true, handler:null, workingWithTeams:[] };
const noAlert = { version:1, stageSla:false, handler:null, workingWithTeams:[] };

test("company warning appears only for open Pipeline with a real alert", () => {
  const open={id:"OPP1",status:"open",stage_id:"STG001",alert_state:oneAlert};
  assert.equal(overdueReasons(open).any,true);
  assert.equal(hasOpenPipelineAlert(open),true);
  assert.equal(hasOpenPipelineAlert({...open,alert_state:noAlert}),false);
  assert.equal(hasOpenPipelineAlert({...open,status:"won"}),false);
  assert.equal(hasOpenPipelineAlert({...open,status:"lost"}),false);
  assert.equal(hasOpenPipelineAlert({...open,status:"archived"}),false);
  assert.equal(hasOpenPipelineAlert(null),false);
});

test("a handler-only or team-only live alert also marks an open company", () => {
  const row={id:"OPP2",status:"open",alert_state:{version:1,stageSla:false,handler:{role:"ae",age:7,limit:5},workingWithTeams:[]}};
  assert.equal(hasOpenPipelineAlert(row),true);
  assert.equal(hasOpenPipelineAlert({...row,alert_state:{version:1,stageSla:false,handler:null,workingWithTeams:[{id:"WW002",name:"Pricer",age:9,limit:5}]}}),true);
});

test("list, mobile and Board keep warning next to customer name and share real SLA decisions", () => {
  const page=read("pages/Pipeline.jsx"),board=read("components/PipelineCard.jsx");
  assert.ok(page.includes("const overdue = hasOpenPipelineAlert(o,"));
  assert.ok(board.includes("const overdue = hasOpenPipelineAlert(op,"));
  assert.equal((page.match(/⚠️/g)||[]).length,2,"desktop and mobile each have one company warning");
  assert.equal((board.match(/⚠️/g)||[]).length,1,"Kanban card has one company warning");
  assert.ok(page.includes("{overdue && <span"),"only present when actual SLA is overdue");
  assert.ok(board.includes("{overdue && <span"),"only present on active alert");
  assert.ok(page.includes("Active Pipeline alert"));
  assert.ok(page.includes("<OverdueTags op={o}"),"detailed SLA tags remain available");
});
