import React from "react";
import { cn } from "@/lib/utils";

// Shared Dashboard/Pipeline quick filter. Never grants access beyond the
// backend-scoped Region assignments passed in by the parent page.
export default function RegionQuickFilter({ regions, value, onChange, appearance = "default", label = "Region", allLabel = "All Regions" }) {
  if (!regions || regions.length <= 1) return null;
  const neutral = appearance === "neutral";
  return (
    <div className={cn("flex min-w-0 items-center overflow-x-auto", neutral ? "gap-1.5 pb-0.5" : "gap-2 pb-1")}
      role="group" aria-label="Quick filter by Region" tabIndex={0}>
      <span className="shrink-0 text-[12px] font-medium uppercase tracking-wide text-muted-foreground mr-0.5">{label}</span>
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => onChange("")}
        className={cn(
          "shrink-0 whitespace-nowrap rounded-full border text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          neutral ? "px-2.5 py-1" : "px-3 py-1.5",
          !value
            ? neutral ? "border-[#B9C0C8] bg-[#E9ECEF] text-[#202832] hover:border-[#B9C0C8] hover:bg-[#E9ECEF]" : "bg-primary text-primary-foreground border-primary font-medium"
            : neutral ? "border-border bg-card text-muted-foreground hover:border-[#B9C0C8] hover:bg-[#E9ECEF] hover:text-[#202832]" : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
        )}
      >
        {allLabel}
      </button>
      {regions.map((region) => (
        <button
          key={region.id}
          type="button"
          aria-pressed={value === region.id}
          onClick={() => onChange(region.id)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-full border text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          neutral ? "px-2.5 py-1" : "px-3 py-1.5",
            value === region.id
              ? neutral ? "border-[#B9C0C8] bg-[#E9ECEF] text-[#202832] hover:border-[#B9C0C8] hover:bg-[#E9ECEF]" : "bg-primary text-primary-foreground border-primary font-medium"
              : neutral ? "border-border bg-card text-muted-foreground hover:border-[#B9C0C8] hover:bg-[#E9ECEF] hover:text-[#202832]" : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/20"
          )}
        >
          {region.name}
        </button>
      ))}
    </div>
  );
}
