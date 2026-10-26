import React, {useMemo, useState} from "react";
import {useData} from "@/lib/dataContext";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Button} from "@/components/ui/button";
import {X, SlidersHorizontal, Search} from "lucide-react";
import {Input} from "@/components/ui/input";
import MonthPicker from "@/components/MonthPicker";
import SearchableSelect from "@/components/SearchableSelect";
import {
  PIPELINE_FILTER_LABELS as LABELS,
  advancedFilterCount, visibleActiveFilters, showQuickRegion,
  allowedAeOwners, isActiveFilter,
} from "@/lib/pipelineFilterUi";

// Stable identity is essential: never define dropdown components inside FilterBar.
const SelectWrap = ({label, value, onChange, children, className = "", allText = "All"}) => (
  <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
    <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    <Select value={value || "all"} onValueChange={onChange}>
      <SelectTrigger aria-label={label}
        className={`h-9 w-full rounded-lg ${isActiveFilter(label === "Status" ? "status" : "",value) ? "border-primary/60" : ""}`}>
        <SelectValue placeholder={allText}/>
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        <SelectItem value="all">{allText}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  </div>
);

const MonthFilter = ({label, value, onChange}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    <MonthPicker value={value || ""} onChange={onChange} placeholder="All Months" allowAll className="w-full"/>
  </div>
);

