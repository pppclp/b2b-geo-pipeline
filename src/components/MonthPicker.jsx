import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonth } from "@/lib/pipeline";

// Month picker returning "YYYY-MM". Lightweight popover.
export default function MonthPicker({ value, onChange, placeholder = "Select month", className = "" }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const [y, m] = (value || currentMonthKey()).split("-").map(Number);
    return { y: y || new Date().getFullYear(), m: m || new Date().getMonth() + 1 };
  });

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const select = (m) => {
    const key = `${view.y}-${String(m).padStart(2, "0")}`;
    onChange(key);
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-start font-normal"
        onClick={() => setOpen((o) => !o)}
      >
        {value ? formatMonth(value) : <span className="text-muted-foreground">{placeholder}</span>}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 bg-popover border border-border rounded-md shadow-md p-3 w-64">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setView((v) => ({ ...v, y: v.y - 1 }))}
                className="p-1 rounded hover:bg-secondary"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-medium text-sm">{view.y}</span>
              <button
                type="button"
                onClick={() => setView((v) => ({ ...v, y: v.y + 1 }))}
                className="p-1 rounded hover:bg-secondary"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {monthNames.map((mn, i) => (
                <button
                  key={mn}
                  type="button"
                  onClick={() => select(i + 1)}
                  className={`px-2 py-2 text-xs rounded hover:bg-secondary ${
                    value === `${view.y}-${String(i + 1).padStart(2, "0")}` ? "bg-primary text-primary-foreground" : ""
                  }`}
                >
                  {mn}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}