import React, { useMemo, useState } from "react";
import { useData } from "@/lib/dataContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import MonthPicker from "@/components/MonthPicker";
import { Button } from "@/components/ui/button";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  FILTER_LABELS, isFilterActive, normalizeFilterSelection, optionsFromVisiblePipelines, visibleFilterFields,
} from "@/lib/roleFilterModel";

const STATUS_OPTIONS = [
  { value: "open", label: "Open" }, { value: "won", label: "Won" },
  { value: "lost", label: "Lost" }, { value: "archived", label: "Archived" },
];
const SUPPORT_OPTIONS = [
  { value: "1", label: "Needed" }, { value: "0", label: "Not needed" },
];
const YES_OPTIONS = [{ value: "1", label: "Yes" }];
const REVIEW_OPTIONS = [{ value: "1", label: "Pending review" }];
const CCP_LABELS = {
  not_in_base: "Not in Base (New Customer)",
  enterprise_base: "Enterprise Existing Base",
  pending: "Pending Review",
};

// Must be outside FilterBar. A component defined inside its parent render
// remounts each time a filter changes and interrupts Radix dropdowns.
function FilterDropdown({ fieldName, label, value, options, onChange }) {
  const available = options || [];
  const activeValue = value || "all";
  const hasValue = activeValue !== "all";
  const stale = hasValue && !available.some((item) => item.value === activeValue);
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <Select value={activeValue} onValueChange={(next) => onChange(normalizeFilterSelection(fieldName, next))}>
        <SelectTrigger aria-label={label} className="h-9 w-full rounded-lg bg-background">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">ทั้งหมด</SelectItem>
          {available.map((item) => (
            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
          ))}
          {stale && <SelectItem value={activeValue}>{activeValue} (not in current data)</SelectItem>}
        </SelectContent>
      </Select>
      {!available.length && label !== "Status" && (
        <span className="text-[10px] text-muted-foreground">ยังไม่มีตัวเลือก</span>
      )}
    </label>
  );
}

export default function FilterBar({ filters, onFilter, showCreatedMonth = true }) {
  const { profile, scopedOpportunities, maps, master } = useData();
  const [moreOpen, setMoreOpen] = useState(false);
  const role = profile?.app_role || "ae";
  const layout = visibleFilterFields(role, profile?.region_ids || []);
  const selections = useMemo(() => Object.fromEntries(
    ["region", "owner", "handler", "stage", "product_category", "sales_channel",
      "scenario", "ccp_check_result", "working_with"].map((key) => [
      key, optionsFromVisiblePipelines(key, scopedOpportunities, maps, master),
    ])
  ), [scopedOpportunities, maps, master]);

  const visibleMore = layout.more.filter((key) =>
    showCreatedMonth || key !== "created_month"
  );
  const activeMore = visibleMore.filter((key) => isFilterActive(key, filters[key])).length;
  const hasFilters = Object.entries(filters).some(([key, value]) =>
    key !== "view" && isFilterActive(key, value)
  );
  const renderField = (key) => {
    if (key === "close_month" || key === "created_month") return (
      <label key={key} className="flex min-w-0 flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">{FILTER_LABELS[key]}</span>
        <MonthPicker value={filters[key] || ""} onChange={(next) => onFilter(key, next)}
          placeholder="ทุกเดือน" allowAll className="w-full" />
      </label>
    );
    const options = key === "status" ? STATUS_OPTIONS
      : key === "support" ? SUPPORT_OPTIONS
      : key === "needs_review" ? REVIEW_OPTIONS
      : ["stuck", "internal_overdue"].includes(key) ? YES_OPTIONS
      : (selections[key] || []).map((option) => key === "ccp_check_result"
        ? { ...option, label: CCP_LABELS[option.value] || option.label } : option);
    return <FilterDropdown key={key} fieldName={key} label={FILTER_LABELS[key]} value={filters[key]}
      options={options} onChange={(value) => onFilter(key, value)} />;
  };

  return (
    <div className="space-y-3">
      {/* Search + Status + both business months + Stage never disappear. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(230px,1.4fr)_repeat(4,minmax(140px,1fr))] items-end">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">ค้นหา Pipeline</span>
          <span className="relative">
            <Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Search customer, Business ID or contact" type="search"
              placeholder="ชื่อลูกค้า / Business ID / ผู้ติดต่อ" className="h-9 pl-9"
              value={filters.search || ""} onChange={(e) => onFilter("search", e.target.value)} />
          </span>
        </label>
        {["status", "close_month", ...(showCreatedMonth ? ["created_month"] : []), "stage"].map(renderField)}
      </div>

      {/* Only the fields this role can use; all of them stay visible even with one option. */}
      {layout.primary.length > (showCreatedMonth ? 4 : 3) && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          {layout.primary.filter((key) =>
            !["status", "close_month", "created_month", "stage"].includes(key)).map(renderField)}
        </div>
      )}

      {/* Dashboard/Sidebar already provide assigned-work views. Show only
          active deep-link criteria so the Pipeline is never filtered silently. */}
      {filters.handler && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>กรองผู้รับผิดชอบ: {maps.member?.[filters.handler]?.name || filters.handler}</span>
          <Button type="button" variant="ghost" size="sm"
            onClick={() => onFilter("handler", "")} className="h-7 px-2">
            <X className="mr-1 h-3 w-3" /> ล้างตัวกรองผู้รับผิดชอบ
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
        {visibleMore.length > 0 && (
          <Button type="button" variant="outline" size="sm" className="rounded-lg"
            aria-expanded={moreOpen} aria-controls="more-pipeline-filters"
            onClick={() => setMoreOpen((current) => !current)}>
            <SlidersHorizontal className="h-4 w-4 mr-1.5" />
            ตัวกรองเพิ่มเติม{activeMore ? ` (${activeMore})` : ""}
          </Button>
        )}
        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onFilter("clear", "")}>
            <X className="h-4 w-4 mr-1" /> ล้างตัวกรอง
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground ml-auto">
          แสดงเฉพาะ Pipeline ที่คุณมีสิทธิ์เข้าถึง
        </span>
      </div>

      {moreOpen && visibleMore.length > 0 && (
        <div id="more-pipeline-filters" className="grid grid-cols-1 gap-3 rounded-xl bg-secondary/25 border border-border/60 p-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
          {visibleMore.map(renderField)}
        </div>
      )}
    </div>
  );
}
