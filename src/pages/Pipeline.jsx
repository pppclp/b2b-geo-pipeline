import React, { useState, useMemo, useEffect } from "react";
import { actionableErrorMessage } from "@/lib/actionFeedback";
import { useSearchParams, useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useData } from "@/lib/dataContext";
import { formatNetRc as formatTHB } from "@/lib/netRc";
import { agingDays, formatMonth, STATUS_LABELS } from "@/lib/pipeline";
import { downloadPipelineExcel } from "@/lib/pipelineExport";
import { db } from "@/api/client";
import { overdueReasons, overdueContext, missingServerSlaCount } from "@/lib/overdueSummary.js";
import OverdueTags from "@/components/OverdueTags";
import PipelineCard from "@/components/PipelineCard";
import FilterBar from "@/components/FilterBar";
import RegionQuickFilter from "@/components/dashboard/RegionQuickFilter";
import PageHeader from "@/components/PageHeader";
import {shouldClearOwnerOnRegionChange} from "@/lib/pipelineFilterUi";
import { matchesPipelineFilters, quickViewCounts, activePipelineView, switchPipelineView } from "@/lib/pipelineListFilters";
import { sortPipelineRows, workingWithTeamLabels, summarizeFilteredPipelines, regionDisplayContext } from "@/lib/pipelineListPresentation";
import OpportunityForm from "@/components/OpportunityForm";
import PipelineQuickView from "@/components/PipelineQuickView";
import { PIPELINE_STATUS_TABS, pipelineStatusCounts, nextPipelineStatusFilters, pipelineStageDisplay } from "@/lib/pipelineStatusTabs";
import { requiresStageReview } from "@/lib/pipelineReviewQueue";
import { WORK_VIEW_SUBTITLES, selectedCloseMonthSubtitle } from "@/lib/uiCopy";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KanbanSquare, List, Plus, Download, AlertTriangle, ChevronRight, ClipboardCheck, Layers3, UserRound, CalendarDays } from "lucide-react";

const SORTS = [
  { value: "close_month", label: "Close Month ↑ · Net RC ↓", shortLabel: "Close Month ↑" },
  { value: "value_desc", label: "Value — High to Low", shortLabel: "Value ↓" },
  { value: "value_asc", label: "Value — Low to High", shortLabel: "Value ↑" },
  { value: "stage_aging_desc", label: "Stage Aging — Longest First", shortLabel: "Stage Aging ↓" },
  { value: "handler_aging_desc", label: "Handler Aging — Longest First", shortLabel: "Handler Aging ↓" },
  { value: "updated_desc", label: "Recently Updated", shortLabel: "Updated ↓" },
  { value: "created_desc", label: "Created Date", shortLabel: "Created Date" },
  { value: "customer_asc", label: "Customer Name A-Z", shortLabel: "Customer A–Z" }
];



