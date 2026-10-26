import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// In-memory, synthetic Google Sheets; never reads or writes a real workbook.
const source = readFileSync(new URL("../apps-script/Main.js", import.meta.url), "utf8");
const DB = "B2B_GEO_Pipeline_DB.xlsx";
const TXN = "GEO_RUNTIME_DB_TXN";

function harness({copyFailure = "", failWhen = "", failWrite = ""} = {}) {
  const props = new Map(), sheets = new Map(), trace = [];
  let copyNumber = 0;
  const clone = values => values.map(row => [...row]);

  function sheet(name, values) {
    const ws = {
      name, cells: clone(values), hidden: false,
      getName() { return this.name; },
      getLastRow() {
        let last = this.cells.length;
        while (last > 0 && !(this.cells[last - 1] || []).some(v => v !== "" && v !== undefined && v !== null)) last--;
        return last;
      },
      getLastColumn() { return Math.max(0, ...this.cells.map(row => row.length)); },
      getMaxRows() { return 100; },
      getMaxColumns() { return 30; },
      insertRowsAfter() {},
      insertColumnsAfter() {},
      getDataRange() { return { getValues: () => clone(this.cells.slice(0, this.getLastRow())) }; },
      getRange(startRow, startColumn, count = 1, width = 1) {
        return {
          getValues: () => Array.from({length: count}, (_, r) =>
            Array.from({length: width}, (_, c) => this.cells[startRow + r - 1]?.[startColumn + c - 1] ?? "")),
          setValues: values => {
            for(let r = 0; r < values.length; r++) {
              const index = startRow + r - 1;
              while(this.cells.length <= index) this.cells.push([]);
              for(let c = 0; c < values[r].length; c++) this.cells[index][startColumn + c - 1] = values[r][c];
            }
            trace.push(["write",this.name,startRow]);
          },
          clearContent: () => {
            for(let r = 0; r < count; r++) {
              const index = startRow + r - 1;
              while(this.cells.length <= index) this.cells.push([]);
              for(let c = 0; c < width; c++) this.cells[index][startColumn + c - 1] = "";
            }
          },
          setNumberFormat() { return this; }
        };
      },
      deleteRows(start, count) { this.cells.splice(start - 1, count); trace.push(["trim",this.name,count]); },
      copyTo() {
        const copy = sheet("TempBackup" + (++copyNumber), this.cells);
        if(copyFailure === "rename" && this.name === "Pipelines") {
          copy.setName = () => { throw new Error("simulated backup rename failed"); };
        }
        if(copyFailure === "hide" && this.name === "Pipelines") {
          copy.hideSheet = () => { throw new Error("simulated backup hide failed"); };
        }
        return copy;
      },
      setName(newName) { sheets.delete(this.name); this.name = newName; sheets.set(newName,this); },
      hideSheet() { this.hidden = true; }
    };
    sheets.set(name,ws);
    return ws;
  }
  sheet("Pipelines", [["opportunity_id","customer_name"],["OPP1","Before"]]);
  sheet("Pipeline_Events", [["event_id","event_type"],["E1","create"]]);
  sheet("Admin_Audit", [["audit_id","event_type"],["A1","original"]]);
  const book = {
    getId: () => "SYNTHETIC_DB",
    getSheetByName: name => sheets.get(name) || null,
    getSheets: () => [...sheets.values()],
    deleteSheet: ws => { sheets.delete(ws.getName()); trace.push(["delete_backup",ws.getName()]); }
  };
  const propertyApi = {
    getProperty: key => props.get(key) ?? null,
    setProperty: (key,value) => {
      const marker = key === TXN ? JSON.parse(value) : null;
      if (marker && failWhen === marker.status) throw new Error("simulated marker write failure: " + failWhen);
      props.set(key,value);
      if(marker) trace.push(["marker",marker.status]);
    },
    deleteProperty: key => props.delete(key)
  };
  const ctx = {
    console: {warn:() => {},error:() => {},log:() => {}},
    PropertiesService: { getScriptProperties: () => propertyApi },
    SpreadsheetApp: {flush:()=>trace.push(["flush"]) }
  };
  runInNewContext(source,ctx,{filename:"apps-script/Main.js"});
  const dirty = {};
  function addDirty(sheetName,file=DB) {
    dirty[file+"|"+sheetName]={file,sheet:sheetName};
  }
  const state = {
    dirty,pendingAppends:[],pendingCells:[],
    book_:()=>book,
    writeDirty_(entry) {
      if(entry.sheet === failWrite) throw new Error("simulated "+failWrite+" write failure");
      if(entry.sheet === "Pipelines") {
        sheets.get("Pipelines").getRange(2,2).setValues([["After"]]);
      }
      if(entry.sheet === "Pipeline_Events") {
        sheets.get("Pipeline_Events").getRange(3,1,1,2).setValues([["E2","update"]]);
      }
      if(entry.sheet === "Admin_Audit") {
        sheets.get("Admin_Audit").getRange(3,1,1,2).setValues([["A2","MASTER_UPDATED"]]);
      }
      if(entry.sheet === "Users") throw Error("simulated master failure");
    }
  };
  const values = name => clone(sheets.get(name).cells);
  const backups = () => [...sheets.keys()].filter(n => n.startsWith("__GEO_BAK__") || n.startsWith("TempBackup"));
  return {ctx,props,trace,sheets,book,state,addDirty,values,backups};
}

