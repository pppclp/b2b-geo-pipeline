import React from "react";
import { cn } from "@/lib/utils";

// Clickable KPI card with count, full value, and context line.
export default function KpiCard({ label, count, value, context, icon: Icon, accent, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group text-left w-full rounded-xl border border-border bg-card p-4 shadow-soft transition-all duration-200 cursor-pointer hover:shadow-card hover:-translate-y-0.5 hover:border-foreground/15"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        {Icon && (
          <span
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center bg-secondary text-muted-foreground group-hover:bg-brand-tint group-hover:text-brand transition-colors",
              accent && "bg-brand-tint text-brand"
            )}
          >
            <Icon className="w-4 h-4" />
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-baseline gap-1.5">
        <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", accent)}>{count}</span>
        <span className="text-xs text-muted-foreground">Opportunities</span>
      </div>
      <div className="mt-1 text-sm font-medium tabular-nums text-foreground/90">{value}</div>
      {context && <div className="mt-1.5 text-[11px] text-muted-foreground leading-snug">{context}</div>}
    </button>
  );
}