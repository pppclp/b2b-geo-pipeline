import React from "react";
import {Checkbox} from "@/components/ui/checkbox";

// Uses comma-separated stable master IDs in the Pipeline row. Original legacy
// working_with_id remains untouched unless the user changes the selection.
export const splitWorkingIds=(value)=>String(value||"").split(",").map(x=>x.trim()).filter(Boolean);
export default function WorkingWithMultiSelect({teams=[],people=[],regionId,teamIds="",userIds="",disabled=false,onTeams,onUsers}){
  const activeTeams=teams.filter(t=>t.active||splitWorkingIds(teamIds).includes(t.id));
  const activePeople=people.filter(p=>p.active&&(p.region_ids||[]).includes(regionId) || splitWorkingIds(userIds).includes(p.id));
  const toggle=(value,id,callback)=>{
    const current=new Set(splitWorkingIds(value));
    current.has(id)?current.delete(id):current.add(id);
    callback([...current].join(","));
  };
  return <div className="min-w-0 space-y-3 rounded-xl border border-border p-3 bg-secondary/20">
    <div>
      <p className="text-xs font-semibold mb-2">Teams · เลือกได้หลายทีม</p>
      <div className="grid grid-cols-1 gap-2">
        {activeTeams.map(t=><label key={t.id} className="flex min-w-0 gap-2 items-start text-xs cursor-pointer">
          <Checkbox className="h-4 w-4 shrink-0 rounded-sm" disabled={disabled} checked={splitWorkingIds(teamIds).includes(t.id)} onCheckedChange={()=>toggle(teamIds,t.id,onTeams)}/>
          <span className="min-w-0 break-words">{t.name}</span>
        </label>)}
        {!activeTeams.length&&<span className="text-xs text-muted-foreground">No team options</span>}
      </div>
    </div>
    <div className="border-t pt-3">
      <p className="text-xs font-semibold mb-2">People · เลือกได้หลายคนใน Region</p>
      <div className="grid grid-cols-1 gap-2 max-h-44 overflow-auto">
        {activePeople.map(p=><label key={p.id} className="flex gap-2 items-center text-xs cursor-pointer">
          <Checkbox disabled={disabled} checked={splitWorkingIds(userIds).includes(p.id)} onCheckedChange={()=>toggle(userIds,p.id,onUsers)}/>
          <span className="min-w-0 break-words">{p.name} ({p.app_role?.toUpperCase()})</span>
        </label>)}
        {!activePeople.length&&<span className="text-xs text-muted-foreground">No people for this Region</span>}
      </div>
    </div>
  </div>;
}
