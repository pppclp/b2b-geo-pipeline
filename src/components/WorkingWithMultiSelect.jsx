import React, { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown } from "lucide-react";

// The legacy person IDs remain stored in Sheets but are not editable in the UI.
// Team IDs are the only input to the Working With experience.
export const splitWorkingIds = (value) => String(value || "").split(",").map((id) => id.trim()).filter(Boolean);

export function sortedWorkingWithTeams(teams = [], teamIds = "") {
  const selected = new Set(splitWorkingIds(teamIds));
  return teams
    .filter((team) => team.active || selected.has(team.id))
    .slice()
    .sort((a, b) => {
      const otherA = /^other$/i.test(String(a.name || "").trim());
      const otherB = /^other$/i.test(String(b.name || "").trim());
      if (otherA !== otherB) return otherA ? 1 : -1;
      const an = Number(a.order), bn = Number(b.order);
      const hasOrder = Number.isFinite(an) && String(a.order ?? "").trim() !== "" && Number.isFinite(bn) && String(b.order ?? "").trim() !== "";
      if (hasOrder && an !== bn) return an - bn;
      if (/^management$/i.test(String(a.name || "")) && otherB) return -1;
      if (/^management$/i.test(String(b.name || "")) && otherA) return 1;
      return 0; // preserve master ordering otherwise
    });
}

export default function WorkingWithMultiSelect({ teams = [], teamIds = "", disabled = false, onTeams }) {
  const [open, setOpen] = useState(false);
  const ids = splitWorkingIds(teamIds);
  const options = sortedWorkingWithTeams(teams, teamIds);
  const selection = new Set(ids);
  const selected = options.filter((team) => selection.has(team.id));
  const update = (id) => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id);
    else if (next.size < 8) next.add(id);
    onTeams?.([...next].join(","));
  };

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}
          aria-label="Choose Working With teams"
          className="min-h-10 h-auto w-full justify-between gap-2 rounded-lg px-3 py-2 text-left font-normal">
          <span className="min-w-0 flex flex-wrap items-center gap-1.5">
            {selected.length ? selected.map((team) =>
              <span key={team.id} className="rounded-md bg-secondary px-2 py-1 text-xs font-medium">{team.name}</span>
            ) : <span className="text-muted-foreground">เพิ่มทีม</span>}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(340px,calc(100vw-40px))] p-2" sideOffset={4}>
        <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground">Working With · ทีมที่ร่วมดำเนินงาน</p>
        <div className="max-h-60 space-y-0.5 overflow-y-auto" role="group" aria-label="Working With teams">
          {options.map((team) =>
            <label key={team.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-secondary/70">
              <Checkbox checked={selection.has(team.id)} onCheckedChange={() => update(team.id)}
                disabled={!selection.has(team.id) && selection.size >= 8} />
              <span>{team.name}</span>
            </label>
          )}
          {options.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">No team options available</p>}
        </div>
        <div className="mt-2 flex items-center justify-between border-t px-2 pt-2">
          <span className="text-xs text-muted-foreground">{selection.size} of 8 selected</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
