import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useData } from "@/lib/dataContext";
import { missingPipelineCoreFields } from "@/lib/pipelineDataCompleteness";
import { reviewQueueRows, reviewQueueCounts, reviewSignals } from "@/lib/pipelineReviewQueue";
import { sortPipelineRows } from "@/lib/pipelineListPresentation";
import { formatMonth } from "@/lib/pipeline";
import { formatNetRc } from "@/lib/netRc";
import PageHeader from "@/components/PageHeader";
import PipelineQuickView from "@/components/PipelineQuickView";
import OpportunityForm from "@/components/OpportunityForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ChevronDown, ChevronRight, Search, AlertCircle } from "lucide-react";

const MAIN_TABS = [
  { value: "all", label: "All" },
  { value: "data", label: "Incomplete Data" },
  { value: "stage", label: "Stage Review" },
];
const DATA_TABS = [
  { value: "all", label: "All" },
  { value: "core", label: "Core Data" },
  { value: "sm", label: "SM Info" },
];

function canEditOpen(op, profile) {
  return op.status === "open" && (
    ["admin", "sm", "management"].includes(profile?.app_role) ||
    op.owner_id === profile?.id || op.current_handler_id === profile?.id
  );
}

function missingSmLabels(op) {
  const labels = [];
  if (!op.scenario_id) labels.push("Scenario");
  if (!op.ccp_check_result || op.ccp_check_result === "pending") labels.push("CCP+ Check");
  return labels;
}

