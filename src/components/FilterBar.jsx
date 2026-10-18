import React, { useMemo, useState } from "react";
import { useData } from "@/lib/dataContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MonthPicker from "@/components/MonthPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { availableFilterOptions, filterLayout, shouldShowDropdown, statusCounts, visiblePrimaryFilters } from "@/lib/pipelineFilters";

const LABELS = {
  region: "Region", owner: "AE", handler: "Handler", stage: "Stage",
  product_category: "Product Category", sales_channel: "Sales Channel",
  scenario: "Scenario", ccp_check_result: "CCP+ Check", working_with: "Working With",
  created_month: "Created Month", won_month: "Won Month", lost_month: "Lost Month",
  lost_reason: "Lost Reason",
};
const ROLE_VIEWS = [
  { value: "all", label: "ทั้งหมด" },
  { value: "mine", label: "ของฉัน" },
  { value: "sent", label: "ที่ส่งต่อไปแล้ว" },
  { value: "received", label: "ที่คนอื่นส่งมาให้ฉัน" },
];
const STATUS_VIEWS = [
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "all", label: "All" },
];

function FilterSelect({ label, options, value, onChange, loading = false }) {
  return (
    <label className="flex flex-col gap-1 min-w-[135px]">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <Select value={value || "all"} disabled={loading || (options.length === 0 && !value)} onValueChange={(v) => onChange(v === "all" ? "" : v)}>
        <SelectTrigger aria-label={label} className="w-full h-9 rounded-lg">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {!loading && !options.length && <span className="text-[10px] text-muted-foreground">ไม่มีตัวเลือกจาก Pipeline ที่เข้าถึงได้</span>}
    </label>
  );
}

function ToggleFilter({ label, active, onChange }) {
  return (
    <button type="button" onClick={() => onChange(active ? "" : "1")}
      aria-pressed={active} className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-secondary text-muted-foreground"}`}>
      {label}
    </button>
  );
}

function ScopeTabs({ options, value, onChange, ariaLabel }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1 rounded-lg bg-secondary/70 p-1">
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`rounded-md px-3 py-1.5 text-xs transition-colors ${value === option.value ? "bg-background text-foreground shadow-sm font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

// All options originate from server-authorized scopedOpportunities, not the User Master.
export default function FilterBar({ filters, onFilter, showCreatedMonth = true }) {
  const { scopedOpportunities, profile, maps, loading } = useData();
  const [moreOpen, setMoreOpen] = useState(false);
  const role = profile?.app_role || "ae";
  const layout = filterLayout(role);
  const options = useMemo(() => availableFilterOptions(scopedOpportunities, maps), [scopedOpportunities, maps]);
  const counts = useMemo(() => statusCounts(scopedOpportunities), [scopedOpportunities]);
  const primary = visiblePrimaryFilters(role, options, filters);
  const more = layout.more.filter((key) => (showCreatedMonth || key !== "created_month") &&
    (!options[key] || shouldShowDropdown(options[key], filters[key])));
  const activeMoreCount = more.filter((key) => filters[key] && filters[key] !== "all").length;
  const hasFilters = Object.entries(filters).some(([key, value]) =>
    key === "status" ? value && value !== "open" : !!value && value !== "all"
  );
  const renderField = (key) => {
    if (["stuck", "internal_overdue", "support", "needs_review"].includes(key)) {
      if (key === "support") return <ToggleFilter key={key} label="ต้องการ Support" active={filters.support === "1"} onChange={(v) => onFilter("support", v)} />;
      if (key === "stuck") return <ToggleFilter key={key} label="เกิน Stage SLA" active={filters.stuck === "1"} onChange={(v) => onFilter("stuck", v)} />;
      if (key === "internal_overdue") return <ToggleFilter key={key} label="เกิน Internal SLA" active={filters.internal_overdue === "1"} onChange={(v) => onFilter("internal_overdue", v)} />;
      return <ToggleFilter key={key} label="รอ SM Review" active={filters.needs_review === "1"} onChange={(v) => onFilter("needs_review", v)} />;
    }
    return <FilterSelect key={key} label={LABELS[key]} options={options[key] || []}
      loading={loading} value={filters[key]} onChange={(v) => onFilter(key, v)} />;
  };
  const statusOptions = STATUS_VIEWS.map((entry) => ({
    ...entry, label: `${entry.label} (${counts[entry.value]})`,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(235px,1fr)_auto] gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">ค้นหา Pipeline</span>
          <span className="relative block">
            <Search aria-hidden="true" className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input aria-label="ค้นหาชื่อลูกค้า Business ID หรือผู้ติดต่อ" className="h-9 pl-9" type="search"
              placeholder="ชื่อลูกค้า / Business ID / ผู้ติดต่อ" value={filters.search || ""}
              onChange={(e) => onFilter("search", e.target.value)} />
          </span>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Status</span>
          <ScopeTabs ariaLabel="Pipeline Status" options={statusOptions} value={filters.status || "open"} onChange={(v) => onFilter("status", v)} />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Expected Close Month</span>
          <MonthPicker value={filters.close_month || ""} onChange={(v) => onFilter("close_month", v)}
            placeholder="All Months" allowAll className="w-[165px]" />
        </label>
        {primary.map(renderField)}
        {role === "sm" && (
          <ToggleFilter label="อยู่กับฉันตอนนี้" active={filters.with_me === "1"} onChange={(v) => onFilter("with_me", v)} />
        )}
      </div>

      {role === "ae" && (
        <ScopeTabs ariaLabel="มุมมอง Pipeline ของ AE" options={ROLE_VIEWS}
          value={filters.ownership_view || "all"} onChange={(v) => onFilter("ownership_view", v === "all" ? "" : v)} />
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
        {more.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="rounded-lg"
            aria-expanded={moreOpen} aria-controls="pipeline-more-filters" onClick={() => setMoreOpen((v) => !v)}>
            <SlidersHorizontal className="w-4 h-4 mr-1.5" /> More filters{activeMoreCount ? ` (${activeMoreCount})` : ""}
          </Button>
        )}
        {hasFilters && <Button type="button" variant="ghost" size="sm" onClick={() => onFilter("clear", "")}>
          <X className="w-4 h-4 mr-1" /> Clear filters
        </Button>}
        <span className="text-[11px] text-muted-foreground ml-auto">All includes Archived · ตัวเลือกอ้างอิงเฉพาะ Pipeline ที่มีสิทธิ์เห็น</span>
      </div>

      {moreOpen && more.length > 0 && (
        <div id="pipeline-more-filters" className="flex flex-wrap gap-3 items-end rounded-xl border border-border bg-secondary/30 p-3">
          {more.map(renderField)}
        </div>
      )}
    </div>
  );
}