test("Pipeline write followed by audit append failure restores both tables and allows safe replay",()=>{
  const h=harness({failWrite:"Pipeline_Events"});
  h.addDirty("Pipelines");
  h.addDirty("Pipeline_Events");
  const firstPipeline = h.values("Pipelines");
  const firstEvents = h.values("Pipeline_Events");
  assert.throws(()=>h.ctx.SheetStore_.prototype.flush.call(h.state),/simulated Pipeline_Events/);
  assert.deepEqual(h.values("Pipelines"),firstPipeline);
  assert.deepEqual(h.values("Pipeline_Events"),firstEvents);
  assert.equal(h.props.has(TXN),false);
  assert.deepEqual(h.backups(),[]);
  h.state.writeDirty_ = entry => {
    if(entry.sheet === "Pipelines") h.sheets.get("Pipelines").getRange(2,2).setValues([["After"]]);
    if(entry.sheet === "Pipeline_Events") h.sheets.get("Pipeline_Events").getRange(3,1,1,2).setValues([["E2","update"]]);
  };
  h.ctx.SheetStore_.prototype.flush.call(h.state);
  assert.equal(h.values("Pipelines")[1][1],"After");
  assert.equal(h.values("Pipeline_Events").length,3);
  assert.equal(h.props.has(TXN),false);
});

test("failure after audit append but before commit marker rolls back new event and Pipeline",()=>{
  const h=harness({failWhen:"committed"});
  h.addDirty("Pipelines");
  h.addDirty("Pipeline_Events");
  assert.throws(()=>h.ctx.SheetStore_.prototype.flush.call(h.state),/simulated marker write failure/);
  assert.equal(h.values("Pipelines")[1][1],"Before");
  assert.equal(h.values("Pipeline_Events").length,2);
  assert.equal(h.props.has(TXN),false);
  assert.deepEqual(h.backups(),[]);
});

test("recovery after interrupted prepared transaction restores mutable data and trims only new events",()=>{
  const h=harness();
  h.ctx.geoBackups_(h.book,["Pipelines"]);
  h.props.set(TXN,JSON.stringify({
    spreadsheetId:"SYNTHETIC_DB",backupSheets:["Pipelines"],sheets:["Pipelines","Pipeline_Events"],
    appendCheckpoints:{Pipeline_Events:2},status:"prepared"
  }));
  h.sheets.get("Pipelines").getRange(2,2).setValues([["Interrupted"]]);
  h.sheets.get("Pipeline_Events").getRange(3,1,1,2).setValues([["E2","update"]]);
  h.ctx.recoverGeoDb_(h.book);
  assert.equal(h.values("Pipelines")[1][1],"Before");
  assert.equal(h.values("Pipeline_Events").length,2);
  assert.deepEqual(h.backups(),[]);
  assert.equal(h.props.has(TXN),false);
});

test("post-commit interruption preserves committed writes and cleans backups without rollback",()=>{
  const h=harness();
  h.ctx.geoBackups_(h.book,["Pipelines"]);
  h.props.set(TXN,JSON.stringify({
    spreadsheetId:"SYNTHETIC_DB",backupSheets:["Pipelines"],sheets:["Pipelines","Pipeline_Events"],
    appendCheckpoints:{Pipeline_Events:2},status:"committed"
  }));
  h.sheets.get("Pipelines").getRange(2,2).setValues([["Committed"]]);
  h.sheets.get("Pipeline_Events").getRange(3,1,1,2).setValues([["E2","update"]]);
  h.ctx.recoverGeoDb_(h.book);
  assert.equal(h.values("Pipelines")[1][1],"Committed");
  assert.equal(h.values("Pipeline_Events").length,3);
  assert.deepEqual(h.backups(),[]);
  assert.equal(h.props.has(TXN),false);
});

for(const step of ["rename","hide"]) {
  test("backup "+step+" failure cleans the newly copied sheet before any write",()=>{
    const h=harness({copyFailure:step});
    assert.throws(()=>h.ctx.geoBackups_(h.book,["Pipelines"]),/simulated backup/);
    assert.deepEqual(h.backups(),[]);
    assert.equal(h.props.has(TXN),false);
    assert.equal(h.values("Pipelines")[1][1],"Before");
  });
}

test("failed Master write after committed Admin Audit is surfaced; never claim cross-workbook atomicity",()=>{
  const h=harness();
  h.addDirty("Admin_Audit");
  h.addDirty("Users","User_Master.xlsx");
  assert.throws(()=>h.ctx.SheetStore_.prototype.flush.call(h.state),/Master data save failed for Users/);
  assert.equal(h.values("Admin_Audit").length,3);
  assert.equal(h.props.has(TXN),false);
  assert.deepEqual(h.backups(),[]);
});

test("recovery refuses markers referencing a different workbook without changing live rows",()=>{
  const h=harness();
  h.props.set(TXN,JSON.stringify({
    spreadsheetId:"ANOTHER_DB",backupSheets:["Pipelines"],appendCheckpoints:{},status:"prepared"
  }));
  assert.throws(()=>h.ctx.recoverGeoDb_(h.book),/different Pipeline DB/);
  assert.equal(h.values("Pipelines")[1][1],"Before");
  assert.ok(h.props.has(TXN));
});
