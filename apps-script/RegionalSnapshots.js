// Regional month-end reporting adapter for the existing B2B GEO Pipeline API.
// This is included AFTER Main.js in Code.gs. Never run setup() for migration.
// The 8 visible region tabs are derived and must never be used as the canonical API table.
var GEO_REPORT_FILE_ = "B2B_GEO_Regional_Reporting_Snapshots.xlsx";
var GEO_REPORT_TITLE_ = "B2B_GEO_Regional_Reporting_Snapshots";
var GEO_REGION_SHEETS_ = {
  "BMA-E": "BMA-East", "BMA-W": "BMA-West", "CW": "Central-West",
  "E": "East", "N": "North", "NE1": "Northeast1",
  "NE2": "Northeast2", "S": "South"
};
var GEO_REPORT_HEADERS_ = [
  "Snapshot Period","Captured At","Opportunity ID","Created Month","Business ID",
  "Customer Type","Customer Name","Contact Name","Contact Phone","Sales Code",
  "AE Name","Sales Channel","Partner Name","Region","Province / Territory",
  "Product Category","Product Details","Subs","RC","Net RC","OC",
  "Contract Period (Months)","Stage","Status","Expected Close Month",
  "Scenario","CCP+ Check","Current Handler","Working With","Remark"
];
// Original 49 technical columns retained, plus one frozen Working-With ID.
// Do not delete any old columns or derive missing historical values from today's Pipelines.
var GEO_TECHNICAL_SNAPSHOT_HEADERS_ = [
  "snapshot_id","snapshot_period","captured_at","opportunity_id","lead_created_at",
  "owner_user_id","current_handler_user_id","region_id","territory_id","sales_channel",
  "partner_name","business_id","customer_name","customer_type","contact_name","contact_phone",
  "remark","product_category_id","product_details","quantity","price_per_sub","pipeline_value",
  "oc","contract_period_months","contract_value","expected_close_month","ccp_check_result",
  "scenario_id","handoff_at","stage_id","stage_last_updated_at","status","support_needed",
  "support_type_id","support_note","won_at","lost_at","lost_reason_id","created_month",
  "owner_sales_code","owner_sale_name","customer_location_text","import_source_customer_type",
  "import_source_rc","import_source_net_rc","import_source_monthly_sale_plan",
  "import_source_system","import_source_record_id","import_batch_id","working_with_id",
  "import_source_sales_code"
];
function geoReportBook_(store) {
  if (!store._geoReportBook) {
    var id = sheetIdFor_(GEO_REPORT_FILE_);
    if (!id) throw geoSchemaError_("REPORT_BINDING_MISSING",
      "Set GEO_SHEET_ID_B2B_GEO_Regional_Reporting_Snapshots in Script Properties");
    var book = SpreadsheetApp.openById(id);
    if (book.getName() !== GEO_REPORT_TITLE_)
      throw geoSchemaError_("REPORT_WRONG_WORKBOOK", "Unexpected reporting workbook title");
    store._geoReportBook = book;
  }
  return store._geoReportBook;
}
function geoHeadersEqual_(actual, expected) {
  return actual.length === expected.length &&
    expected.every(function (name,i) { return String(actual[i]).trim() === name; });
}
function geoSheetHeaders_(ws) {
  if (!ws || !ws.getLastRow() || !ws.getLastColumn()) return [];
  return ws.getRange(1,1,1,ws.getLastColumn()).getValues()[0].map(function (h) {
    return String(h).trim();
  });
}
function geoAssertRegionalSnapshotSchema_(store) {
  var book = geoReportBook_(store);
  var tech = book.getSheetByName("Snapshots");
  if (!tech) throw geoSchemaError_("REQUIRED_SHEET_MISSING",
    GEO_REPORT_TITLE_ + " / Snapshots (run prepareGeoRegionalSnapshotSchema manually)");
  var actual = geoSheetHeaders_(tech);
  if (!geoHeadersEqual_(actual,GEO_TECHNICAL_SNAPSHOT_HEADERS_))
    throw geoSchemaError_("SCHEMA_MISMATCH","Regional Snapshots technical columns differ from approved schema");
  Object.keys(GEO_REGION_SHEETS_).forEach(function (id) {
    var name = GEO_REGION_SHEETS_[id], ws = book.getSheetByName(name);
    if (!ws) throw geoSchemaError_("REQUIRED_SHEET_MISSING",GEO_REPORT_TITLE_ + " / " + name);
    if (!geoHeadersEqual_(geoSheetHeaders_(ws),GEO_REPORT_HEADERS_))
      throw geoSchemaError_("SCHEMA_MISMATCH",name + ": 30-column report header changed");
  });
  return tech;
}
// Run manually ONCE after reviewing the target workbook. Does not touch the Pipeline DB
// or the 8 region sheets. If a technical sheet exists, verify only; never overwrite.
function prepareGeoRegionalSnapshotSchema() {
  var lock=LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var store=new SheetStore_(), book=geoReportBook_(store);
    Object.keys(GEO_REGION_SHEETS_).forEach(function(id) {
      var name=GEO_REGION_SHEETS_[id], ws=book.getSheetByName(name);
      if (!ws || !geoHeadersEqual_(geoSheetHeaders_(ws),GEO_REPORT_HEADERS_))
        throw geoSchemaError_("SCHEMA_MISMATCH","Region tab is missing or changed: " + name);
    });
    var existing=book.getSheetByName("Snapshots");
    if (existing) {
      geoAssertRegionalSnapshotSchema_(store);
      return {ok:true,created:false,technical_rows:Math.max(0,existing.getLastRow()-1)};
    }
    var ws=book.insertSheet("Snapshots");
    if(ws.getMaxColumns()<GEO_TECHNICAL_SNAPSHOT_HEADERS_.length)
      ws.insertColumnsAfter(ws.getMaxColumns(),
        GEO_TECHNICAL_SNAPSHOT_HEADERS_.length-ws.getMaxColumns());
    ws.getRange(1,1,1,GEO_TECHNICAL_SNAPSHOT_HEADERS_.length)
      .setValues([GEO_TECHNICAL_SNAPSHOT_HEADERS_]);
    ws.setFrozenRows(1);
    SpreadsheetApp.flush();
    geoAssertRegionalSnapshotSchema_(store);
    return {ok:true,created:true,technical_rows:0,region_tabs:8};
  } finally { lock.releaseLock(); }
}
// Editor-only read-only diagnostic. Never exposes customer records or credentials.
function debugGeoRegionalSnapshotBinding() {
  var store=new SheetStore_(), tech=geoAssertRegionalSnapshotSchema_(store);
  var out={ok:true,workbook:geoReportBook_(store).getName(),
    technical_rows:Math.max(0,tech.getLastRow()-1), regions:{}};
  Object.keys(GEO_REGION_SHEETS_).forEach(function(id) {
    var name=GEO_REGION_SHEETS_[id];
    out.regions[name]=Math.max(0,geoReportBook_(store).getSheetByName(name).getLastRow()-1);
  });
  console.log(JSON.stringify(out));
  return out;
}
function geoText_(v) { return v===null || v===undefined ? "" : v; }
function geoNonblank_(v) { return v!==null && v!==undefined && String(v).trim()!==""; }
function geoIndex_(records,key,value) {
  var out={};
  (records || []).forEach(function(r) {
    if(geoNonblank_(r[key])) out[String(r[key])] = geoText_(r[value]);
  });
  return out;
}
function geoRegionalProjectionLookups_(store) {
  return {
    users:geoIndex_(store.table("B2B_GEO_User_Org_Master.xlsx","Users").rows,"user_id","display_name"),
    products:geoIndex_(store.table("B2B_GEO_Pipeline_Config.xlsx","Product_Categories").rows,"category_id","category_name"),
    stages:geoIndex_(store.table("B2B_GEO_Pipeline_Config.xlsx","Stages").rows,"stage_id","stage_name"),
    scenarios:geoIndex_(store.table("B2B_GEO_Pipeline_Config.xlsx","Scenarios").rows,"scenario_id","scenario_name"),
    teams:geoIndex_(store.table("B2B_GEO_Pipeline_Config.xlsx","Working_With").rows,"team_id","team_name")
  };
}
function geoDisplay_(ref,key) {
  return geoNonblank_(key) ? (ref[String(key)] || String(key)) : "";
}
function geoProjectSnapshotRow_(r,lookups) {
  // Historical financial evidence is distinct from new sales calculations.
  // Never relabel price_per_sub as RC or calculated pipeline_value as the source Net RC.
  // Missing historical RC / Net RC stay blank, never filled from later Pipeline state.
  var created=geoNonblank_(r.created_month)?r.created_month:
    (geoNonblank_(r.lead_created_at)?String(r.lead_created_at).slice(0,7):"");
  return [
    geoText_(r.snapshot_period),geoText_(r.captured_at),geoText_(r.opportunity_id),created,
    geoText_(r.business_id),geoText_(r.customer_type),geoText_(r.customer_name),
    geoText_(r.contact_name),geoText_(r.contact_phone),
    geoNonblank_(r.import_source_system) ? geoText_(r.import_source_sales_code)
      : geoText_(r.owner_sales_code),
    geoText_(r.owner_sale_name),geoText_(r.sales_channel),geoText_(r.partner_name),
    GEO_REGION_SHEETS_[String(r.region_id)] || geoText_(r.region_id),
    geoNonblank_(r.customer_location_text)?r.customer_location_text:geoText_(r.territory_id),
    geoDisplay_(lookups.products,r.product_category_id),geoText_(r.product_details),
    geoText_(r.quantity),geoText_(r.import_source_rc),
    geoNonblank_(r.import_source_system)?geoText_(r.import_source_net_rc):geoText_(r.pipeline_value),
    geoText_(r.oc),geoText_(r.contract_period_months),
    geoDisplay_(lookups.stages,r.stage_id),geoText_(r.status),geoText_(r.expected_close_month),
    geoDisplay_(lookups.scenarios,r.scenario_id),geoText_(r.ccp_check_result),
    geoDisplay_(lookups.users,r.current_handler_user_id),
    geoDisplay_(lookups.teams,r.working_with_id),geoText_(r.remark)
  ];
}
// Idempotent append-only projection. Repair can retry after a partial report write.
// Existing region report rows are never overwritten/re-enriched from changed current master data.
function geoPublishRegionalSnapshots_(store, snapshotRows) {
  if (!snapshotRows.length) return {appended:0,unassigned:0};
  geoAssertRegionalSnapshotSchema_(store);
  var lookups=geoRegionalProjectionLookups_(store), book=geoReportBook_(store);
  var grouped={},unassigned=[],incoming=new Set(),total=0;
  Object.keys(GEO_REGION_SHEETS_).forEach(function(id){grouped[id]=[];});
  snapshotRows.forEach(function(r){
    var key=String(r.snapshot_period)+"|"+String(r.opportunity_id);
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(String(r.snapshot_period)) ||
        !geoNonblank_(r.opportunity_id) || incoming.has(key))
      throw geoSchemaError_("SCHEMA_MISMATCH","Invalid or duplicate technical snapshot period/opportunity");
    incoming.add(key);
    var region=String(r.region_id||"");
    if (!Object.prototype.hasOwnProperty.call(grouped,region)) {unassigned.push(key);return;}
    grouped[region].push({key:key,values:geoProjectSnapshotRow_(r,lookups)});
  });
  // Preflight all eight destinations and existing keys BEFORE writing any tab.
  var pending=[];
  Object.keys(grouped).forEach(function(region){
    var name=GEO_REGION_SHEETS_[region], ws=book.getSheetByName(name),seen=new Set();
    var current=ws.getLastRow()>1?ws.getRange(2,1,ws.getLastRow()-1,3).getValues():[];
    current.forEach(function(x){
      var key=String(x[0])+"|"+String(x[2]);
      if(seen.has(key)) throw geoSchemaError_("SCHEMA_MISMATCH",name+" duplicate Period + Opportunity");
      seen.add(key);
    });
    var missing=grouped[region].filter(function(x){return !seen.has(x.key);});
    if(missing.length) pending.push({ws:ws,name:name,rows:missing.map(function(x){return x.values;})});
  });
  pending.forEach(function(group){
    var ws=group.ws,start=ws.getLastRow()+1,needed=start+group.rows.length-1;
    if(ws.getMaxRows()<needed) ws.insertRowsAfter(ws.getMaxRows(),needed-ws.getMaxRows());
    // Explicit text format on identifiers/phone numbers prevents leading-zero loss.
    ["Opportunity ID","Business ID","Contact Phone","Sales Code"].forEach(function(h){
      var col=GEO_REPORT_HEADERS_.indexOf(h)+1;
      ws.getRange(start,col,group.rows.length,1).setNumberFormat("@");
    });
    ws.getRange(start,1,group.rows.length,GEO_REPORT_HEADERS_.length)
      .setValues(group.rows.map(function(row){return row.map(geoSafeSheetValue_);}));
    total+=group.rows.length;
  });
  SpreadsheetApp.flush();
  return {appended:total,unassigned:unassigned.length,
    note:unassigned.length?"Records with unmapped/blank Region remain in canonical Snapshots; no Region invented.":""};
}
// Read-only preflight followed by an intentional append-only repair of missing projections.
// Does not recapture or replace historical canonical Snapshots.
function repairGeoRegionalSnapshotProjections() {
  var lock=LockService.getScriptLock();lock.waitLock(30000);
  try{
    var store=new SheetStore_();
    var all=store.table("B2B_GEO_Pipeline_DB.xlsx","Snapshots").rows;
    return geoPublishRegionalSnapshots_(store,all);
  }finally{lock.releaseLock();}
}
// The canonical technical writer is transaction-guarded. If a report projection fails,
// canonical capture stays committed and repairGeoRegionalSnapshotProjections() is retryable.
function geoCommitCanonicalSnapshots_(store,change) {
  var book=geoReportBook_(store),ws=geoAssertRegionalSnapshotSchema_(store);
  var key=change.file+"|"+change.sheet,t=store.tables[key],before=store.loaded[key];
  if(!t||!before) throw geoSchemaError_("SCHEMA_MISMATCH","Snapshot table not preloaded");
  if(!geoHeadersEqual_(t.headers,GEO_TECHNICAL_SNAPSHOT_HEADERS_))
    throw geoSchemaError_("SCHEMA_MISMATCH","Unexpected technical Snapshot columns");
  if(t.rows.length<before.rows.length ||
     before.json.some(function(x,i){return JSON.stringify(t.rows[i])!==x;}))
    throw geoSchemaError_("SNAPSHOT_IMMUTABLE","Existing Snapshot rows may not be altered");
  var additions=t.rows.slice(before.rows.length);
  if(!additions.length)return {captured:0};
  // Validate exact keys across the full capture before changing any live rows.
  var existing=new Set(before.rows.map(function(r){return String(r.snapshot_period)+"|"+String(r.opportunity_id);}));
  additions.forEach(function(r){
    var id=String(r.snapshot_period)+"|"+String(r.opportunity_id);
    if(existing.has(id)||!geoNonblank_(r.snapshot_id)) throw geoSchemaError_("SNAPSHOT_DUPLICATE",id);
    existing.add(id);
  });
  var backup=ws.copyTo(book);
  backup.setName("_GEO_Snapshot_Recovery_"+new Date().getTime());
  var committed=false;
  try {
    store.writeDirty_(change);
    SpreadsheetApp.flush();
    if(ws.getLastRow()!==t.rows.length+1)
      throw geoSchemaError_("SNAPSHOT_WRITE_INCOMPLETE","Canonical snapshot row count mismatch");
    committed=true;
  }catch(err){
    // Same-workbook recovery keeps the technical historical state, including old rows.
    try{
      var values=backup.getDataRange().getValues();
      ws.clearContents();
      if(ws.getMaxRows()<values.length)ws.insertRowsAfter(ws.getMaxRows(),values.length-ws.getMaxRows());
      if(ws.getMaxColumns()<values[0].length)ws.insertColumnsAfter(ws.getMaxColumns(),values[0].length-ws.getMaxColumns());
      ws.getRange(1,1,values.length,values[0].length).setValues(values);
      SpreadsheetApp.flush();
      book.deleteSheet(backup);
    }catch(restoreErr){
      console.error("SNAPSHOT_MANUAL_RECOVERY_REQUIRED: "+restoreErr.message+
        " -- protected backup tab remains in Reporting workbook");
      err.publicCode="SNAPSHOT_MANUAL_RECOVERY_REQUIRED";
      throw err;
    }
    err.publicCode=err.publicCode||"SNAPSHOT_PERSIST_FAILED";
    throw err;
  }finally{
    if(committed){
      try{book.deleteSheet(backup);}catch(e){
        console.warn("Committed Snapshot backup needs cleanup: "+e.message);
      }
    }
  }
  try {
    var projection=geoPublishRegionalSnapshots_(store,additions);
    PropertiesService.getScriptProperties().deleteProperty("GEO_SNAPSHOT_PROJECTION_ERROR");
    return {captured:additions.length,projection:projection};
  }catch(e){
    // Do not roll back committed canonical history because a derived report failed.
    console.error("SNAPSHOT_REPORT_PROJECTION_REPAIR_NEEDED: "+e.message);
    PropertiesService.getScriptProperties().setProperty(
      "GEO_SNAPSHOT_PROJECTION_ERROR",String(e.message).slice(0,300));
    return {captured:additions.length,projection_error:true};
  }
}
