import React from "react";
import { formatTHBCompact } from "@/lib/pipeline";

// Compact horizontal bar chart for comparative/ranking widgets.
// data: [{ id, name, value, count }]  — sorted by value desc, bars proportional to value.
export default function BreakdownChart({ data, onClick }) {
  const rows = [...data]
    .filter((d) => d.value > 0 || d.count > 0)
    .sort((a, b) => b.value - a.value);

  if (!rows.length) {
    return <div className="text-sm text-muted-foreground py-6 text-center">No data</div>;
  }

  const maxValue = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onClick?.(r.id)}
          title={`${r.name}: ${r.count} opportunities · ${formatTHBCompact(r.value)}`}
          className="w-full text-left group"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[13px] font-medium truncate pr-2">{r.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {r.count} · {formatTHBCompact(r.value)}
            </span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-brand/70 group-hover:bg-brand transition-all"
              style={{ width: `${(r.value / maxValue) * 100}%` }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}