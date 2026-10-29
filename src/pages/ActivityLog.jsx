import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Filter, History, RotateCcw, Search, ChevronLeft, ChevronRight, Users, ArrowRight } from "lucide-react";
import { useData } from "@/lib/dataContext";
import { db } from "@/api/client";
import { formatDateTime } from "@/lib/pipeline";
import { safeCsvTable } from "@/lib/safeCsv";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ACTIONS = [
  ["","ทุกกิจกรรม"],
  ["create","สร้าง Pipeline"],
  ["stage_change","เปลี่ยน Stage"],
  ["handler_change","ส่งต่องาน"],
  ["reassign","เปลี่ยนเจ้าของงาน"],
  ["working_with_change","แก้ไข Working With"],
  ["close_month_change","เปลี่ยนเดือนที่คาดว่าจะปิด"],
  ["won","ปิดงานสำเร็จ"],
  ["lost","ปิดงานไม่สำเร็จ"],
  ["other","อื่น ๆ"],
];
const LABELS = Object.fromEntries(ACTIONS);
const PER_PAGE = 50;
function bangkokDay(date = new Date()) {
  return new Date(date.getTime() + 7*3600000).toISOString().slice(0,10);
}
function daysBack(days) {
  const date = new Date();
  return bangkokDay(new Date(date.getTime() - days * 86400000));
}
const INITIAL = {period:"7",region:"",role:"",actor_id:"",action:"",search:"",from:"",to:""};
const empty = {items:[],by_person:[],people:[],regions:[],total:0,next_offset:null};
function FilterSelect({label,value,onChange,options,disabled=false}) {
  return <label className="block min-w-0 space-y-1">
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <select className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
      value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}>
      {options.map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
  </label>;
}
function displayChange(entry) {
  const p=entry.previous_value,n=entry.new_value;
  if(p && n)return p+" → "+n;
  return n||p||"";
}
function formatAction(e) {
  return LABELS[e.action] || e.event_type || "อัปเดตข้อมูล";
}
export default function ActivityLog() {
  const {profile,maps} = useData();
  const allowed=["sm","management","admin"].includes(profile?.app_role);
  const isSm=profile?.app_role==="sm";
  const [filters,setFilters]=useState(INITIAL);
  const [view,setView]=useState("activity");
  const [offset,setOffset]=useState(0);
  const [data,setData]=useState(empty);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [reload,setReload]=useState(0);
  const [exporting,setExporting]=useState(false);
  const [showFilters,setShowFilters]=useState(false);
  const [expanded,setExpanded]=useState("");
  const [exportError,setExportError]=useState("");
  const actualFrom=filters.period==="custom"?filters.from:filters.period==="all"?"":daysBack(Number(filters.period)-1);
  const actualTo=filters.period==="custom"?filters.to:filters.period==="all"?"":bangkokDay();
  const query=useMemo(()=>({
    from:actualFrom,to:actualTo,region:filters.region,role:isSm?"ae":filters.role,
    actor_id:filters.actor_id,action:filters.action,search:filters.search.trim(),limit:PER_PAGE,offset,
  }),[actualFrom,actualTo,filters.region,filters.role,filters.actor_id,filters.action,filters.search,isSm,offset]);
  useEffect(()=>{
    if(!allowed){setLoading(false);return;}
    if(filters.period==="custom" && (!filters.from||!filters.to)){setLoading(false);setData(empty);return;}
    let active=true;
    setLoading(true);setError("");
    db.activity.list(query).then(result=>{if(active)setData(result);})
      .catch(e=>{if(active){setData(empty);setError(e.message||"ไม่สามารถโหลด Activity Log ได้");}})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false};
  },[allowed,query,filters.period,filters.from,filters.to,reload]);
  const set=(key,value)=>{
    setFilters(old=>({...old,[key]:value,
      ...(key==="region"||key==="role"?{actor_id:""}:{})}));
    setOffset(0);setExpanded("");
  };
  const reset=()=>{setFilters(INITIAL);setOffset(0);setExpanded("");setError("");};
  const regionOptions=[["","ทุกภาค"],...(data.regions||[]).map(id=>[id,maps.region?.[id]?.name||id])];
  const personOptions=[["","ทุกคน"],...(data.people||[]).map(m=>[m.id,m.name+" · "+m.role.toUpperCase()])];
  async function exportCsv(){
    if(!allowed||!data.total||data.total>2000)return;
    setExportError("");setExporting(true);
    try{
      const rows=[];let current=0;
      while(current<data.total){
        const response=await db.activity.list({...query,offset:current,limit:100});
        if(!response.items?.length)throw new Error("ข้อมูลส่งออกไม่ครบ กรุณาลองใหม่");
        rows.push(...response.items);current+=response.items.length;
      }
      const headers=["เวลา","ผู้ดำเนินการ","Role (current)","Region (current Pipeline)","Pipeline ID","ลูกค้า","กิจกรรม","Field","ค่าเดิม","ค่าใหม่","หมายเหตุ"];
      const values=rows.map(e=>[formatDateTime(e.event_at),e.actor_name,e.actor_role,maps.region?.[e.region_id]?.name||e.region_id,
        e.opportunity_id,e.customer_name,formatAction(e),e.field,e.previous_value,e.new_value,e.remark]);
      const blob=new Blob(["\uFEFF"+safeCsvTable(headers,values)],{type:"text/csv;charset=utf-8;"});
      const url=URL.createObjectURL(blob);
      const anchor=document.createElement("a");anchor.href=url;anchor.download="activity_log_"+bangkokDay()+".csv";anchor.click();
      URL.revokeObjectURL(url);
    }catch(e){setExportError(e.message||"ส่งออกข้อมูลไม่สำเร็จ");}
    finally{setExporting(false);}
  }
  if(!allowed)return <section className="p-6"><h1 className="text-xl font-semibold">Activity Log</h1><p role="alert" className="mt-2 text-sm text-muted-foreground">คุณไม่มีสิทธิ์เข้าถึง Activity Log</p></section>;
  return <div className="mx-auto max-w-[1200px] p-4 sm:p-6 lg:p-7 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">ประวัติการดำเนินงานของทีม · {isSm?"กิจกรรม AE ในภาคที่รับผิดชอบ":profile?.app_role==="management"?"กิจกรรม AE และ SM ทุกภาค":"กิจกรรมตามสิทธิ์ Admin"}</p>
      </div>
      <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting||loading||!data.total||data.total>2000}>
        <Download className="mr-1.5 h-4 w-4"/>{exporting?"กำลังส่งออก...":"Export CSV"}
      </Button>
    </div>
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between gap-2 sm:mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Filter className="h-4 w-4"/> Filters</h2>
        <Button variant="outline" size="sm" className="sm:hidden" onClick={()=>setShowFilters(v=>!v)} aria-expanded={showFilters}>
          {showFilters?"ซ่อน Filters":"แสดง Filters"}
        </Button>
      </div>
      <div className={showFilters?"mt-3 space-y-3 sm:mt-0":"hidden sm:block"}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FilterSelect label="ช่วงเวลา" value={filters.period} onChange={v=>set("period",v)}
            options={[["7","7 วันล่าสุด"],["30","30 วันล่าสุด"],["custom","กำหนดช่วงวันที่"],["all","ทั้งหมด"]]}/>
          {isSm?<div className="space-y-1"><div className="text-xs font-medium text-muted-foreground">ภาค</div>
            <div className="flex h-9 items-center rounded-lg bg-secondary px-3 text-sm">ตามสิทธิ์ SM</div></div>:
            <FilterSelect label="ภาค" value={filters.region} onChange={v=>set("region",v)} options={regionOptions}/>}
          {!isSm&&<FilterSelect label="Role (ปัจจุบัน)" value={filters.role} onChange={v=>set("role",v)}
            options={profile?.app_role==="admin"?[["","ทุก Role"],["ae","AE"],["sm","SM"],["management","Management"],["admin","Admin"]]:[["","AE + SM"],["ae","AE"],["sm","SM"]]}/>}
          <FilterSelect label="ผู้ดำเนินการ" value={filters.actor_id} onChange={v=>set("actor_id",v)} options={personOptions}/>
          <FilterSelect label="ประเภทกิจกรรม" value={filters.action} onChange={v=>set("action",v)} options={ACTIONS}/>
        </div>
        {filters.period==="custom"&&<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <label className="space-y-1 block"><span className="text-xs text-muted-foreground">ตั้งแต่วันที่</span><Input type="date" value={filters.from} onChange={e=>set("from",e.target.value)}/></label>
          <label className="space-y-1 block"><span className="text-xs text-muted-foreground">ถึงวันที่</span><Input type="date" value={filters.to} onChange={e=>set("to",e.target.value)}/></label>
        </div>}
        <div className="flex flex-wrap items-end gap-3 pt-2">
          <label className="min-w-[180px] flex-1 space-y-1"><span className="text-xs text-muted-foreground">ค้นหา Pipeline ID, ชื่อลูกค้า หรือผู้ดำเนินการ</span>
            <span className="relative block"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/>
              <Input className="pl-9" placeholder="ค้นหากิจกรรม..." value={filters.search} onChange={e=>set("search",e.target.value)} maxLength={120}/></span>
          </label>
          <Button size="sm" variant="ghost" onClick={reset}><RotateCcw className="mr-1.5 h-4 w-4"/>ล้างตัวกรอง</Button>
        </div>
      </div>
    </section>
    <section className="rounded-xl border border-border bg-card p-4 shadow-soft space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Activity views" className="inline-flex rounded-lg border border-border bg-secondary p-1 gap-1">
          {[[ "activity","All Activity" ],["person","By Person"]].map(([value,label])=>
            <button role="tab" key={value} type="button" aria-selected={view===value} onClick={()=>{setView(value);setExpanded("");}}
              className={"px-3 py-1.5 text-sm rounded-md "+(view===value?"bg-card shadow-sm font-medium":"text-muted-foreground")}>{label}</button>)}
        </div>
        <span className="text-xs text-muted-foreground">{data.total.toLocaleString()} กิจกรรม{data.total>2000?" · Export จำกัด 2,000 รายการ":""}</span>
      </div>
      {error&&<p role="alert" className="text-sm text-destructive">{error} <Button variant="ghost" size="sm" onClick={()=>setReload(v=>v+1)}>ลองใหม่</Button></p>}
      {exportError&&<p role="alert" className="text-sm text-destructive">{exportError}</p>}
      {filters.period==="custom"&&(!filters.from||!filters.to)?<p className="py-10 text-center text-sm text-muted-foreground">เลือกวันที่เริ่มต้นและวันที่สิ้นสุดเพื่อดู Activity</p>:
      loading?<p role="status" className="py-10 text-center text-sm text-muted-foreground">กำลังโหลด Activity Log...</p>:
      view==="activity"?<div className="space-y-2">
        {!data.items?.length&&<p className="py-8 text-center text-sm text-muted-foreground">ไม่พบกิจกรรมตามตัวกรองที่เลือก</p>}
        {(data.items||[]).map(e=><article key={e.id} className="rounded-lg border border-border p-3 sm:p-4">
          <div className="flex flex-wrap justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">{formatAction(e)}</strong>
                <span className="text-[10px] rounded border px-1.5 py-0.5 text-muted-foreground">{e.actor_role.toUpperCase()}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{e.actor_name} · {maps.region?.[e.region_id]?.name||e.region_id||"ไม่ระบุภาค"}</p>
            </div>
            <span className="text-xs text-muted-foreground">{formatDateTime(e.event_at)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium">{e.opportunity_id}</span>
            <span className="min-w-0 break-words">{e.customer_name||"—"}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-words text-xs text-muted-foreground">{displayChange(e)||"บันทึกกิจกรรม"}</p>
            <Button size="sm" variant="ghost" onClick={()=>setExpanded(x=>x===e.id?"":e.id)} aria-expanded={expanded===e.id}>
              {expanded===e.id?"ซ่อนรายละเอียด":"ดูรายละเอียด"}
            </Button>
          </div>
          {expanded===e.id&&<div className="mt-3 border-t pt-3 text-xs space-y-1.5">
            {e.field&&<p><span className="text-muted-foreground">Field:</span> {e.field}</p>}
            {e.previous_value&&<p><span className="text-muted-foreground">ก่อน:</span> {e.previous_value}</p>}
            {e.new_value&&<p><span className="text-muted-foreground">หลัง:</span> {e.new_value}</p>}
            {e.remark&&<p className="break-words"><span className="text-muted-foreground">หมายเหตุ:</span> {e.remark}</p>}
            <Link className="inline-flex items-center gap-1 text-brand font-medium" to={"/opportunity/"+encodeURIComponent(e.opportunity_id)}>เปิด Pipeline <ArrowRight className="h-3.5 w-3.5"/></Link>
          </div>}
        </article>)}
        {data.total>PER_PAGE&&<div className="flex justify-between items-center pt-3">
          <Button size="sm" variant="outline" disabled={offset===0} onClick={()=>setOffset(x=>Math.max(0,x-PER_PAGE))}><ChevronLeft className="mr-1 h-4 w-4"/>ก่อนหน้า</Button>
          <span className="text-xs text-muted-foreground">{offset+1}–{Math.min(offset+PER_PAGE,data.total)} / {data.total}</span>
          <Button size="sm" variant="outline" disabled={data.next_offset==null} onClick={()=>setOffset(data.next_offset)} >ถัดไป <ChevronRight className="ml-1 h-4 w-4"/></Button>
        </div>}
      </div>:<div className="space-y-2">
        {!data.by_person?.length&&<p className="py-8 text-center text-sm text-muted-foreground">ไม่พบผู้ดำเนินการตามตัวกรอง</p>}
        {(data.by_person||[]).map(p=><button type="button" key={p.actor_id}
          onClick={()=>{set("actor_id",p.actor_id);setView("activity");}}
          className="w-full rounded-lg border border-border p-3 text-left hover:bg-secondary/40">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"><Users className="h-4 w-4"/></span>
              <div><div className="text-sm font-medium">{p.actor_name} <span className="ml-1 text-[10px] text-muted-foreground">{p.actor_role.toUpperCase()}</span></div>
                <div className="text-xs text-muted-foreground">{p.region_id?(maps.region?.[p.region_id]?.name||p.region_id):"หลายภาค"} · ล่าสุด {formatDateTime(p.latest)}</div>
              </div>
            </div>
            <div className="text-right"><strong className="text-lg tabular-nums">{p.count}</strong>
              <p className="text-[11px] text-muted-foreground">{p.pipeline_count} Pipelines · ดูกิจกรรม</p></div>
          </div>
        </button>)}
      </div>}
    </section>
    <p className="text-[11px] text-muted-foreground flex items-start gap-1.5"><History className="h-3.5 w-3.5 mt-0.5 shrink-0"/>
      Activity Log เป็นประวัติการแก้ไข Pipeline ไม่ใช่ประวัติ Login หรือคะแนนผลงาน Role/Region อ้างอิงข้อมูลปัจจุบัน ไม่ใช่ตำแหน่งหรือภาคย้อนหลังขณะเกิด Event</p>
  </div>;
}
