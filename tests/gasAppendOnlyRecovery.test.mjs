import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../apps-script/Main.js",import.meta.url),"utf8");

function auditHarness({failDuringWrite=false}={}) {
  const props=new Map(), log=[], ws={
    lastRow:4,
    getLastRow(){return this.lastRow;},
    deleteRows(start,count) {log.push(["rollback",start,count]); this.lastRow-=count;},
    copyTo(){throw Error("copyTo of audit sheet is forbidden");},
  };
  const book={
    getId:()=>"TEST_DB_ID",
    getSheetByName:(n)=>n==="Pipeline_Events"?ws:null,
    getSheets:()=>[ws],
    deleteSheet:()=>{},
  };
  const propsService={
    getProperty:(k)=>props.get(k)??null,
    setProperty:(k,v)=>{props.set(k,v);log.push(["marker",JSON.parse(v).status]);},
    deleteProperty:(k)=>props.delete(k),
  };
  const ctx={
    console:{warn:()=>{},error:()=>{},log:()=>{}},
    PropertiesService:{getScriptProperties:()=>propsService},
    SpreadsheetApp:{flush:()=>{log.push(["flush"]);}},
  };
  runInNewContext(source,ctx);
  const state={
    dirty:{"B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events":{file:"B2B_GEO_Pipeline_DB.xlsx",sheet:"Pipeline_Events"}},
    pendingAppends:[],pendingCells:[],
    book_:()=>book,
    writeDirty_:()=>{
      ws.lastRow+=2;
      if(failDuringWrite)throw Error("simulated mid-append failure");
    },
  };
  return {ctx,props,log,ws,state};
}

test("commit creates no copies for append-only Pipeline Events",()=>{
  const h=auditHarness();
  h.ctx.SheetStore_.prototype.flush.call(h.state);
  assert.equal(h.ws.lastRow,6);
  assert.equal(h.props.has("GEO_RUNTIME_DB_TXN"),false);
  assert.deepEqual(h.log.filter(x=>x[0]==="rollback"),[]);
  assert.ok(h.log.some(x=>x[0]==="marker"&&x[1]==="committed"));
});

test("a crash rolls back only appended rows and preserves original audit history",()=>{
  const h=auditHarness({failDuringWrite:true});
  assert.throws(()=>h.ctx.SheetStore_.prototype.flush.call(h.state),/simulated mid-append/);
  assert.equal(h.ws.lastRow,4);
  assert.equal(h.props.has("GEO_RUNTIME_DB_TXN"),false);
  assert.deepEqual(h.log.filter(x=>x[0]==="rollback"),[["rollback",5,2]]);
});

test("reject audit mutations and header changes (append-only invariant)",()=>{
  const c=runInNewContext(source,{console:{log(){},warn(){},error(){}}});
  const previous={event_id:"EV1",value:"before"};
  const current={...previous,value:"after"};
  const store={
    tables:{"B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events":{headers:["event_id","value"],rows:[current]}},
    loaded:{"B2B_GEO_Pipeline_DB.xlsx|Pipeline_Events":{
      headers:["event_id","value"],rows:[previous],json:[JSON.stringify(previous)]
    }},
    book_:()=>({getSheetByName:()=>({getLastRow:()=>2})}),
  };
  assert.throws(()=>c.SheetStore_.prototype.writeDirty_.call(store,{
    file:"B2B_GEO_Pipeline_DB.xlsx",sheet:"Pipeline_Events"
  }),/may not rewrite existing records/);
});
