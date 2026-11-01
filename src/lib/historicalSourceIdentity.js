// Pure, import-only technical identity for one original Excel workbook row.
// Preserve the incoming legacy Source Record ID separately as provenance.
// No customer, Business ID, sales owner, product, or stage enters this identity.
const VERIFIED_SOURCE_NAMES = Object.freeze({
  "pipeline bma east": "BMA-E",
  "pipeline bma east-2": "BMA-E",
  "pipeline bma west": "BMA-W",
  "pipeline bma west-2": "BMA-W",
  "pipeline cw": "CW",
  "pipeline cw-2": "CW",
  "pipeline east": "E",
  "pipeline north": "N",
  "pipeline ne1": "NE1",
  "pipeline ne2": "NE2",
  "pipeline south": "S"
});
function workbookBase(input) {
  const base=String(input||"").trim().replace(/\\/g,"/").split("/").pop()
    .replace(/\.xlsx?$/i,"").replace(/\s*\(\d+\)\s*$/,"")
    .replace(/[\s_]+/g," ").toLowerCase().trim();
  return base;
}
export function historicalRegionForWorkbook(filename) {
  const base=workbookBase(filename);
  return Object.prototype.hasOwnProperty.call(VERIFIED_SOURCE_NAMES,base)
    ? VERIFIED_SOURCE_NAMES[base] : null;
}
export function originalSourceIdentity(input) {
  const source=String(input.source_system||"").trim();
  const filename=String(input.source_workbook||"").trim();
  const row=String(input.source_row??"").trim();
  const alias=String(input.source_legacy_record_id??input.source_record_id??"").trim();
  if(source!=="Legacy Spreadsheet" || (!filename && !row))return {...input};
  if(!filename||!row)throw new Error("Source workbook and Original Excel Row must be supplied together");
  if(!historicalRegionForWorkbook(filename))
    throw new Error("Original source workbook does not match an approved regional file");
  if(!/^[1-9]\d{0,5}$/.test(row)||Number(row)<2)
    throw new Error("Source Row must be an original Excel data-row number (2 or greater)");
  const sheet=String(input.source_sheet||"Pipeline").trim();
  if(sheet!=="Pipeline")throw new Error("Only the approved Pipeline source tab can be imported");
  const basename=workbookBase(filename);
  // Direct, human-verifiable, collision-free encoding of the canonical workbook
  // basename and physical row. Copy suffix (1) is not a different source file.
  const id="ROW|"+basename.toUpperCase()+"|Pipeline|"+String(Number(row));
  return {...input,source_record_id:id,source_legacy_record_id:alias,
    source_workbook:filename,source_row:String(Number(row)),source_sheet:sheet};
}
