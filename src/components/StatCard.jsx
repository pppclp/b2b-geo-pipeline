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
        "group text-left w-full rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20",
        to && "cursor-pointer"
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums", accent)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      {children}
    </Comp>
  );
}