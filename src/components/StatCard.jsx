import React from "react";
import { cn } from "@/lib/utils";

// A clickable metric card. `to` makes it a link.
export default function StatCard({ label, value, sub, to, onClick, accent, icon: Icon, children }) {
  const Comp = to ? "a" : "button";
  const props = to ? { href: to } : { type: "button", onClick };
  return (
    <Comp
      {...props}
      className={cn(
        "group text-left w-full rounded-xl border border-border bg-card p-4 shadow-soft transition-all duration-200",
        (to || onClick) && "cursor-pointer hover:shadow-card hover:-translate-y-0.5 hover:border-foreground/15"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        {Icon && (
          <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center bg-secondary text-muted-foreground group-hover:bg-brand-tint group-hover:text-brand transition-colors", accent && "bg-brand-tint text-brand")}>
            <Icon className="w-4 h-4" />
          </span>
        )}
      </div>
      <div className={cn("mt-2.5 text-2xl font-semibold tabular-nums tracking-tight", accent)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground tabular-nums">{sub}</div>}
      {children}
    </Comp>
  );
}