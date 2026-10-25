import React,{useCallback,useEffect,useMemo,useState} from "react";
import {useData} from "@/lib/dataContext";
import {db} from "@/api/client";
import {Button} from "@/components/ui/button";
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from "@/components/ui/select";
import {Textarea} from "@/components/ui/textarea";
import {Link,useSearchParams} from "react-router-dom";
import {RefreshCw,LifeBuoy} from "lucide-react";
import {filterSupportRequests,supportQueueCounts} from "@/lib/supportQueue";

const STATUSES=["Open","In Progress","Resolved"];
function SupportRow({item,management,viewerId,users,maps,onUpdated}){
  const [status,setStatus]=useState(item.status);
  const [assigned,setAssigned]=useState(item.assigned_to_user_id || "none");
  const [note,setNote]=useState(item.response_note || "");
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    setStatus(item.status);setAssigned(item.assigned_to_user_id || "none");
    setNote(item.response_note || "");
  },[item]);
  const save=async()=>{
    setSaving(true);setError("");
    try {
      await db.supportRequests.update(item.request_id,{
        status,assigned_to_user_id:assigned==="none"?"":assigned,response_note:note,
        expected_updated_at:item.updated_at
      });
      await onUpdated();
    } catch(e){setError(e.message || "Could not update Support Request");}
    finally{setSaving(false);}
  };
  const takeOwnership=async()=>{
    if(!management || item.assigned_to_user_id || !viewerId || saving)return;
    setSaving(true);setError("");
    try {
      await db.supportRequests.update(item.request_id,{
        assigned_to_user_id:viewerId,expected_updated_at:item.updated_at
      });
      await onUpdated();
    }catch(e){setError(e.message||"Could not assign this request");}
    finally{setSaving(false);}
  };
  const isResolved=item.status==="Resolved";
  return <article className="rounded-xl border border-border bg-card p-4 space-y-3">
    <div className="flex flex-wrap justify-between gap-2">
      <div className="min-w-0">
        <Link className="text-sm font-semibold hover:underline text-brand" to={`/opportunity/${encodeURIComponent(item.opportunity_id)}`}>
          {item.opportunity_id} · {maps?.category?.[item.request_type_id]?.name || maps?.supportType?.[item.request_type_id]?.name || "Support"}
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">Region {maps.region?.[item.region_id]?.name || item.region_id} · ขอโดย {item.source==="migration" ? "ข้อมูลเดิมจาก Support Needed" : (maps.member?.[item.requested_by_user_id]?.name || item.requested_by_user_id)}</p>
      </div>
      <span className={`text-xs font-medium h-fit rounded-md px-2 py-1 ${isResolved?"bg-green-50 text-green-700":"bg-amber-50 text-amber-700"}`}>{item.status}</span>
    </div>
    <p className="text-sm whitespace-pre-wrap">{item.note}</p>
    {!isResolved && !item.assigned_to_user_id && <p className="text-xs font-medium text-amber-700">Unassigned · Needs Management review</p>}
    {management && !isResolved && !item.assigned_to_user_id &&
      <Button size="sm" variant="outline" onClick={takeOwnership} disabled={saving || !viewerId}>
        {saving ? "Assigning…" : "Assign to Me"}
      </Button>}
    {management ? <div className="grid sm:grid-cols-2 gap-3">
      <div className="space-y-1">
        <label className="text-xs font-medium">Status</label>
        <Select disabled={isResolved||saving} value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue/></SelectTrigger><SelectContent>
            {STATUSES.map(x=><SelectItem value={x} key={x}>{x}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium">Management owner</label>
        <Select disabled={isResolved||saving} value={assigned} onValueChange={setAssigned}>
          <SelectTrigger><SelectValue placeholder="Select Management" /></SelectTrigger>
          <SelectContent><SelectItem value="none">Unassigned</SelectItem>
            {users.filter(m=>m.active&&["management","admin"].includes(m.app_role) &&
              (m.app_role==="admin" || (m.region_ids||[]).includes(item.region_id)))
              .map(m=><SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2 space-y-1">
        <label className="text-xs font-medium">Management response / resolution</label>
        <Textarea disabled={isResolved||saving} value={note} onChange={e=>setNote(e.target.value)} rows={2}
          placeholder="Record next action or resolution"/>
      </div>
      {!isResolved && <Button disabled={saving || (status!=="Open" && assigned==="none") || (status==="Resolved" && !note.trim())} onClick={save} className="w-fit">
        {saving?"Saving…":"Save Support Request"}</Button>}
    </div> : item.response_note ? <p className="text-xs rounded-lg bg-secondary p-3">Management: {item.response_note}</p>:null}
    {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
  </article>;
}

export default function SupportRequests(){
  const {profile,master,maps}=useData();
  const [requests,setRequests]=useState([]);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [searchParams,setSearchParams]=useSearchParams();
  const management=["management","admin"].includes(profile?.app_role);
  const allowedFilters=management?["unassigned","mine","active","resolved","all"]:["active","resolved","all"];
  const filter=allowedFilters.includes(searchParams.get("view"))?searchParams.get("view"):(management?"unassigned":"active");
  const reload=useCallback(async()=>{
    setLoading(true);setError("");
    try{setRequests(await db.supportRequests.list());}
    catch(e){setError(e.message || "Unable to load support requests");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{reload();},[reload,profile?.id]);
  const items=useMemo(()=>filterSupportRequests(requests,filter,profile?.id),[requests,filter,profile?.id]);
  const counts=useMemo(()=>supportQueueCounts(requests,profile?.id),[requests,profile?.id]);
  return <div className="max-w-5xl mx-auto p-5 md:p-7 space-y-5">
    <div className="flex flex-wrap gap-3 items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold">Support Requests</h1>
        <p className="text-sm text-muted-foreground mt-1">Track support ownership and resolution · Open → In Progress → Resolved</p>
      </div>
      <Button variant="outline" onClick={reload} disabled={loading}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Support request filters">
      {allowedFilters.map(x=><button type="button" key={x} onClick={()=>setSearchParams({view:x})}
        aria-pressed={filter===x}
        className={`rounded-lg px-3 py-1.5 text-xs border ${filter===x?"border-primary bg-brand-tint text-brand font-semibold":"border-border hover:bg-secondary"}`}>
        {({unassigned:"Unassigned",mine:"With Me",active:"Active",resolved:"Resolved",all:"All"})[x]} ({counts[x]})
      </button>)}
    </div>
    {loading&&<p className="text-sm text-muted-foreground">Loading support requests…</p>}
    {error&&<p className="text-sm text-red-600" role="alert">{error}</p>}
    {!loading&&!error&&!items.length&&<div className="py-16 text-center border border-dashed rounded-xl text-sm text-muted-foreground"><LifeBuoy className="w-6 h-6 mx-auto mb-2"/>ไม่มีคำขอในสถานะนี้</div>}
    <div className="grid gap-3">
      {!loading&&!error&&items.map(item=><SupportRow key={item.request_id} item={item} management={management}
        viewerId={profile?.id} users={master?.TeamMember||[]} maps={maps} onUpdated={reload}/>)}
    </div>
  </div>;
}
