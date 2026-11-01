// Import-only historical date normalizer. Never applied to normal web Create/Edit.
// Day-first numeric dates are explicitly approved for these Thai source workbooks.
const THAI_MONTHS = [
  ["มค","มกราคม"],["กพ","กุมภาพันธ์"],["มีค","มีนาคม"],["เมย","เมษายน"],
  ["พค","พฤษภาคม"],["มิย","มิถุนายน"],["กค","กรกฎาคม"],["สค","สิงหาคม"],
  ["กย","กันยายน"],["ตค","ตุลาคม"],["พย","พฤศจิกายน"],["ธค","ธันวาคม"],
];
const ENGLISH_MONTHS = [
  ["jan","january"],["feb","february"],["mar","march"],["apr","april"],
  ["may"],["jun","june"],["jul","july"],["aug","august"],
  ["sep","sept","september"],["oct","october"],["nov","november"],["dec","december"]
];
function monthNameIndex(s) {
  const clean=String(s??"").trim().toLowerCase().replace(/[.\s_\-]/g,"");
  const th=THAI_MONTHS.findIndex(v=>v.includes(clean));
  if(th>=0)return th+1;
  const en=ENGLISH_MONTHS.findIndex(v=>v.includes(clean));
  return en>=0?en+1:null;
}
function yearValue(v) {
  const s=String(v??"").trim();
  if(!/^\d{2}(\d{2})?$/.test(s))return null;
  let y=Number(s);
  if(s.length===2)y = y<=49?2000+y:1900+y;
  if(y>=2400&&y<=2700)y-=543; // explicit Thai Buddhist-calendar years
  return y>=1900&&y<=2100?y:null;
}
function isoDate(y,m,d) {
  if(!y||!m||!d)return null;
  const t=new Date(Date.UTC(y,m-1,d));
  if(t.getUTCFullYear()!==y||t.getUTCMonth()!==m-1||t.getUTCDate()!==d)return null;
  return String(y).padStart(4,"0")+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0");
}
// Returns null on ambiguous/unproven date; empty input stays empty, not import time.
export function normalizeHistoricalDate(value) {
  if(value===null||value===undefined||value==="")return "";
  if(value instanceof Date) return Number.isNaN(value.getTime())?null:
    isoDate(value.getUTCFullYear(),value.getUTCMonth()+1,value.getUTCDate());
  const text=String(value).trim();
  if(!text)return "";
  const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if(iso)return isoDate(yearValue(iso[1]),Number(iso[2]),Number(iso[3]));
  // Excel 1900-date serials in the realistic modern calendar range.
  if(/^\d{5}(?:\.\d+)?$/.test(text)){
    const days=Math.floor(Number(text));
    if(days>=25000&&days<=80000){
      const t=new Date(Date.UTC(1899,11,30)+days*86400000);
      return isoDate(t.getUTCFullYear(),t.getUTCMonth()+1,t.getUTCDate());
    }
  }
  const numeric=/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if(numeric)return isoDate(yearValue(numeric[3]),Number(numeric[2]),Number(numeric[1]));
  const name=/^(\d{1,2})[\- /\s]+([^\d]+?)[\- /\s]+(\d{2}|\d{4})$/.exec(text);
  if(name)return isoDate(yearValue(name[3]),monthNameIndex(name[2]),Number(name[1]));
  return null;
}
export function normalizeHistoricalMonth(value) {
  if(value===null||value===undefined||value==="")return "";
  const text=String(value).trim();
  if(!text)return "";
  if(/^\d{4}-(0[1-9]|1[0-2])$/.test(text)){
    const y=Number(text.slice(0,4));
    return y>=1900&&y<=2100?text:null;
  }
  const date=normalizeHistoricalDate(value);
  if(date!==null&&date)return date.slice(0,7);
  const m=/^([^\d]+?)[\s_\-]+(\d{2}|\d{4})$/.exec(text);
  if(m){
    const month=monthNameIndex(m[1]),year=yearValue(m[2]);
    return month&&year?String(year)+"-"+String(month).padStart(2,"0"):null;
  }
  return null;
}
