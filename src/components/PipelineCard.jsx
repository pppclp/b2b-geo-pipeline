import React from "react";
import { useData } from "@/lib/dataContext";
import { formatNetRc as formatTHB } from "@/lib/netRc";
import { formatMonth, agingDays } from "@/lib/pipeline";
import { isStageSlaOverdue } from "@/lib/dashboardMetrics";
import { AlertCircle, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

// Board cards are a compact overview. Full ownership, handoff and working-with
// history stays available in the shared Pipeline Quick View.
export default function PipelineCard({ op, onOpen }) {
  const { maps } = useData();
  const owner = maps.member[op.owner_id];
  const handler = maps.member[op.current_handler_id];
  const category = maps.category[op.product_category_id];
  const overdue = isStageSlaOverdue(op, maps.stage);
  const differentHandler = op.current_handler_id !== op.owner_id && Boolean(op.current_handler_id);
  const age = agingDays(op.stage_entered_at);

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
        {op.support_needed && <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5">
          <AlertCircle className="w-3 h-3" aria-hidden="true" /> Support
        </span>}
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
      <div className="mt-2 pt-2 border-t border-border/70 flex gap-2 items-center justify-between">
        <span className="text-[11px] text-muted-foreground truncate" title={"Current Handler: " + (handler?.name || "Unassigned")}>
          Handler: {handler?.name || "Unassigned"}
        </span>
        {overdue && <span className="shrink-0 rounded-md bg-amber-100 text-amber-700 font-medium text-[10px] px-1.5 py-0.5" title={"Stage SLA overdue, " + age + " days"}>
          Stage {age}d
        </span>}
      </div>
      {differentHandler && <div className="text-[10px] text-muted-foreground mt-1 truncate" title={"AE Owner: " + (owner?.name || "Unassigned")}>
        AE Owner: {owner?.name || "Unassigned"}
      </div>}
    </div>
  );
}
