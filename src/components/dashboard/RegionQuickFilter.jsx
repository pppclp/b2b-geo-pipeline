import React from "react";
import { cn } from "@/lib/utils";

// Visible region quick-filter chips for Management / SM dashboards.
// value === "" means All Regions (no region filter applied).
export default function RegionQuickFilter({ regions, value, onChange }) {
  if (!regions || regions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mr-1">Region</span>
      <button
        type="button"
        onClick={() => onChange("")}
        className={cn(
          "px-3 py-1.5 rounded-lg text-[13px] border transition-all",
          !value
            ? "bg-primary text-primary-foreground border-primary font-medium"
            : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
        )}
      >
        All Regions
      </button>
      {regions.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onChange(r.id)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[13px] border transition-all",
            value === r.id
              ? "bg-primary text-primary-foreground border-primary font-medium"
              : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
          )}
        >
          {r.name}
        </button>
      ))}
    </div>
  );
}