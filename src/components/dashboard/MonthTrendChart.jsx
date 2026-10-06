import React from "react";
import { formatTHB, formatMonth } from "@/lib/pipeline";

// Vertical bar chart for time-based trends (e.g. Expected Close by Month).
// data: [{ month, count, value }]  — month is "YYYY-MM"
// onClick: (month) => void
export default function MonthTrendChart({ data, onClick, emptyMessage = "No data" }) {
  if (data.length === 0) {
    return <div className="text-sm text-muted-foreground py-6 text-center">{emptyMessage}</div>;
  }

  const maxVal = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex items-end gap-2 h-36">
      {data.map((d) => (
        <div key={d.month} className="group relative flex-1 flex flex-col items-center min-w-0">
          <div className="text-[10px] text-muted-foreground tabular-nums mb-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap absolute -top-1">
            {formatTHB(d.value)}
          </div>
          <button
            type="button"
            onClick={() => onClick(d.month)}
            title={`${formatMonth(d.month)}: ${d.count} Opportunities · ${formatTHB(d.value)}`}
            className="w-full flex-1 flex items-end pt-4"
          >
            <div
              className="w-full rounded-t-md bg-brand/60 group-hover:bg-brand transition-all min-h-[2px]"
              style={{ height: `${Math.max((d.value / maxVal) * 100, d.value > 0 ? 3 : 0)}%` }}
            />
          </button>
          <div className="text-[10px] text-muted-foreground mt-1 text-center truncate w-full">
            {formatMonth(d.month)}
          </div>
        </div>
      ))}
    </div>
  );
}