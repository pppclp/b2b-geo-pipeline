import React from "react";
import { formatTHB } from "@/lib/pipeline";

// Horizontal bar chart for comparison/ranking.
// data: [{ id, name, count, value }]
// onClick: (id) => void
// preserveOrder: if true, don't sort by value (keep original order, e.g. stages)
export default function HBarChart({ data, onClick, preserveOrder = false, emptyMessage = "No data" }) {
  const sorted = preserveOrder ? data : [...data].sort((a, b) => b.value - a.value);
  const maxVal = Math.max(...sorted.map((d) => d.value), 1);
  const hasData = sorted.some((d) => d.count > 0 || d.value > 0);

  if (!hasData) {
    return <div className="text-sm text-muted-foreground py-6 text-center">{emptyMessage}</div>;
  }

  return (
    <div className="space-y-2.5">
      {sorted.map((d) => (
        <div key={d.id} className="group relative">
          <button
            type="button"
            onClick={() => onClick(d.id)}
            title={`${d.name}: ${d.count} Opportunities · ${formatTHB(d.value)}`}
            className="w-full text-left"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-medium truncate">{d.name}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums ml-2 shrink-0">
                {d.count} · {formatTHB(d.value)}
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-brand/60 group-hover:bg-brand transition-all"
                style={{ width: `${Math.max((d.value / maxVal) * 100, d.value > 0 ? 4 : 0)}%` }}
              />
            </div>
          </button>
        </div>
      ))}
    </div>
  );
}