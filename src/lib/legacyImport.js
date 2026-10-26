// Strict, import-only conversions for old GEO spreadsheets.
// Never infer sales activity, stage-entered dates or historical closure events.
export function legacyNumber(value) {
  const text = String(value ?? "").replace(/\u00a0/g, " ").trim();
  if (!text) return null;
  // Valid 1,200.50 or 1200.50 only; no currency, formulas or ambiguous separators.
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text.replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

export function legacyContractMonths(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{1,3})\s*(?:month|months|เดือน)?$/i.exec(text);
  const number = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(number) && number >= 1 && number <= 120 ? number : null;
}

export function legacyStageName(value) {
  const text = String(value ?? "").trim();
  // Extract stage NUMBER only. Historical (50%) is NOT the live weight.
  const match = /^stage\s*([1-9]\d*)(?=$|\s|[.:\-])/i.exec(text);
  return match ? "Stage " + Number(match[1]) : text;
}

export function legacyCustomerType(value) {
  const text = String(value ?? "").trim();
  return /^others$/i.test(text) ? "Other" : text;
}

export function legacyProductCategory(value) {
  const text = String(value ?? "").trim();
  return /^broadband$/i.test(text) ? "TOL" : text;
}

export function legacySourceMonth(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})$/.exec(raw);
  if (iso) {
    const year = Number(iso[1]),month=Number(iso[2]);
    return year>=1900&&year<=2100&&month>=1&&month<=12 ? raw : null;
  }
  const named = /^([A-Za-z]{3,9})[-\/\s]+(\d{2}|\d{4})$/.exec(raw);
  if (!named) return null;
  const names=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const mon=names.indexOf(named[1].slice(0,3).toLowerCase())+1;
  const n=Number(named[2]),y=named[2].length===2?(n<=69?2000+n:1900+n):n;
  return mon&&y>=1900&&y<=2100?String(y)+"-"+String(mon).padStart(2,"0"):null;
}

export function legacyBusinessId(value) {
  // Blank and non-13-digit numeric IDs are valid for historical records only.
  const text=String(value ?? "").replace(/\u00a0/g," ").trim();
  if (!text) return "";
  return /^\d{1,40}$/.test(text)?text:null;
}

// The same workbook contents (including its row order) produce the same identity
// on a fresh upload, without exposing personal data or relying on the filename.
export async function legacySourceDocumentId(headers, rows) {
  const payload=JSON.stringify([headers,rows]);
  const bytes=new TextEncoder().encode(payload);
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("").slice(0,32);
}

export function legacyRowSourceId(documentId, sourceRowNumber) {
  if(!/^[a-f0-9]{32}$/.test(String(documentId))||!Number.isSafeInteger(sourceRowNumber)||sourceRowNumber<2)
    throw new Error("Invalid import row identity");
  return "DOC-"+documentId+"-R"+sourceRowNumber;
}