export default function Pipeline() {
  const { scopedOpportunities, opportunities, activeStages, maps, master, profile, config, taskEntries, loading, error, refresh } = useData();
  const alertCtx = overdueContext(maps, master, config);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [view, setView] = useState("list");
  const [sort, setSort] = useState("close_month");
  const [formOpen, setFormOpen] = useState(false);
  const [quickView, setQuickView] = useState(null); // { id, targetStageId? }
  const [filters, setFilters] = useState({ status: "open" });
  const [canExport, setCanExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    const f = { status: "open" };
    if (params.get("view") === "assigned-to-me" || params.get("assigned") === "me") {
      if (profile?.app_role === "management") f.with_me = "1";
      else f.handler = profile?.id;
    }
    if (params.get("with_me") === "1" && profile?.app_role === "management") f.with_me = "1";
    if (params.get("stuck") === "1") f.stuck = "1";
    if (params.get("due_this_month") === "1" || params.get("view") === "due-this-month") f.due_this_month = "1";
    if (params.get("view") === "stage-overdue") f.stuck = "1";
    if (params.get("internal_overdue") === "1") f.internal_overdue = "1";
    if (params.get("region")) f.region = params.get("region");
    if (params.get("owner")) f.owner = params.get("owner");
    if (params.get("handler")) f.handler = params.get("handler");
    if (params.get("category") || params.get("product_category")) f.product_category = params.get("category") || params.get("product_category");
    if (params.get("sales_channel")) f.sales_channel = params.get("sales_channel");
    if (params.get("ccp_check_result")) f.ccp_check_result = params.get("ccp_check_result");
    if (params.get("close_month")) f.close_month = params.get("close_month");
    if (params.get("created_month")) f.created_month = params.get("created_month");
    if (params.get("won_month")) f.won_month = params.get("won_month");
    if (params.get("lost_month")) f.lost_month = params.get("lost_month");
    if (params.get("lost_reason")) f.lost_reason = params.get("lost_reason");
    if (params.get("stage")) f.stage = params.get("stage");
    if (params.get("search")) f.search = params.get("search");
    if (params.get("status")) f.status = params.get("status");
    if (profile?.app_role === "sm" && params.get("sm_info") === "missing") f.sm_info = "missing";
    if (params.get("incomplete") === "1") f.incomplete = "1";
    if (params.get("sort")) setSort(params.get("sort"));
    setFilters(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, profile?.id, profile?.app_role]);

  useEffect(() => {
    let active = true;
    setCanExport(false);
    db.access()
      .then((access) => {
        const actions = access?.allowed?.["B2B_GEO_Pipeline_DB.xlsx"]?.Pipelines || [];
        if (active) setCanExport(actions.includes("export"));
      })
      .catch((error) => { if (active) { setExportError("Export permission check failed: " + error.message); setCanExport(false); } });
    return () => { active = false; };
  }, [profile?.id, profile?.app_role, profile?.isDemo]);

  const onFilter = (key, value) => {
    if (key === "status") {
      // Close-status tabs and the archived advanced option share one transition.
      // This clears Open-only work view flags and Stage, never the independent filters.
      const next = nextPipelineStatusFilters(filters, value || "all");
      setFilters(next);
      const nextParams = new URLSearchParams();
      for (const [filterKey, filterValue] of Object.entries(next)) {
        if (filterValue && !(filterKey === "status" && filterValue === "open"))
          nextParams.set(filterKey, filterValue);
      }
      setParams(nextParams, { replace: true });
      if (value !== "open") setView("list");
      return;
    }
    if (key === "clear") {
      setFilters({ status: "open" });
      setParams({});
      setSort("close_month");
      return;
    }
    setFilters((f) => {
      const next = {...f, [key]: value || ""};
      if (key === "handler") next.with_me = "";
      if (key === "region" && shouldClearOwnerOnRegionChange(
        f.owner, value, master?.TeamMember || [], scopedOpportunities
      )) next.owner = "";
      return next;
    });
  };

  const filterContext = useMemo(() => ({ master, maps, config, taskEntries,
    viewerId: profile?.id, viewerRole: profile?.app_role,
  }), [master, maps, config, taskEntries, profile?.id, profile?.app_role]);
  const filteredWithoutStage = useMemo(() =>
    scopedOpportunities.filter((o) => matchesPipelineFilters(o, filters, filterContext, { ignoreStage: true })),
    [scopedOpportunities, filters, filterContext]
  );
  const filtered = useMemo(() => filters.stage
    ? filteredWithoutStage.filter((o) => o.stage_id === filters.stage)
    : filteredWithoutStage, [filteredWithoutStage, filters.stage]);
  const workCounts = useMemo(() =>
    quickViewCounts(scopedOpportunities, filters, profile?.id, filterContext),
    [scopedOpportunities, filters, profile?.id, filterContext]
  );
  const statusCounts = useMemo(() =>
    pipelineStatusCounts(scopedOpportunities, filters, filterContext),
    [scopedOpportunities, filters, filterContext]
  );
  const stageReviewCount = useMemo(() => filteredWithoutStage.filter(
    (op) => requiresStageReview(op, activeStages)
  ).length, [filteredWithoutStage, activeStages]);
  const sorted = useMemo(() => sortPipelineRows(filtered, sort), [filtered, sort]);
  // Same authorized + filtered records as List/Board and filtered Excel export.
  const filteredSummary = useMemo(() => summarizeFilteredPipelines(filtered), [filtered]);
  const missingSlaCount = useMemo(() => missingServerSlaCount(scopedOpportunities), [scopedOpportunities]);
  // This is a presentation-only selector, never a replacement for server RBAC.
  // Match Dashboard's region choices: Admin and Management see all active
  // Regions; SM and AE only see active User_Region assignments.
  const quickRegions = useMemo(() => (master?.Region || [])
    .filter((region) => region.active && (
      ["admin", "management"].includes(profile?.app_role) || (profile?.region_ids || []).includes(region.id)
    ))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [master?.Region, profile?.app_role, profile?.region_ids]
  );
  const hasRegionQuickFilter = quickRegions.length > 1;
  const stageCounts = useMemo(() => {
    const counts = new Map();
    filteredWithoutStage.forEach(o => counts.set(o.stage_id, (counts.get(o.stage_id) || 0) + 1));
    return counts;
  }, [filteredWithoutStage]);
  const regionContext = useMemo(() => regionDisplayContext(
    sorted, maps.region, filters.region || "", quickRegions.map((region) => region.id)
  ), [sorted, maps.region, filters.region, quickRegions]);
  const exportExcel = async () => {
    setExportError("");
    setExporting(true);
    try {
      // Server re-verifies export permission and user/region scope. UI filters
      // are then intersected with those freshly authorized records.
      const authorized = await db.exports.pipelines();
      const filteredIds = new Set(sorted.map((o) => String(o.id)));
      const authorizedAndFiltered = authorized.filter((o) => filteredIds.has(String(o.id)));
      await downloadPipelineExcel(authorizedAndFiltered, maps);
    } catch (error) {
      setExportError(error.message || "Excel Export failed");
    } finally {
      setExporting(false);
    }
  };

  const onDragEnd = (res) => {
    if (!res.destination || res.source.droppableId === res.destination.droppableId) return;
    const op = scopedOpportunities.find((item) => item.id === res.draggableId);
    if (!op || op.status !== "open") return;
    // Keep the existing card in its original column until Save Changes.
    setQuickView({ id: op.id, targetStageId: res.destination.droppableId });
  };
  const openQuickView = (id) => setQuickView({ id, targetStageId: null });
  const selectedPipeline = quickView ? scopedOpportunities.find((item) => item.id === quickView.id) : null;

  const closedBoardRecords = sorted.filter((o) => o.status !== "open");
  const stageBadgeTones = {
    stage1: "border-[#B7E4C7] bg-[#ECFDF3] text-[#2F855A]",
    stage2: "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB]",
    stage3: "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]",
    stage4: "border-[#FBCFE8] bg-[#FDF2F8] text-[#BE185D]",
    review: "border-border bg-secondary text-foreground",
    won: "border-transparent bg-[#AFE0C2] text-[#166534]",
    lost: "border-transparent bg-[#F3C4C4] text-[#9A3340]",
    neutral: "border-border bg-secondary text-foreground",
  };
  // Shared Stage quick-filter palette follows the same visual semantics as list badges.
  const stageFilterTones = {
    STG001: "border-[#B7E4C7] bg-[#ECFDF3] text-[#2F855A] hover:bg-[#DCFCE7]",
    STG002: "border-[#BFDBFE] bg-[#EFF6FF] text-[#2563EB] hover:bg-[#DBEAFE]",
    STG003: "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C] hover:bg-[#FFEDD5]",
    STG004: "border-[#FBCFE8] bg-[#FDF2F8] text-[#BE185D] hover:bg-[#FCE7F3]",
  };
  const quickViews = [
    { id: "all", title: "All Open", subtitle: WORK_VIEW_SUBTITLES.all, count: workCounts.all, icon: Layers3 },
    { id: "assigned-to-me", title: "With Me", subtitle: WORK_VIEW_SUBTITLES.with, count: workCounts["assigned-to-me"], icon: UserRound },
    { id: "stage-overdue", title: "Overdue", subtitle: WORK_VIEW_SUBTITLES.overdue, count: workCounts["stage-overdue"], icon: null },
    { id: "due-this-month", title: filters.close_month ? "Due in Selected Month" : "Due This Month", subtitle: filters.close_month ? selectedCloseMonthSubtitle : WORK_VIEW_SUBTITLES.due, count: workCounts["due-this-month"], icon: CalendarDays },
  ];
  const activeQuickView = activePipelineView(filters, profile?.id, profile?.app_role);
  const selectStatus = (status) => onFilter("status", status);
  const selectQuickView = (viewId) => {
    const base = filters.status === "open" ? filters : nextPipelineStatusFilters(filters, "open");
    const next = switchPipelineView(base, viewId, profile?.id, profile?.app_role);
    setFilters(next);
    // Mirror the view and active filters into the URL so refreshing or
    // opening a saved link will keep the same scope. Do not reset sort.
    const nextParams = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) {
      if (value && !(key === "status" && value === "open")) nextParams.set(key, value);
    }
    if (viewId !== "all") nextParams.set("view", viewId);
    setParams(nextParams, { replace: true });
  };

  // Never present stale totals after a failed batch read as current data.
  if (loading || error) return (
    <div className="geo-page pipeline-typography">
      <PageHeader title="Pipeline" className="mb-4" />
      <div role={error?"alert":"status"} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <AlertTriangle className="w-4 h-4 text-muted-foreground" aria-hidden="true"/>
        <span className="flex-1 text-sm">{error ? actionableErrorMessage(error, "load") : "Loading Pipeline data…"}</span>
        {error&&<Button variant="outline" size="sm" onClick={refresh}>Retry</Button>}
      </div>
    </div>
  );


  return (
    <div className="geo-page pipeline-typography">
      <PageHeader
        title="Pipeline"
        description={`${sorted.length} ${filters.status === "open" ? "Open " : filters.status === "won" ? "Won " : filters.status === "lost" ? "Lost " : ""}Pipelines`}
        className="mb-4"
        actions={
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          {canExport && (
            <Button variant="outline" size="sm" className="h-10 min-w-0 flex-1 rounded-xl px-2 text-xs sm:h-9 sm:flex-none sm:px-3 sm:text-sm" disabled={exporting} onClick={exportExcel}>
              <Download className="w-4 h-4 mr-1.5" /> {exporting ? "Generating Excel…" : "Export Excel"}
            </Button>
          )}
          <Button size="sm" className="h-10 min-w-0 flex-1 rounded-xl bg-primary px-2 text-xs text-primary-foreground sm:h-9 sm:flex-none sm:px-3 sm:text-sm" onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> สร้าง Pipeline
          </Button>
          </div>
        }
      />

      {exportError && <p role="alert" className="text-sm text-red-600 mb-3">{exportError}</p>}
      {!loading && !error && scopedOpportunities.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground mb-3">
          {opportunities.length > 0
            ? "Pipeline records were returned, but none match your access scope. Check the User_Region mapping and deployment settings."
            : "No Pipelines are available for this account. If you expect records, check the deployment and access settings."}
        </p>
      )}
      {/* Compact work-view cards on phones; same filters/counts as desktop tabs. */}
      <nav aria-label="Pipeline work views" className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-border/70 bg-card p-2.5 shadow-soft md:hidden">
        {quickViews.map((item) => {
          const Icon = item.icon;
          const active = activeQuickView === item.id;
          return (
            <button key={item.id} type="button" onClick={() => selectQuickView(item.id)}
              aria-current={active ? "page" : undefined} aria-pressed={active}
              className={`relative flex min-h-[94px] min-w-0 flex-col items-start justify-between gap-1 rounded-xl px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-brand-tint text-brand" : "bg-secondary/65 text-foreground hover:bg-secondary"}`}>
              <span className="max-w-[calc(100%-20px)] text-current"><span className="block text-[12px] font-semibold leading-4">{item.title}</span><span className="block mt-0.5 text-[11px] leading-4 opacity-75">{item.subtitle}</span></span>
              <span className="text-xl font-semibold leading-none tabular-nums">{item.count}</span>
              {Icon && <Icon className={`absolute right-2.5 top-2.5 h-4 w-4 ${active ? "text-brand" : "text-muted-foreground"}`} aria-hidden="true" />}
            </button>
          );
        })}
      </nav>
      {/* Work views remain the four existing Open actions, without extra cards. */}
      <nav aria-label="Pipeline work views" className="mb-4 hidden border-b border-border/70 md:block">
        <div className="flex min-w-0 items-center gap-4 overflow-x-auto sm:gap-6">
          {quickViews.map((item) => {
            const active = activeQuickView === item.id;
            return (
              <button key={item.id} type="button" onClick={() => selectQuickView(item.id)}
                aria-pressed={active} aria-current={active ? "page" : undefined}
                title={item.subtitle}
                className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-[3px] px-0.5 py-2 text-[13px] transition-colors sm:text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active
                  ? "border-red-500 font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}>
                {item.title}
                <span className={`tabular-nums ${active ? "font-semibold text-red-600" : "font-medium text-muted-foreground"}`}>{item.count}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mb-4">
        <FilterBar filters={filters} onFilter={onFilter}
          compactLayout showStatusControl={false}
          stageChipsVisible={filters.status === "open"} showRegionControl={!hasRegionQuickFilter} />
      </div>

      <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 max-w-full shrink-0 items-center gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter Pipelines by Status">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">Status</span>
          {PIPELINE_STATUS_TABS.map((tab) => (
            <button type="button" key={tab.id} onClick={() => selectStatus(tab.id)}
              aria-pressed={filters.status === tab.id}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filters.status === tab.id
                ? "border-foreground bg-foreground font-semibold text-background" : "border-border bg-card text-foreground hover:bg-secondary"}`}>
              {tab.label} <span className="ml-1 tabular-nums">{statusCounts[tab.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex max-w-full shrink-0 items-center gap-1.5">
          {filters.status === "open" && <div className="inline-flex shrink-0 rounded-xl bg-secondary p-0.5" role="group" aria-label="Pipeline view">
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}
              className={view === "list" ? "flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-xs font-semibold shadow-soft" : "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"}>
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}
              className={view === "board" ? "flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-xs font-semibold shadow-soft" : "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"}>
              <KanbanSquare className="h-3.5 w-3.5" /> Board
            </button>
          </div>}
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger aria-label="Sort Pipelines" title={SORTS.find((item) => item.value === sort)?.label} className="h-8 w-[145px] shrink-0 rounded-xl px-2 text-xs sm:w-[155px]"><SelectValue>{SORTS.find((item) => item.value === sort)?.shortLabel}</SelectValue></SelectTrigger>
            <SelectContent>
              {SORTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filters.status === "open" && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          {view === "list" ? (
            <div className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Quick filter by Stage">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">Stage</span>
              <button type="button" onClick={() => onFilter("stage", "")} aria-pressed={!filters.stage}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${!filters.stage
                  ? "border-foreground/25 bg-secondary text-foreground hover:bg-secondary" : "border-border text-muted-foreground hover:bg-secondary"}`}>
                All <span className="ml-1 tabular-nums">{filteredWithoutStage.length}</span>
              </button>
              {activeStages.map((stage) => {
                const tone = stageFilterTones[stage.id] || "border-border bg-secondary text-foreground hover:bg-secondary/80";
                return (
                  <button type="button" key={stage.id} onClick={() => onFilter("stage", stage.id)}
                    aria-pressed={filters.stage === stage.id}
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone} ${filters.stage === stage.id ? "shadow-[inset_0_0_0_1px_rgba(57,65,75,0.32)]" : ""}`}>
                    {stage.name} <span className="ml-1 tabular-nums">{stageCounts.get(stage.id) || 0}</span>
                  </button>
                );
              })}
            </div>
          ) : <span />}
          {stageReviewCount > 0 && (
            <button type="button" onClick={() => navigate("/review-queue?tab=stage")}
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 text-xs font-medium text-foreground hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              {stageReviewCount} งานรอตรวจสอบ Stage <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}

      {hasRegionQuickFilter && (
        <div className="mb-3" aria-label="Region filters for your access scope">
          <RegionQuickFilter regions={quickRegions} value={filters.region || ""}
            appearance="neutral" onChange={(regionId) => onFilter("region", regionId)} />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-y border-border/70 py-2 text-[12px]"
        aria-label="Filtered Pipeline summary" aria-live="polite">
        <span className="text-muted-foreground">
          Filtered Pipelines <strong className="ml-1 font-semibold tabular-nums text-foreground">{filteredSummary.count.toLocaleString("en-US")}</strong>
        </span>
        <span className="text-muted-foreground">
          Total Net RC <strong className="ml-1 font-semibold tabular-nums text-foreground">{formatTHB(filteredSummary.totalNetRc)}</strong>
          <span className="ml-1">THB/month</span>
        </span>
        {filteredSummary.missingValueCount > 0 && (
          <span className="text-muted-foreground" title="Records with blank or invalid existing Pipeline Value are excluded from the Net RC total.">
            {filteredSummary.missingValueCount} without Net RC
          </span>
        )}
      </div>

      {missingSlaCount > 0 && ["management", "admin"].includes(profile?.app_role) && (
        <div role="status" className="mb-3 flex flex-wrap items-center gap-2 text-xs text-amber-800"
          title="Some authorized Open Pipeline records do not have alert_state.version 1 from the deployed Apps Script backend. Stage-only tags are not a reliable complete Overdue count.">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>SLA alerts incomplete · Backend update required ({missingSlaCount.toLocaleString("en-US")} Open Pipelines without SLA data)</span>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState title="No Pipelines match" description="Try adjusting filters or create a new Pipeline." icon={KanbanSquare} />
      ) : view === "board" && filters.status === "open" ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="min-w-0 w-full">
            {/* Share available width across every active stage. When many stages
                cannot meet the minimum readable width, scroll horizontally. */}
            <div
              className="grid w-full min-w-0 gap-3 overflow-x-auto pb-4"
              style={{ gridTemplateColumns: `repeat(${Math.max(activeStages.length, 1)}, minmax(280px, 1fr))` }}
              aria-label="Sales stages — scroll horizontally when needed"
              tabIndex={0}
            >
            {activeStages.map((stage) => {
              const stageOps = sorted.filter((o) => o.status === "open" && o.stage_id === stage.id);
              const stageValue = stageOps.reduce((a, o) => a + (o.pipeline_value || 0), 0);
              return (
                <div key={stage.id} className="flex min-w-0 flex-col">
                  <div className="flex min-w-0 items-center justify-between gap-2 mb-2.5 px-1">
                    <span className="min-w-0 truncate font-medium text-[13px]" title={stage.name}>{stage.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums bg-secondary rounded-md px-2 py-0.5">{stageOps.length} · {formatTHB(stageValue)}</span>
                  </div>
                  <Droppable droppableId={stage.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`flex-1 space-y-2.5 p-2 rounded-xl min-h-[120px] transition-colors ${snapshot.isDraggingOver ? "bg-brand-tint" : "bg-secondary/50"}`}
                      >
                        {stageOps.map((op, idx) => (
                          <Draggable key={op.id} draggableId={op.id} index={idx}>
                            {(p) => (
                              <div ref={p.innerRef} {...p.draggableProps} {...p.dragHandleProps}>
                                <PipelineCard op={op} onOpen={openQuickView} showRegion={regionContext.showColumn} />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {stageOps.length === 0 && (
                          <div className="text-xs text-muted-foreground text-center py-6">Drop here</div>
                        )}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
            </div>
            {closedBoardRecords.length > 0 && (
              <section className="mt-4 rounded-xl border border-border p-3" aria-label="Closed Pipeline statuses">
                <h3 className="text-sm font-semibold">Closed Pipelines · Won / Lost</h3>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {closedBoardRecords.map((record) => (
                    <button type="button" key={record.id} onClick={() => openQuickView(record.id)}
                      className="min-w-0 rounded-lg border border-border bg-card p-3 text-left hover:border-foreground/30">
                      <span className="block truncate text-sm font-medium">{record.customer_name}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{STATUS_LABELS[record.status] || record.status} · {formatTHB(record.pipeline_value)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </DragDropContext>
      ) : (
        <div className="min-w-0 md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-card">
          <div className="space-y-2.5 md:hidden" role="list" aria-label="Pipeline records">
            {sorted.map((o) => {
              const age = o.stage_entered_at ? agingDays(o.stage_entered_at) : null;
              const overdue = overdueReasons(o, maps.stage, config?.stage_watch_days, taskEntries, alertCtx).any;
              const stageDisplay = pipelineStageDisplay(o, activeStages, maps.stage);
              const teamLabels = workingWithTeamLabels(o, master?.WorkingWithOption || []);
              return (
                <button key={o.id} type="button" role="listitem"
                  className="relative flex w-full min-w-0 flex-col gap-2 rounded-2xl border border-border bg-card px-3.5 py-4 text-left shadow-soft transition-colors hover:border-foreground/20 hover:bg-secondary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => openQuickView(o.id)}
                  aria-label={"Open Pipeline " + o.customer_name}>
                  <span className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold" title={o.customer_name}>{o.customer_name}</span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">{formatTHB(o.pipeline_value)}</span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1.5 pr-4 text-[11px] text-muted-foreground">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 font-medium ${stageBadgeTones[stageDisplay.tone]}`}>{stageDisplay.label}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatMonth(o.expected_close_month)}</span>
                    {regionContext.showColumn && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="max-w-[12rem] truncate">{maps.region[o.region_id]?.name || o.region_id || "Unassigned"}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span title={age === null ? "ไม่มีข้อมูลวันที่เข้า Stage" : `Days in current Stage: ${age}`} className={overdue ? "font-semibold text-amber-700" : ""}>{age === null ? "—" : `${age}d in stage`}</span>
                    {teamLabels.length > 0 && (
                      <span className="inline-flex max-w-[180px] items-center gap-1 rounded-md border border-[#DDD6FE] bg-[#F5F3FF] px-1.5 py-0.5 text-[10px] text-[#7C3AED]"
                        title={"Working With: " + teamLabels.join(", ")}>
                        With <span className="min-w-0 truncate">{teamLabels[0]}</span>
                        {teamLabels.length > 1 && <span className="shrink-0">+{teamLabels.length - 1} teams</span>}
                      </span>
                    )}
                    <OverdueTags op={o} stages={maps.stage} stageWatchDays={config?.stage_watch_days} tasks={taskEntries} alertContext={alertCtx} />
                  </span>
                  <ChevronRight className="pointer-events-none absolute right-2.5 bottom-3.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div
            className="hidden overflow-x-auto md:block"
            aria-label="Pipeline records table"
            tabIndex={0}
            style={{
              // Thead's background covers only the intrinsic table width.
              // Paint the remaining scroll-viewport gutter gray as well,
              // without coloring the body rows or increasing header height.
              background: "linear-gradient(to bottom, hsl(var(--secondary)) 0px, hsl(var(--secondary)) 36px, hsl(var(--card)) 36px, hsl(var(--card)) 100%)",
            }}
          >
            <table className={`w-full table-fixed text-[13px] ${regionContext.showColumn ? "min-w-[1200px]" : "min-w-[1085px]"}`}>
              <colgroup>
                {/* Compact content-based widths; horizontal scrolling protects narrow displays. */}
                <col className="w-[280px]" />
                <col className="w-[155px]" />
                <col className="w-[240px]" />
                {regionContext.showColumn && <col className="w-[115px]" />}
                <col className="w-[114px]" />
                <col className="w-[130px]" />
                <col className="w-[165px]" />
              </colgroup>
              <thead className="border-b border-border/70 bg-secondary text-muted-foreground">
                <tr className="h-9">
                  <th scope="col" className="sticky left-0 z-20 bg-secondary px-2.5 py-1 text-left align-middle text-[12px] font-semibold leading-4 whitespace-nowrap">Pipeline</th>
                  <th scope="col" className="px-2.5 py-1 text-left align-middle text-[12px] font-semibold leading-4 whitespace-nowrap">{filters.status === "open" ? "Stage" : "Status"}</th>
                  <th scope="col" className="px-2.5 py-1 text-left align-middle text-[12px] font-semibold leading-4 whitespace-nowrap">AE Owner / Handling</th>
                  {regionContext.showColumn && <th scope="col" className="px-2.5 py-1 text-left align-middle text-[12px] font-semibold leading-4 whitespace-nowrap">Region</th>}
                  <th scope="col" className="px-2.5 py-1 text-left align-middle text-[12px] font-semibold leading-4 whitespace-nowrap">Close Month</th>
                  <th scope="col" className="px-2.5 py-1 text-right align-middle text-[12px] font-semibold leading-4 whitespace-nowrap">Net RC</th>
                  <th scope="col" className="bg-secondary px-2.5 py-1 text-right align-middle text-[12px] font-semibold leading-4 whitespace-nowrap">Stage Age / Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {sorted.map((o) => {
                  const ownerName = maps.member[o.owner_id]?.name || "Unassigned";
                  const handler = maps.member[o.current_handler_id];
                  const handlerName = handler?.name || "Unassigned";
                  const categoryName = maps.category[o.product_category_id]?.name || "";
                  const age = o.stage_entered_at ? agingDays(o.stage_entered_at) : null;
                  const differentOwner = Boolean(o.current_handler_id && o.owner_id !== o.current_handler_id);
                  // Display selected collaborators regardless of whether AE or
                  // SM is handling the Pipeline; assignment does not change ownership.
                  const teamLabels = workingWithTeamLabels(o, master?.WorkingWithOption || []);
                  const regionName = maps.region[o.region_id]?.name || o.region_id || "Unassigned";
                  const stageDisplay = pipelineStageDisplay(o, activeStages, maps.stage);
                  return (
                    <tr key={o.id}
                      className="group h-[52px] cursor-pointer bg-card transition-colors align-middle"
                      onClick={() => openQuickView(o.id)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault(); openQuickView(o.id);
                        }
                      }}
                      aria-label={"Open opportunity " + o.customer_name}>
                      <td className="sticky left-0 z-10 bg-card px-2.5 py-1.5 transition-colors group-hover:bg-secondary">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate font-medium text-[13px] leading-5" title={o.customer_name}>
                            {o.customer_name}
                          </span>
                          {categoryName && <span title={[categoryName, o.product_details].filter(Boolean).join(" · ")}
                            className="max-w-[148px] shrink-0 truncate rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {categoryName}
                          </span>}
                        </div>
                        {o.status !== "open" && <span className="text-[10px] text-muted-foreground">{STATUS_LABELS[o.status] || o.status}</span>}
                        <span className="sr-only">Product details: {o.product_details || "Not specified"}</span>
                      </td>
                      <td className="min-w-0 overflow-hidden bg-card px-2.5 py-1.5 text-[13px] transition-colors group-hover:bg-secondary">
                        <span title={stageDisplay.label} className={`inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${stageBadgeTones[stageDisplay.tone]}`}>
                          <span className="min-w-0 truncate">{stageDisplay.label}</span>
                        </span>
                      </td>
                      <td className="min-w-0 bg-card px-2.5 py-1.5 transition-colors group-hover:bg-secondary">
                        {/* Fixed two-line owner/handler layout for every Pipeline.
                            Working With stays inline for AE and SM, never a third row. */}
                        <div className="flex min-h-[32px] min-w-0 flex-col justify-center gap-0.5">
                          <div className="min-w-0 truncate font-medium leading-[18px]"
                            title={"AE Owner: " + ownerName}>{ownerName}</div>
                          <div className="flex h-[18px] min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
                            {differentOwner && (
                              <span className="min-w-0 shrink truncate leading-[18px]"
                                title={"Current Handler: " + handlerName}>
                                <span aria-hidden="true" className="mr-0.5 text-brand">↳</span>
                                {handler?.app_role === "sm" ? "SM: " : "Handler: "}{handlerName}
                              </span>
                            )}
                            {teamLabels.length > 0 && (
                              <span className="inline-flex max-w-[116px] shrink-0 items-center gap-1 overflow-hidden rounded-md border border-[#DDD6FE] bg-[#F5F3FF] px-1.5 text-[10px] leading-[16px] text-[#7C3AED]"
                                title={"Working With: " + teamLabels.join(", ")}>
                                <span className="shrink-0 font-medium">With</span>
                                <span className="min-w-0 truncate">{teamLabels[0]}</span>
                                {teamLabels.length > 1 && <span className="shrink-0">+{teamLabels.length - 1} teams</span>}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {regionContext.showColumn && <td className="bg-card px-2.5 py-1.5 text-[12px] font-normal text-muted-foreground transition-colors group-hover:bg-secondary" title={regionName}>
                        <span className="line-clamp-2">{regionName}</span>
                      </td>}
                      <td className="bg-card px-2.5 py-1.5 text-[12px] font-normal text-muted-foreground whitespace-nowrap transition-colors group-hover:bg-secondary">
                        {formatMonth(o.expected_close_month)}
                      </td>
                      <td className="bg-card px-2.5 py-1.5 text-right font-medium tabular-nums whitespace-nowrap transition-colors group-hover:bg-secondary">
                        {formatTHB(o.pipeline_value)}
                      </td>
                      <td className="bg-card px-2.5 py-1.5 text-right transition-colors group-hover:bg-secondary">
                        <div className="font-normal tabular-nums text-[11px] whitespace-nowrap"
                          title={age === null ? "ไม่มีข้อมูลวันที่เข้า Stage" : "Days in current Stage: " + age}>{age === null ? "—" : `${age}d` }</div>
                        <div className="mt-0.5"><OverdueTags op={o} stages={maps.stage} stageWatchDays={config?.stage_watch_days} tasks={taskEntries} alertContext={alertCtx} /></div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <OpportunityForm open={formOpen} onClose={() => setFormOpen(false)} />
      <PipelineQuickView
        key={quickView?.id || "closed"}
        open={!!quickView && !!selectedPipeline}
        op={selectedPipeline}
        initialStageId={quickView?.targetStageId || null}
        onClose={() => setQuickView(null)}
        onExpand={() => {
          if (!quickView) return;
          const id = quickView.id;
          setQuickView(null);
          navigate(`/opportunity/${id}`);
        }}
      />
    </div>
  );
}