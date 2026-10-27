import React from "react";
import { useData } from "@/lib/dataContext";
import { formatNetRc as formatTHB } from "@/lib/netRc";
import { formatMonth } from "@/lib/pipeline";
import { overdueReasons } from "@/lib/overdueSummary.js";
import OverdueTags from "@/components/OverdueTags";
import { smWorkingWithTeamLabels } from "@/lib/pipelineListPresentation";
import { AlertCircle, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

// Board cards are a compact overview. Full ownership, handoff and working-with
// history stays available in the shared Pipeline Quick View.
export default function PipelineCard({ op, onOpen, showRegion = false }) {
  const { maps, master, config, taskEntries } = useData();
  const owner = maps.member[op.owner_id];
  const handler = maps.member[op.current_handler_id];
  const category = maps.category[op.product_category_id];
  const overdue = overdueReasons(op, maps.stage, config?.stage_watch_days, taskEntries).any;
  const differentHandler = op.current_handler_id !== op.owner_id && Boolean(op.current_handler_id);
  const teams = smWorkingWithTeamLabels(op, handler, master?.WorkingWithOption || []);

  return (
    <div role="button" tabIndex={0}
      aria-label={"Open opportunity " + op.customer_name}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen?.(op.id); } }}
      onClick={() => onOpen?.(op.id)}
      className={cn(
        "group rounded-xl border bg-card p-3 cursor-pointer transition-colors hover:border-foreground/20",
        overdue ? "border-amber-300/80" : "border-border"
      )}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[12px] leading-[1.4] line-clamp-2" title={op.customer_name}>{op.customer_name}</div>
          <div className="text-[11px] text-muted-foreground truncate mt-1"
            title={[category?.name, op.product_details].filter(Boolean).join(" · ")}>
            {category?.name || "—"}{op.product_details ? " · " + op.product_details : ""}
          </div>
        </div>
        <button type="button"
          className="shrink-0 -mr-1 -mt-1 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
          title="Open quick actions" aria-label={"Quick actions for " + op.customer_name}
          onClick={(event) => { event.stopPropagation(); onOpen?.(op.id); }}>
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2.5">
        <span className="text-[14px] font-semibold tabular-nums whitespace-nowrap">{formatTHB(op.pipeline_value)}</span>
        <span className="text-[11px] text-muted-foreground whitespace-nowrap">{formatMonth(op.expected_close_month)}</span>
      </div>
      {showRegion && <div className="mt-2 text-[10px] text-muted-foreground truncate"
        title={"Region: " + (maps.region[op.region_id]?.name || op.region_id)}>
        Region: {maps.region[op.region_id]?.name || op.region_id || "Unassigned"}
      </div>}
      <div className="mt-2 pt-2 border-t border-border/70 space-y-1.5">
        <div className="flex justify-between items-center gap-2">
          <span className="text-[11px] font-medium truncate" title={"AE Owner: " + (owner?.name || "Unassigned")}>
            {owner?.name || "Unassigned"}
          </span>
          <OverdueTags op={op} stages={maps.stage} stageWatchDays={config?.stage_watch_days} tasks={taskEntries} />
        </div>
        <div className="flex h-[19px] min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          {differentHandler && <span className="min-w-0 truncate"
            title={"Current Handler: " + (handler?.name || "Unassigned")}>
            ↳ {handler?.app_role === "sm" ? "SM: " : "Handler: "}{handler?.name || "Unassigned"}
          </span>}
          {teams.length > 0 && <span
            className="inline-flex max-w-[120px] shrink-0 items-center gap-1 overflow-hidden rounded-md border border-sky-100 bg-sky-50 px-1.5 leading-[16px] text-sky-800"
            title={"Working With: " + teams.join(", ")}>
            <span className="shrink-0 font-medium">With</span>
            <span className="min-w-0 truncate">{teams[0]}</span>
            {teams.length > 1 && <span className="shrink-0">+{teams.length - 1}</span>}
          </span>}
        </div>
      </div>
    </div>
  );
}
