import React, { useMemo } from "react";
import { useData } from "@/lib/dataContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import MonthPicker from "@/components/MonthPicker";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

// Stable component identity: declaring SelectWrap inside FilterBar caused
// the dropdown to remount on every filter state change.
const SelectWrap = ({ label, value, onChange, children, placeholder }) => (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <Select value={value || "all"} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full min-w-[140px] h-9 rounded-lg"><SelectValue placeholder={placeholder || "All"} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {children}
        </SelectContent>
      </Select>
    </div>
);

// filters: object of key->value. onFilter(key, value)
export default function FilterBar({ filters, onFilter, showCreatedMonth = true }) {
  const { master } = useData();

  const regionOptions = useMemo(
    () => (master?.Region || []).filter((r) => r.active).sort((a, b) => a.order - b.order),
    [master]
  );
  const memberOptions = useMemo(() => (master?.TeamMember || []).filter((m) => m.active), [master]);
  const categoryOptions = useMemo(() => (master?.ProductCategory || []).filter((c) => c.active), [master]);
  const stageOptions = useMemo(() => (master?.Stage || []).filter((s) => s.active).sort((a, b) => a.order - b.order), [master]);
  const scenarioOptions = useMemo(() => (master?.Scenario || []).filter((s) => s.active), [master]);
  const workingWithOptions = useMemo(() => (master?.WorkingWithOption || []).filter((w) => w.active), [master]);

  const hasFilters = Object.values(filters).some((v) => v !== "" && v != null);



  return (
    <div className="flex flex-wrap items-end gap-3">
      {showCreatedMonth && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">เดือนที่สร้าง</span>
          <MonthPicker value={filters.created_month || ""} onChange={(v) => onFilter("created_month", v)} placeholder="All Months" allowAll className="w-[140px]" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">เดือนปิดคาดการณ์</span>
        <MonthPicker value={filters.close_month || ""} onChange={(v) => onFilter("close_month", v)} placeholder="All Months" allowAll className="w-[140px]" />
      </div>

      <SelectWrap label="Region" value={filters.region} onChange={(v) => onFilter("region", v === "all" ? "" : v)}>
        {regionOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
      </SelectWrap>

      <SelectWrap label="AE เจ้าของ Pipeline" value={filters.owner} onChange={(v) => onFilter("owner", v === "all" ? "" : v)}>
        {memberOptions.filter((m) => m.app_role === "ae").map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
      </SelectWrap>

      <SelectWrap label="ผู้รับผิดชอบปัจจุบัน" value={filters.handler} onChange={(v) => onFilter("handler", v === "all" ? "" : v)}>
        {memberOptions.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
      </SelectWrap>

      <SelectWrap label="Stage" value={filters.stage} onChange={(v) => onFilter("stage", v === "all" ? "" : v)}>
        {stageOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
      </SelectWrap>

      <SelectWrap label="Status" value={filters.status} onChange={(v) => onFilter("status", v === "all" ? "" : v)}>
        <SelectItem value="open">Open</SelectItem>
        <SelectItem value="won">Won</SelectItem>
        <SelectItem value="lost">Lost</SelectItem>
        <SelectItem value="archived">Archived</SelectItem>
      </SelectWrap>

      <SelectWrap label="Product Category" value={filters.product_category} onChange={(v) => onFilter("product_category", v === "all" ? "" : v)}>
        {categoryOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
      </SelectWrap>

      <SelectWrap label="ช่องทางขาย" value={filters.sales_channel} onChange={(v) => onFilter("sales_channel", v === "all" ? "" : v)}>
        {["AE B2B GEO", "AE Self", "B2B Premium Partner"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
      </SelectWrap>

      <SelectWrap label="CCP+ Check" value={filters.ccp_check_result} onChange={(v) => onFilter("ccp_check_result", v === "all" ? "" : v)}>
        <SelectItem value="not_in_base">Not in Base (New Customer)</SelectItem>
        <SelectItem value="enterprise_base">Enterprise Existing Base</SelectItem>
        <SelectItem value="pending">Pending Review</SelectItem>
      </SelectWrap>

      <SelectWrap label="Scenario" value={filters.scenario} onChange={(v) => onFilter("scenario", v === "all" ? "" : v)}>
        {scenarioOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
      </SelectWrap>

      <SelectWrap label="ทำงานร่วมกับ" value={filters.working_with} onChange={(v) => onFilter("working_with", v === "all" ? "" : v)}>
        {workingWithOptions.map((w) => <SelectItem key={w.id} value={w.name}>{w.name}</SelectItem>)}
      </SelectWrap>

      <SelectWrap label="ต้องการ Support" value={filters.support} onChange={(v) => onFilter("support", v === "all" ? "" : v)}>
        <SelectItem value="1">Needed</SelectItem>
        <SelectItem value="0">Not needed</SelectItem>
      </SelectWrap>

      {hasFilters && (
        <Button variant="ghost" size="sm" className="mb-0.5" onClick={() => onFilter("clear", "")}>
          <X className="w-4 h-4 mr-1" /> ล้างตัวกรอง
        </Button>
      )}
    </div>
  );
}