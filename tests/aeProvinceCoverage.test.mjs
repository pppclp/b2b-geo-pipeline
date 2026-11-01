import test from "node:test";
import assert from "node:assert/strict";
import { OVERLAPPING_NE_REGIONS, selectAuthorizedRegions, provinceCoverageOptions, provinceCoverageMatch } from "../src/lib/aeProvinceCoverage.js";

const regions = [
  {id:"NE1",name:"Northeast1",order:1,active:true},
  {id:"NE2",name:"Northeast2",order:2,active:true},
  {id:"N",name:"North",order:3,active:true},
  {id:"X",name:"Hidden",order:4,active:false},
];
const members = [
  {id:"U0026",name:"Wachreewan Sudchumpar",app_role:"ae",active:true,region_ids:["NE1","NE2"],
   assigned_provinces:"Khon Kaen, Bueng Kan, Nong Khai, Sakon Nakhon, Nakhon Phanom, Udon Thani, Nong Bua Lamphu"},
  {id:"U0028",name:"Pornpimon Anunaree",app_role:"ae",active:true,region_ids:["NE1","NE2"],
   assigned_provinces:"Chaiyaphum, Loei, Nakhon Ratchasima, Buri Ram, Surin, Si Sa Ket"},
  {id:"U0008",name:"Umaporn Sornslub",app_role:"ae",active:true,region_ids:["NE1","NE2"],
   assigned_provinces:"Ubon Ratchathani, Kalasin, Mukdahan, Maha Sarakham, Roi Et, Yasothon, Amnat Charoen"},
];
test("NE1 and NE2 are both selectable by an AE or SM with both active permissions", () => {
  for(const app_role of ["ae","sm"]) {
    assert.deepEqual(selectAuthorizedRegions(regions,{app_role,region_ids:["NE1","NE2"]}).map(x=>x.id),["NE1","NE2"]);
    assert.deepEqual(selectAuthorizedRegions(regions,{app_role,region_ids:["NE1"]}).map(x=>x.id),["NE1"]);
  }
  assert.deepEqual(selectAuthorizedRegions(regions,{app_role:"admin",region_ids:[]}).map(x=>x.id),["NE1","NE2","N"]);
  assert.deepEqual(OVERLAPPING_NE_REGIONS,["NE1","NE2"]);
});
test("20 unique English provinces map to three AEs independently from Region choice", () => {
  const options=provinceCoverageOptions(members);
  assert.equal(options.length,20);
  assert.deepEqual(provinceCoverageMatch(options,"KHON KAEN").members,[{id:"U0026",name:"Wachreewan Sudchumpar"}]);
  assert.deepEqual(provinceCoverageMatch(options,"Si Sa Ket").members,[{id:"U0028",name:"Pornpimon Anunaree"}]);
  assert.deepEqual(provinceCoverageMatch(options,"Roi Et").members,[{id:"U0008",name:"Umaporn Sornslub"}]);
  assert.equal(provinceCoverageMatch(options,"Phuket"),null);
});
test("duplicate provinces remain explicitly multi-owner, never silently re-assigned",()=>{
  const shared=provinceCoverageOptions([...members,{id:"U9999",name:"Another AE",app_role:"ae",active:true,assigned_provinces:"Khon Kaen"}]);
  assert.deepEqual(provinceCoverageMatch(shared,"Khon Kaen").members.map(x=>x.id),["U0026","U9999"]);
});
