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
        "group bg-card border rounded-xl p-3.5 cursor-pointer transition-all hover:shadow-card hover:-translate-y-0.5",
        stuck ? "border-amber-300/70 shadow-soft" : "border-border shadow-soft hover:border-foreground/15"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-[13px] leading-snug line-clamp-2">{op.customer_name}</div>
        {op.support_needed && (
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">
            <AlertCircle className="w-3 h-3" /> Support
          </span>
        )}
      </div>

      <div className="mt-1 text-[11px] text-muted-foreground">
        {category?.name}
        {product ? ` · ${product.name}` : ""}
      </div>

      <div className="mt-2.5 flex items-baseline justify-between">
        <span className="text-[15px] font-semibold tabular-nums tracking-tight">{formatTHB(op.pipeline_value)}</span>
        <span className="text-[11px] text-muted-foreground">{formatMonth(op.expected_close_month)}</span>
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-border/70 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span title="Owner" className="inline-flex items-center gap-1">
          <span className="font-medium text-foreground/70">O</span> {owner?.name || "—"}
        </span>
        <span title="Current Handler" className="inline-flex items-center gap-1">
          <span className="font-medium text-foreground/70">H</span> {handler?.name || "—"}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] tabular-nums", stuck ? "bg-amber-100 text-amber-700 font-medium" : "bg-secondary text-muted-foreground")}>
          Stage {daysAgoLabel(stageAging)}
        </span>
        <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] tabular-nums bg-secondary text-muted-foreground">
          Handler {daysAgoLabel(handlerAging)}
        </span>
        {op.working_with && (
          <span className="inline-flex items-center gap-1 text-[10px] tabular-nums bg-secondary text-muted-foreground rounded-md px-1.5 py-0.5">
            <Wrench className="w-2.5 h-2.5" /> {op.working_with} {wwAging}d
          </span>
        )}
      </div>
    </div>
  );
}