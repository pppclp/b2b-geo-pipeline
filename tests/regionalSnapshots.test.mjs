import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { buildSnapshotRows } from "../server/snapshot.js";

// Synthetic-only regression coverage. No Google Drive/Sheets calls or real customer data.
function context() {
  const ctx = {
    console: {log(){},warn(){},error(){}},
    PropertiesService: {getScriptProperties:()=>({getProperty:()=>null})},
  };
  runInNewContext(readFileSync(new URL("../apps-script/Main.js",import.meta.url),"utf8"),ctx);
  runInNewContext(readFileSync(new URL("../apps-script/RegionalSnapshots.js",import.meta.url),"utf8"),ctx);
  return ctx;
}

test("regional workbook has all eight canonical Region ID mappings and exactly 30 visible columns",()=>{
  const c=context();
  assert.equal(Object.keys(c.GEO_REGION_SHEETS_).length,8);
  assert.equal(c.GEO_REGION_SHEETS_["BMA-E"],"BMA-East");
  assert.equal(c.GEO_REGION_SHEETS_["BMA-W"],"BMA-West");
  assert.equal(c.GEO_REGION_SHEETS_["CW"],"Central-West");
  assert.equal(c.GEO_REGION_SHEETS_["NE1"],"Northeast1");
  assert.equal(c.GEO_REGION_SHEETS_["NE2"],"Northeast2");
  assert.equal(c.GEO_REPORT_HEADERS_.length,30);
  assert.equal(c.GEO_REPORT_HEADERS_[0],"Snapshot Period");
  assert.equal(c.GEO_REPORT_HEADERS_[2],"Opportunity ID");
  assert.equal(c.GEO_REPORT_HEADERS_[19],"Net RC");
  assert.equal(c.GEO_REPORT_HEADERS_[28],"Working With");
  assert.equal(c.GEO_TECHNICAL_SNAPSHOT_HEADERS_.length,50);
  assert.equal(c.GEO_TECHNICAL_SNAPSHOT_HEADERS_[49],"working_with_id");
});

test("server captures a frozen Working With assignment without changing original snapshot columns",()=>{
  const item={opportunity_id:"OPP_TEST",status:"Open",region_id:"NE1",pipeline_value:150,
    working_with_id:"WW005"};
  const frozen=buildSnapshotRows([item],"2026-10","captured",()=> "SNP_TEST");
  assert.equal(frozen[0].working_with_id,"WW005");
  item.working_with_id="WW001";
  assert.equal(frozen[0].working_with_id,"WW005");
});

test("regional projection maps all 30 display fields with preserved identity and original amounts",()=>{
  const c=context();
  const row={snapshot_period:"2026-10",captured_at:"2026-11-01T02:00:00+07:00",
    opportunity_id:"OPP_TEST",created_month:"2026-07",business_id:"0000123",
    customer_type:"Industrial",customer_name:"Synthetic Client",
    contact_name:"Test Contact",contact_phone:"0812345678",owner_sales_code:"00123",
    owner_sale_name:"Synthetic AE",sales_channel:"AE B2B GEO",partner_name:"",
    region_id:"NE1",customer_location_text:"Sample Province",
    product_category_id:"CAT001",product_details:"SIM Only",quantity:4,
    import_source_rc:399,import_source_net_rc:1496,pipeline_value:1496,oc:0,
    contract_period_months:12,stage_id:"STG003",status:"Won",
    expected_close_month:"2026-10",scenario_id:"SC002",
    ccp_check_result:"Yes",current_handler_user_id:"U2",
    working_with_id:"WW005",remark:"Synthetic test only"};
  const lookups={users:{U2:"Synthetic SM"},products:{CAT001:"TOL"},
    stages:{STG003:"Stage 3"},scenarios:{SC002:"S2"},teams:{WW005:"Management"}};
  const output=c.geoProjectSnapshotRow_(row,lookups);
  assert.equal(output.length,30);
  assert.equal(output[4],"0000123");
  assert.equal(output[8],"0812345678");
  assert.equal(output[9],"00123");
  assert.equal(output[13],"Northeast1");
  assert.equal(output[18],399);
  assert.equal(output[19],1496);
  assert.equal(output[22],"Stage 3");
  assert.equal(output[23],"Won");
  assert.equal(output[25],"S2");
  assert.equal(output[27],"Synthetic SM");
  assert.equal(output[28],"Management");
  assert.equal(output[29],"Synthetic test only");
});

test("reporting workbook fail-closes if canonical technical Snapshots tab is missing",()=>{
  const c=context();
  const reportSheets=new Map(Object.values(c.GEO_REGION_SHEETS_).map(name=>[
    name,{getLastRow:()=>1,getLastColumn:()=>30,
      getRange:()=>({getValues:()=>[Array.from(c.GEO_REPORT_HEADERS_)]})}
  ]));
  const book={getName:()=>c.GEO_REPORT_TITLE_,getSheetByName:n=>reportSheets.get(n)||null};
  assert.throws(()=>c.geoAssertRegionalSnapshotSchema_({_geoReportBook:book}),
    e=>e.status===503&&e.publicCode==="REQUIRED_SHEET_MISSING");
  const canonical={getLastRow:()=>1,getLastColumn:()=>50,
    getRange:()=>({getValues:()=>[Array.from(c.GEO_TECHNICAL_SNAPSHOT_HEADERS_)]})};
  reportSheets.set("Snapshots",canonical);
  assert.equal(c.geoAssertRegionalSnapshotSchema_({_geoReportBook:book}),canonical);
  reportSheets.delete("South");
  assert.throws(()=>c.geoAssertRegionalSnapshotSchema_({_geoReportBook:book}),
    e=>e.status===503&&e.publicCode==="REQUIRED_SHEET_MISSING");
});
