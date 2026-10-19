import test from "node:test";
import assert from "node:assert/strict";
import {safeCsvCell,safeCsvTable} from "../src/lib/safeCsv.js";
test("escapes leading dangerous spreadsheet formulas",()=>{
  for (const payload of ["=1+2","+SUM(A1:A2)","-2+3","@SUM(A1:A2)"," \t=HYPERLINK(\"url\")"]) {
    assert.match(safeCsvCell(payload),/^"\x27/);
  }
});
test("escapes quotes and preserves harmless content including Thai",()=>{
  assert.equal(safeCsvCell('สวัสดี "โลก"'), '"สวัสดี ""โลก"""');
  assert.equal(safeCsvTable(["Name"],[["ordinary"]]),'"Name"\r\n"ordinary"');
});