// Presentation only. Never change user scope or derive access from selected filters.
export default function FilterBar({filters, onFilter, showCreatedMonth = true, stageChipsVisible = false, showRegionControl = true}) {
  const {master, profile, scopedOpportunities} = useData();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const regionOptions = useMemo(() =>
    (master?.Region || []).filter(r=>r.active).sort((a,b)=>a.order-b.order),[master]);
  const members = useMemo(() => (master?.TeamMember || []).filter(m=>m.active),[master]);
  const categories = useMemo(() => (master?.ProductCategory || []).filter(c=>c.active),[master]);
  const stages = useMemo(() =>
    (master?.Stage || []).filter(s=>s.active).sort((a,b)=>a.order-b.order),[master]);
  const scenarios = useMemo(() => (master?.Scenario || []).filter(s=>s.active),[master]);
  const working = useMemo(() => (master?.WorkingWithOption || []).filter(w=>w.active),[master]);
  const regionId = filters.region || "";
  const showRegion = showQuickRegion(profile);
  const ownerChoices = useMemo(
    () => allowedAeOwners(members, scopedOpportunities, regionId),
    [members, scopedOpportunities, regionId]
  );
  const visibleHandlers = useMemo(() => {
    const ids = new Set((scopedOpportunities || [])
      .filter(o => !regionId || o.region_id === regionId)
      .map(o => o.current_handler_id));
    return members.filter(m => ids.has(m.id))
      .sort((a,b)=>a.name.localeCompare(b.name));
  },[members,scopedOpportunities,regionId]);
  const advancedCount = advancedFilterCount(filters);
  // Only show chips for additional filters that are hidden behind More Filters.
  const chipEntries = visibleActiveFilters(filters).filter(([key]) =>
    !["search", "close_month", "product_category", "region", "status"].includes(key) &&
    !(key === "sm_info" && profile?.app_role === "sm") &&
    !(key === "stage" && stageChipsVisible));
  const missingSmInfoCount = profile?.app_role === "sm"
    ? scopedOpportunities.filter(o => o.status === "open" &&
      (!o.scenario_id || !o.ccp_check_result || o.ccp_check_result === "pending")).length
    : 0;

  const display = (key,value) => {
    if(key==="region") return regionOptions.find(r=>r.id===value)?.name || value;
    if(key==="owner" || key==="handler") return members.find(m=>m.id===value)?.name || value;
    if(key==="stage") return stages.find(s=>s.id===value)?.name || value;
    if(key==="product_category") return categories.find(c=>c.id===value)?.name || value;
    if(key==="scenario") return scenarios.find(s=>s.id===value)?.name || value;
    if(key==="support") return value==="1"?"Needed":"Not Needed";
    if(key==="status" && value==="all") return "All Statuses";
    if(key==="ccp_check_result") return ({not_in_base:"Not in Base",enterprise_base:"Enterprise Existing Base",pending:"Pending Review"})[value] || value;
    if(key==="stuck" || key==="internal_overdue") return "Yes";
    return value;
  };
  const choice = (key) => (v) => onFilter(key,v==="all" ? "" : v);
  return (
    <div className="space-y-3">
      <div className="grid min-w-0 grid-cols-2 items-end gap-x-2.5 gap-y-3 md:flex md:flex-wrap md:gap-y-2.5">
        <div className="col-span-2 min-w-0 space-y-1 md:w-[250px] md:flex-1 md:max-w-[340px]">
          <label htmlFor="pipeline-search" className="block text-[11px] font-medium text-muted-foreground">Search</label>
          <div className="relative">
            <Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/>
            <Input id="pipeline-search" aria-label="Search customer, Business ID or Pipeline ID"
              value={filters.search || ""} onChange={e=>onFilter("search",e.target.value)}
              placeholder="Customer, Business ID or Pipeline ID"
              className="h-10 rounded-xl pl-9 pr-8 text-[13px] md:h-9 md:rounded-lg"/>
            {filters.search && <button type="button" aria-label="Clear search"
              className="absolute right-2 top-2 rounded-md p-1 hover:bg-secondary"
              onClick={()=>onFilter("search","")}><X className="h-3.5 w-3.5"/></button>}
          </div>
        </div>
        <div className="min-w-0 md:w-[158px]">
          <MonthFilter label={LABELS.close_month} value={filters.close_month} onChange={v=>onFilter("close_month",v)}/>
        </div>
        {showRegion && showRegionControl && <SelectWrap label={LABELS.region} value={filters.region} onChange={choice("region")}
          className="w-[130px]">
          {regionOptions.filter(r=>profile?.app_role==="admin" ||
            (profile?.region_ids||[]).includes(r.id)).map(r=><SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
        </SelectWrap>}
        <SelectWrap label={LABELS.product_category}
          value={filters.product_category} onChange={choice("product_category")}
          className="min-w-0 md:w-[185px]" allText="All Categories">
          {categories.map((category) =>
            <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
          )}
        </SelectWrap>
        <SelectWrap label={LABELS.status} value={filters.status || "all"}
          onChange={v=>onFilter("status",v)} className="min-w-0 md:w-[132px]" allText="All Statuses">
          {["open","won","lost","archived"].map(v=><SelectItem key={v} value={v}>
            {v.charAt(0).toUpperCase()+v.slice(1)}
          </SelectItem>)}
        </SelectWrap>
        <Popover open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" aria-label="More Filters"
              aria-expanded={advancedOpen} className="h-10 w-full min-w-0 justify-center gap-2 rounded-xl text-xs md:h-9 md:w-auto md:rounded-lg">
              <SlidersHorizontal className="h-4 w-4"/> More Filters
              {advancedCount>0&&<span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] tabular-nums">{advancedCount}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8}
            className="w-[min(420px,calc(100vw-32px))] rounded-xl p-0" role="dialog" aria-label="More Filters">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <strong className="text-sm font-semibold">More Filters</strong>
              <Button size="icon" variant="ghost" aria-label="Close More Filters"
                onClick={()=>setAdvancedOpen(false)} className="h-7 w-7"><X className="h-4 w-4"/></Button>
            </div>
            <div className="max-h-[min(60vh,450px)] overflow-y-auto space-y-4 p-4">
              {showCreatedMonth&&<section className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Date</h4>
                <MonthFilter label={LABELS.created_month} value={filters.created_month}
                  onChange={v=>onFilter("created_month",v)}/>
              </section>}
              <section className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Sales & Ownership</h4>
                {profile?.app_role !== "ae" && <div className="space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">{LABELS.owner}</span>
                  <SearchableSelect value={filters.owner || "all"} ariaLabel={LABELS.owner}
                    onChange={choice("owner")} searchPlaceholder="Search AE..."
                    placeholder="All AEs" className="h-9 rounded-lg"
                    options={[{value:"all",label:"All AEs"},...ownerChoices.map(m=>({
                      value:m.id,label:m.name,keywords:`${m.employee_id||""} ${m.id||""}`
                    }))]}/>
                </div>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SelectWrap label={LABELS.stage} value={filters.stage} onChange={choice("stage")}>
                    {stages.map(s=><SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectWrap>
                  <SelectWrap label={LABELS.handler} value={filters.handler} onChange={choice("handler")}>
                    {visibleHandlers.map(m=><SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectWrap>
                </div>
                <SelectWrap label={LABELS.working_with} value={filters.working_with} onChange={choice("working_with")}>
                  {working.map(w=><SelectItem key={w.id} value={w.name}>{w.name}</SelectItem>)}
                </SelectWrap>
              </section>
              <section className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Other Details</h4>
                <SelectWrap label={LABELS.scenario} value={filters.scenario} onChange={choice("scenario")}>
                  {scenarios.map(c=><SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectWrap>
                <SelectWrap label={LABELS.sales_channel} value={filters.sales_channel} onChange={choice("sales_channel")}>
                  {["AE B2B GEO","AE Self","B2B Premium Partner"].map(v=><SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectWrap>
                <SelectWrap label={LABELS.ccp_check_result} value={filters.ccp_check_result} onChange={choice("ccp_check_result")}>
                  <SelectItem value="not_in_base">Not in Base (New Customer)</SelectItem>
                  <SelectItem value="enterprise_base">Enterprise Existing Base</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                </SelectWrap>
              </section>
              <section className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Support</h4>
                <SelectWrap label={LABELS.support} value={filters.support} onChange={choice("support")}>
                  <SelectItem value="1">Needed</SelectItem>
                  <SelectItem value="0">Not Needed</SelectItem>
                </SelectWrap>
              </section>
            </div>
            <div className="flex justify-between items-center border-t p-3">
              <Button type="button" size="sm" variant="ghost" onClick={()=>onFilter("clear","")}>Reset to Default</Button>
              <Button type="button" size="sm" onClick={()=>setAdvancedOpen(false)}>Show Results</Button>
            </div>
          </PopoverContent>
        </Popover>
        {profile?.app_role === "sm" && (
          <Button type="button" variant={filters.sm_info === "missing" ? "secondary" : "outline"}
            size="sm" aria-pressed={filters.sm_info === "missing"}
            onClick={()=>onFilter("sm_info",filters.sm_info === "missing" ? "" : "missing")}
            className={`col-span-2 h-10 w-full rounded-xl text-xs md:col-span-1 md:h-9 md:w-auto md:rounded-lg ${filters.sm_info === "missing" ? "border border-primary/50 text-brand bg-brand-tint" : ""}`}>
            Missing SM Info{missingSmInfoCount > 0 ? ` (${missingSmInfoCount})` : ""}
          </Button>
        )}
      </div>
      {chipEntries.length>0&&<div className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2 md:flex md:flex-wrap md:gap-1.5" aria-label="Active filters">
        <span className="text-xs font-medium text-muted-foreground md:mr-1 md:text-[11px]">Active Filters</span>
        <Button type="button" size="sm" variant="ghost"
          className="col-start-2 row-start-1 h-7 px-2 text-xs text-brand md:order-last"
          onClick={()=>onFilter("clear","")}>Clear all</Button>
        <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 md:contents">
          {chipEntries.map(([key,value])=><button key={key} type="button"
            onClick={()=>onFilter(key,key==="status"?"open":"")}
            aria-label={`Remove ${LABELS[key]} filter`}
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-secondary/60 px-2.5 py-1.5 text-[11px] text-foreground hover:bg-secondary">
            <span className="truncate">{LABELS[key]}: {display(key,value)}</span><X className="h-3 w-3 shrink-0"/>
          </button>)}
        </div>
      </div>}
    </div>
  );
}
