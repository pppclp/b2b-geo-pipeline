import React, { useState, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// options: [{ value, label }]
export default function SearchableSelect({ value, onChange, options, placeholder = "Select…", className, disabled, searchPlaceholder = "Search…", ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const ql = q.trim().toLocaleLowerCase();
    if (!ql) return options;
    return options.filter((o) => `${o.label} ${o.keywords || ""}`.toLocaleLowerCase().includes(ql));
  }, [q, options]);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          aria-label={ariaLabel || placeholder}
          variant="outline"
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={selected ? "" : "text-muted-foreground"}>{selected ? selected.label : placeholder}</span>
          <ChevronDown className="w-4 h-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[220px]" align="start">
        <div className="flex items-center border-b px-2">
          <Search className="w-4 h-4 text-muted-foreground mr-1" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="border-0 focus-visible:ring-0 h-9"
          />
        </div>
        <div className="max-h-[300px] overflow-auto py-1" role="listbox" aria-label={ariaLabel || "Searchable options"}>
          {filtered.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No results</div>}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
                setQ("");
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-sm hover:bg-secondary",
                o.value === value && "bg-secondary font-medium"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}