// The queue only presents already-authorized records and reuses the existing
// Edit / Quick View APIs. No new endpoint, write path, or approval status.
export default function ReviewQueue() {
  const { scopedOpportunities, activeStages, maps, profile, loading, error, refresh } = useData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const paramTab = params.get("tab");
  const tab = MAIN_TABS.some(t => t.value === paramTab) ? paramTab : "all";
  const paramDataType = params.get("type");
  const dataType = profile?.app_role === "sm" && DATA_TABS.some(t => t.value === paramDataType)
    ? paramDataType : "all";
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);
  const [editId, setEditId] = useState(null);
  const role = profile?.app_role || "";

  const allRows = useMemo(() => reviewQueueRows(scopedOpportunities, {
    activeStages, role, tab, dataType, search,
  }), [scopedOpportunities, activeStages, role, tab, dataType, search]);
  const sorted = useMemo(() => sortPipelineRows(allRows, "close_month"), [allRows]);
  const counts = useMemo(() => reviewQueueCounts(scopedOpportunities, activeStages, role),
    [scopedOpportunities, activeStages, role]);
  const selected = sorted.find(op => op.id === expandedId) || null;
  const quickViewOp = scopedOpportunities.find(op => op.id === quickViewId) || null;
  const editOp = scopedOpportunities.find(op => op.id === editId) || null;

  const changeTab = (next) => {
    setParams(next === "all" ? {} : { tab: next }, { replace: true });
    setExpandedId(null);
  };
  const changeDataType = (next) => {
    setParams({ tab: "data", ...(next !== "all" ? { type: next } : {}) }, { replace: true });
    setExpandedId(null);
  };

  if (loading || error) return (
    <div className="geo-page">
      <PageHeader title="Review Queue" className="mb-4" />
      <p role={error ? "alert" : "status"} className="text-sm text-muted-foreground">
        {error ? "Unable to load review data." : "Loading Pipeline data…"}
      </p>
      {error && <Button type="button" variant="outline" size="sm" onClick={refresh}>Retry</Button>}
    </div>
  );

  return (
    <div className="geo-page">
      <button type="button" onClick={() => navigate("/pipeline")}
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Pipeline
      </button>
      <PageHeader title="Review Queue" description="รายการ Open ที่ต้องตรวจสอบและดำเนินการ" className="mb-4" />
      <nav aria-label="Review Queue categories" className="flex w-full min-w-0 gap-1 overflow-x-auto rounded-xl bg-secondary p-1 sm:w-fit">
        {MAIN_TABS.map(item => (
          <button key={item.value} type="button" onClick={() => changeTab(item.value)}
            aria-current={tab === item.value ? "page" : undefined}
            aria-pressed={tab === item.value}
            className={`min-h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors ${tab === item.value
              ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
        {tab === "all" ? counts.all : tab === "stage" ? counts.stage : counts.data} Pipelines
      </div>
      {tab === "data" && profile?.app_role === "sm" && (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Incomplete Data type">
          <span className="text-xs text-muted-foreground">Data Type</span>
          {DATA_TABS.map(item => (
            <button key={item.value} type="button" onClick={() => changeDataType(item.value)}
              aria-pressed={dataType === item.value}
              className={`rounded-lg border px-3 py-1.5 text-xs ${dataType === item.value
                ? "border-primary/40 bg-brand-tint font-medium text-brand" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className="relative mt-4 max-w-md">
        <Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input aria-label="Search Review Queue" value={search} onChange={event => setSearch(event.target.value)}
          placeholder="Search customer or Pipeline ID" className="h-9 pl-9 text-sm" />
      </div>
      <div className="mt-3 space-y-2" aria-label="Review Queue Pipeline records">
        {sorted.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No Pipelines to review{search ? " matching this search" : ""}.
          </div>
        )}
        {sorted.map(op => {
          const signals = reviewSignals(op, activeStages, role);
          const isExpanded = selected?.id === op.id;
          const canEdit = canEditOpen(op, profile);
          return (
            <div key={op.id} className="overflow-hidden rounded-xl border border-border bg-card">
              <button type="button" onClick={() => setExpandedId(isExpanded ? null : op.id)}
                aria-expanded={isExpanded} aria-controls={`review-details-${op.id}`}
                className="flex min-h-[72px] w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{op.customer_name || op.id}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {maps.member?.[op.owner_id]?.name || "Unassigned"} · {maps.stage?.[op.stage_id]?.name || op.stage_id || "Unknown Stage"} · {formatMonth(op.expected_close_month)}
                    {maps.region?.[op.region_id]?.name ? ` · ${maps.region[op.region_id].name}` : ""}
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    {signals.core.length > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">Core Data</span>}
                    {signals.sm && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground">SM Info</span>}
                    {signals.stage && <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground">Stage Review</span>}
                  </span>
                </div>
                <span className="hidden shrink-0 text-xs font-semibold tabular-nums sm:block">{formatNetRc(op.pipeline_value)}</span>
                {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </button>
              {isExpanded && (
                <div id={`review-details-${op.id}`} className="space-y-3 border-t border-border/70 px-3.5 py-3">
                  {signals.core.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium">ข้อมูลหลักที่ยังไม่ครบ</p>
                      <p className="text-xs text-muted-foreground">{missingPipelineCoreFields(op).map(f => f.label).join(" · ")}</p>
                    </div>
                  )}
                  {signals.sm && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium">Missing SM Info</p>
                      <p className="text-xs text-muted-foreground">{missingSmLabels(op).join(" · ")}</p>
                    </div>
                  )}
                  {signals.stage && (
                    <div className="flex items-start gap-2 text-xs text-muted-foreground">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>ยืนยัน Stage ปัจจุบัน: เลือก Stage ที่ยังดำเนินการ หรือปิดงานเป็น Won / Lost ตามข้อมูลจริง</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {(signals.core.length > 0 || signals.sm) && canEdit && (
                      <Button size="sm" variant="outline" type="button" onClick={() => setEditId(op.id)}>แก้ไขข้อมูล</Button>
                    )}
                    {signals.stage && canEdit && (
                      <Button size="sm" type="button" onClick={() => setQuickViewId(op.id)}>ตรวจสอบ Stage</Button>
                    )}
                    <Button size="sm" variant="ghost" type="button" onClick={() => navigate(`/opportunity/${encodeURIComponent(op.id)}`)}>
                      ดูรายละเอียดทั้งหมด
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {editOp && <OpportunityForm key={editOp.id} open opportunity={editOp}
        onClose={() => setEditId(null)} onSaved={() => setEditId(null)} />}
      <PipelineQuickView key={quickViewId || "closed"} open={!!quickViewOp} op={quickViewOp}
        onClose={() => setQuickViewId(null)}
        onExpand={() => { if (quickViewId) { const id = quickViewId; setQuickViewId(null); navigate(`/opportunity/${encodeURIComponent(id)}`); } }} />
    </div>
  );
}
