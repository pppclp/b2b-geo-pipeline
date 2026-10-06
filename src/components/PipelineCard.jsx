import React from "react";
import { useNavigate } from "react-router-dom";
import { useData } from "@/lib/dataContext";
import { formatTHB, formatMonth, agingDays, daysAgoLabel } from "@/lib/pipeline";
import { AlertCircle, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export default function PipelineCard({ op, onDragStart }) {
  const { maps, config } = useData();
  const navigate = useNavigate();

  const owner = maps.member[op.owner_id];
  const handler = maps.member[op.current_handler_id];
  const category = maps.category[op.product_category_id];
  const product = maps.product[op.product_id];
  const stageAging = agingDays(op.stage_entered_at);
  const handlerAging = agingDays(op.handler_since);
  const wwAging = op.working_with ? agingDays(op.working_with_since) : 0;
  const stuck = stageAging > config.aging_threshold_days;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart?.(e, op)}
      onClick={() => navigate(`/opportunity/${op.id}`)}
      className={cn(
        "group bg-card border border-border rounded-lg p-3 cursor-pointer hover:border-foreground/30 hover:shadow-sm transition-all",
        stuck && "border-l-4 border-l-amber-400"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm leading-tight line-clamp-2">{op.customer_name}</div>
        {op.support_needed && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
            <AlertCircle className="w-3 h-3" /> Support
          </span>
        )}
      </div>

      <div className="mt-1 text-xs text-muted-foreground">
        {category?.name}
        {product ? ` · ${product.name}` : ""}
      </div>

      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold tabular-nums">{formatTHB(op.pipeline_value)}</span>
        <span className="text-xs text-muted-foreground">{formatMonth(op.expected_close_month)}</span>
      </div>

      <div className="mt-2 pt-2 border-t border-border/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span title="Owner">O: {owner?.name || "—"}</span>
        <span title="Current Handler">H: {handler?.name || "—"}</span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className={cn("tabular-nums", stuck ? "text-amber-600 font-medium" : "text-muted-foreground")}>
          Stage {daysAgoLabel(stageAging)}
        </span>
        <span className="text-muted-foreground tabular-nums">Handler {daysAgoLabel(handlerAging)}</span>
        {op.working_with && (
          <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
            <Wrench className="w-3 h-3" /> {op.working_with} {wwAging}d
          </span>
        )}
      </div>
    </div>
  );
}