import React, {useCallback,useEffect,useState} from "react";
import { Bell, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { db } from "@/api/client";

// Not a generic alerts system: only explicit handler changes create notifications.
// The server filters by authenticated recipient, never by a browser-supplied user ID.
export default function HandoffBell({userId}) {
  const navigate=useNavigate();
  const [open,setOpen]=useState(false);
  const [data,setData]=useState({items:[],unread_count:0});
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{
    try{
      const result=await db.notifications.list();
      setData(result);setError("");
    }catch(e){setError(e.message || "Could not load handoff notifications");}
  },[]);
  useEffect(()=>{
    if(!userId){setData({items:[],unread_count:0});return;}
    refresh();
    const interval=setInterval(()=>{if(document.visibilityState==="visible")refresh();},60000);
    const focus=()=>refresh();
    window.addEventListener("focus",focus);
    return ()=>{clearInterval(interval);window.removeEventListener("focus",focus);};
  },[userId,refresh]);
  const openItem=async(item)=>{
    if(busy)return;
    setBusy(true);
    try{
      await db.notifications.markRead(item.id);
      await refresh();
      setOpen(false);
      navigate("/opportunity/"+encodeURIComponent(item.opportunity_id));
    }catch(e){setError(e.message || "Unable to mark as read");}
    finally{setBusy(false);}
  };
  return <div className="relative">
    <button type="button" aria-label={`Handoff notifications, ${data.unread_count} unread`}
      aria-expanded={open} onClick={()=>{setOpen(v=>!v);if(!open)refresh();}}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border hover:bg-secondary/70">
      <Bell className="w-[18px] h-[18px]" />
      {data.unread_count>0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 rounded-full bg-red-600 px-1 text-[10px] font-bold text-white flex items-center justify-center">
        {data.unread_count>99?"99+":data.unread_count}
      </span>}
    </button>
    {open && <div role="region" aria-label="Handoff notifications" className="absolute right-0 top-11 z-50 w-[min(350px,90vw)] rounded-xl border border-border bg-card shadow-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <strong className="text-sm">Handoff Notifications</strong>
        <button type="button" aria-label="Refresh notifications" className="p-1 rounded hover:bg-secondary" onClick={refresh}><RefreshCw className="h-4 w-4"/></button>
      </div>
      {error && <p role="alert" className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="max-h-80 overflow-auto space-y-1">
        {!data.items.length && <p className="text-xs text-muted-foreground py-4 text-center">ยังไม่มีรายการแจ้งเตือน</p>}
        {data.items.map(item=><button type="button" key={item.id} disabled={busy} onClick={()=>openItem(item)}
          className={`w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-secondary/70 ${!item.read_at?"bg-red-50/60":""}`}>
          <span className="font-semibold">ได้รับ Handoff · {item.opportunity_id}</span>
          <span className="block text-muted-foreground mt-1">จาก {item.actor_name} · {new Date(item.created_at).toLocaleString("th-TH")}</span>
          {!item.read_at && <span className="text-red-600 text-[11px]">ยังไม่อ่าน</span>}
        </button>)}
      </div>
      <p className="pt-2 border-t mt-2 text-[11px] text-muted-foreground">แสดงเฉพาะการส่งต่องานถึงคุณ · ตรวจสอบทุก 1 นาที</p>
    </div>}
  </div>;
}
