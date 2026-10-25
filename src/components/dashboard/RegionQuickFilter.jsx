import React from "react";
import { cn } from "@/lib/utils";

// Shared Dashboard/Pipeline quick filter. Never grants access beyond the
// backend-scoped Region assignments passed in by the parent page.
export default function RegionQuickFilter({ regions, value, onChange }) {
  if (!regions || regions.length <= 1) return null;
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1"
      role="group" aria-label="Quick filter by Region" tabIndex={0}>
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground mr-1">Region</span>
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => onChange("")}
        className={cn(
          "shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !value
            ? "bg-primary text-primary-foreground border-primary font-medium"
            : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
        )}
      >
        All Regions
      </button>
      {regions.map((region) => (
        <button
          key={region.id}
          type="button"
          aria-pressed={value === region.id}
          onClick={() => onChange(region.id)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === region.id
              ? "bg-primary text-primary-foreground border-primary font-medium"
              : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
          )}
        >
          {region.name}
        </button>
      ))}
    </div>
  );
}
