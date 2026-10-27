import React, { useState, useMemo, useEffect } from "react";
import { actionableErrorMessage } from "@/lib/actionFeedback";
import { useSearchParams, useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useData } from "@/lib/dataContext";
import { formatNetRc as formatTHB } from "@/lib/netRc";
import { agingDays, formatMonth, STATUS_LABELS } from "@/lib/pipeline";
import { downloadPipelineExcel } from "@/lib/pipelineExport";
import { db } from "@/api/client";
import { overdueReasons } from "@/lib/overdueSummary.js";
import OverdueTags from "@/components/OverdueTags";
import PipelineCard from "@/components/PipelineCard";
import FilterBar from "@/components/FilterBar";
import RegionQuickFilter from "@/components/dashboard/RegionQuickFilter";
import {shouldClearOwnerOnRegionChange} from "@/lib/pipelineFilterUi";
import { matchesPipelineFilters, quickViewCounts, activePipelineView, switchPipelineView } from "@/lib/pipelineListFilters";
import { sortPipelineRows, smWorkingWithTeamLabels, regionDisplayContext } from "@/lib/pipelineListPresentation";
import OpportunityForm from "@/components/OpportunityForm";
import PipelineQuickView from "@/components/PipelineQuickView";
import { WORK_VIEW_SUBTITLES, selectedCloseMonthSubtitle } from "@/lib/uiCopy";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KanbanSquare, List, Plus, Download, AlertTriangle, Layers3, UserRound, Clock3, CalendarDays, ChevronRight } from "lucide-react";

const SORTS = [
  { value: "close_month", label: "Close Month ↑ · Net RC ↓" },
  { value: "value_desc", label: "Value — High to Low" },
  { value: "value_asc", label: "Value — Low to High" },
  { value: "stage_aging_desc", label: "Stage Aging — Longest First" },
  { value: "handler_aging_desc", label: "Handler Aging — Longest First" },
  { value: "updated_desc", label: "Recently Updated" },
  { value: "created_desc", label: "Created Date" },
  { value: "customer_asc", label: "Customer Name A-Z" },
];



export default function Pipeline() {
  const { scopedOpportunities, opportunities, activeStages, maps, master, profile, config, taskEntries, loading, error, refresh } = useData();
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
  const sorted = useMemo(() => sortPipelineRows(filtered, sort), [filtered, sort]);
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

  const totalValue = sorted.reduce((a, o) => a + (o.pipeline_value || 0), 0);
  const quickViews = [
    { id: "all", title: "All Open", subtitle: WORK_VIEW_SUBTITLES.all, count: workCounts.all, icon: Layers3 },
    { id: "assigned-to-me", title: "With Me", subtitle: WORK_VIEW_SUBTITLES.with, count: workCounts["assigned-to-me"], icon: UserRound },
    { id: "stage-overdue", title: "Overdue", subtitle: WORK_VIEW_SUBTITLES.overdue, count: workCounts["stage-overdue"], icon: Clock3 },
    { id: "due-this-month", title: filters.close_month ? "Due in Selected Month" : "Due This Month", subtitle: filters.close_month ? selectedCloseMonthSubtitle : WORK_VIEW_SUBTITLES.due, count: workCounts["due-this-month"], icon: CalendarDays },
  ];
  const activeQuickView = activePipelineView(filters, profile?.id, profile?.app_role);
  const selectQuickView = (viewId) => {
    const next = switchPipelineView(filters, viewId, profile?.id, profile?.app_role);
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
    <div className="p-5 md:p-7 max-w-[1400px] mx-auto">
      <h1 className="text-xl font-semibold mb-4">Pipeline</h1>
      <div role={error?"alert":"status"} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <AlertTriangle className="w-4 h-4 text-muted-foreground" aria-hidden="true"/>
        <span className="flex-1 text-sm">{error ? actionableErrorMessage(error, "load") : "Loading Pipeline data…"}</span>
        {error&&<Button variant="outline" size="sm" onClick={refresh}>Retry</Button>}
      </div>
    </div>
  );


  return (
    <div className="w-full min-w-0 p-3 sm:p-4 md:p-5">
      <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-xl">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sorted.length} Pipelines · {formatTHB(totalValue)} Net RC
          </p>
        </div>
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
      </div>

      {exportError && <p role="alert" className="text-sm text-red-600 mb-3">{exportError}</p>}
      {!loading && !error && scopedOpportunities.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground mb-3">
          {opportunities.length > 0
            ? "Pipeline records were returned, but none match your access scope. Check the User_Region mapping and deployment settings."
            : "No Pipelines are available for this account. If you expect records, check the deployment and access settings."}
        </p>
      )}
      {/* Compact work-view cards on phones; same filters/counts as desktop tabs. */}
      <nav aria-label="Pipeline work views" className="mb-4 grid grid-cols-6 gap-2 rounded-2xl border border-border/70 bg-card p-2.5 shadow-soft md:hidden">
        {quickViews.map((item, index) => {
          const Icon = item.icon;
          const active = activeQuickView === item.id;
          return (
            <button key={item.id} type="button" onClick={() => selectQuickView(item.id)}
              aria-current={active ? "page" : undefined} aria-pressed={active}
              className={`${index < 3 ? "col-span-2" : "col-span-3"} relative flex min-h-[94px] min-w-0 flex-col items-start justify-between gap-1 rounded-xl px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-brand-tint text-brand" : "bg-secondary/65 text-foreground hover:bg-secondary"}`}>
              <span className="max-w-[calc(100%-20px)] text-current"><span className="block text-[11px] font-medium leading-4">{item.title}</span><span className="block mt-0.5 text-[10px] leading-3.5 opacity-75">{item.subtitle}</span></span>
              <span className="text-xl font-semibold leading-none tabular-nums">{item.count}</span>
              <Icon className={`absolute right-2.5 top-2.5 h-4 w-4 ${active ? "text-brand" : "text-muted-foreground"}`} aria-hidden="true" />
            </button>
          );
        })}
      </nav>
      <nav aria-label="Pipeline work views" className="mb-3 hidden border-b border-border/70 pb-2 md:block">
        <div className="flex flex-wrap items-center gap-1.5">
          {quickViews.map((item) => (
            <button key={item.id} type="button" onClick={() => selectQuickView(item.id)}
              aria-current={activeQuickView === item.id ? "page" : undefined}
              aria-pressed={activeQuickView === item.id}
              className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeQuickView === item.id
                ? "bg-brand-tint text-brand"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
              <span className="text-left leading-4"><span className="block">{item.title}</span><span className="block text-[10px] font-normal opacity-75">{item.subtitle}</span></span>
              <span className="text-[12px] font-semibold tabular-nums">{item.count}</span>
            </button>
          ))}
        </div>
      </nav>
      <div className="mb-3">
        <FilterBar filters={filters} onFilter={onFilter} stageChipsVisible={view === "list"}
          showRegionControl={false} />
      </div>

      {hasRegionQuickFilter && (
        <div className="mb-3">
          <RegionQuickFilter regions={quickRegions} value={filters.region || ""}
            onChange={(regionId) => onFilter("region", regionId)} />
        </div>
      )}

      <div className="mb-3 flex min-w-0 flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-3 md:gap-y-2.5">
        <div className="w-full min-w-0 md:w-auto md:flex-1">
          {view === "list" && (
            <div className="flex w-full min-w-0 items-center gap-2 overflow-x-auto border-t border-border/70 pt-3 pb-1 md:max-w-full md:gap-1.5 md:border-t-0 md:pt-0" role="group" aria-label="Quick filter by Stage">
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Stage</span>
              <button type="button" onClick={() => onFilter("stage", "")}
                aria-pressed={!filters.stage}
                className={!filters.stage
                  ? "shrink-0 whitespace-nowrap rounded-lg border border-primary/40 bg-brand-tint px-2.5 py-1.5 text-[11px] font-medium text-brand"
                  : "shrink-0 whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"}>
                All <span className="ml-1 tabular-nums">{filteredWithoutStage.length}</span>
              </button>
              {activeStages.map((stage) => (
                <button type="button" key={stage.id} onClick={() => onFilter("stage", stage.id)}
                  aria-pressed={filters.stage === stage.id}
                  className={filters.stage === stage.id
                    ? "shrink-0 whitespace-nowrap rounded-lg border border-primary/40 bg-brand-tint px-2.5 py-1.5 text-[11px] font-medium text-brand"
                    : "shrink-0 whitespace-nowrap rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"}>
                  {stage.name} <span className="ml-1 tabular-nums">{stageCounts.get(stage.id) || 0}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid w-full min-w-0 grid-cols-2 items-center gap-2 md:flex md:w-auto md:shrink-0">
          <div className="inline-flex min-w-0 justify-center rounded-xl bg-secondary p-1" role="group" aria-label="Pipeline view">
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}
              className={view === "list"
                ? "flex items-center gap-1.5 rounded-md bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-soft"
                : "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"}>
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}
              className={view === "board"
                ? "flex items-center gap-1.5 rounded-md bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-soft"
                : "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"}>
              <KanbanSquare className="h-3.5 w-3.5" /> Board
            </button>
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger aria-label="Sort Pipelines" className="h-9 w-full min-w-0 rounded-xl px-2 text-[11px] md:w-[205px] md:text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState title="No Pipelines match" description="Try adjusting filters or create a new Pipeline." icon={KanbanSquare} />
      ) : view === "board" ? (
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
              const stageOps = sorted.filter((o) => o.stage_id === stage.id);
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
          </div>
        </DragDropContext>
      ) : (
        <div className="min-w-0 md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-card">
          <div className="space-y-2.5 md:hidden" role="list" aria-label="Pipeline records">
            {sorted.map((o) => {
              const age = o.stage_entered_at ? agingDays(o.stage_entered_at) : null;
              const overdue = overdueReasons(o, maps.stage, config?.stage_watch_days, taskEntries).any;
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
                    <span className={`inline-flex rounded-md px-2 py-1 font-medium ${overdue ? "bg-brand-tint text-brand" : "bg-secondary text-foreground"}`}>{maps.stage[o.stage_id]?.name || "—"}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatMonth(o.expected_close_month)}</span>
                    {regionContext.showColumn && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="max-w-[12rem] truncate">{maps.region[o.region_id]?.name || o.region_id || "Unassigned"}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className={overdue ? "font-semibold text-amber-700" : ""}>{age === null ? "Stage age unknown" : `${age}d in stage`}</span>
                    <OverdueTags op={o} stages={maps.stage} stageWatchDays={config?.stage_watch_days} tasks={taskEntries} />
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
              background: "linear-gradient(to bottom, hsl(var(--secondary)) 0px, hsl(var(--secondary)) 40px, hsl(var(--card)) 40px, hsl(var(--card)) 100%)",
            }}
          >
            <table className={`w-full table-fixed text-[12px] ${regionContext.showColumn ? "min-w-[1190px]" : "min-w-[1030px]"}`}>
              <colgroup>
                <col className={regionContext.showColumn ? "w-[25%]" : "w-[28%]"} />
                <col className="w-[10%]" />
                <col className={regionContext.showColumn ? "w-[25%]" : "w-[30%]"} />
                {regionContext.showColumn && <col className="w-[10%]" />}
                <col className={regionContext.showColumn ? "w-[11%]" : "w-[12%]"} />
                <col className={regionContext.showColumn ? "w-[12%]" : "w-[12%]"} />
                <col className={regionContext.showColumn ? "w-[7%]" : "w-[8%]"} />
              </colgroup>
              <thead className="border-b border-border/70 bg-secondary text-muted-foreground">
                <tr className="h-10">
                  <th scope="col" className="sticky left-0 z-20 bg-secondary px-3 py-1.5 text-left align-middle text-[11px] font-semibold leading-4 whitespace-nowrap">Pipeline</th>
                  <th scope="col" className="px-3 py-1.5 text-left align-middle text-[11px] font-semibold leading-4 whitespace-nowrap">Stage</th>
                  <th scope="col" className="px-3 py-1.5 text-left align-middle text-[11px] font-semibold leading-4 whitespace-nowrap">AE Owner / Handling</th>
                  {regionContext.showColumn && <th scope="col" className="px-3 py-1.5 text-left align-middle text-[11px] font-semibold leading-4 whitespace-nowrap">Region</th>}
                  <th scope="col" className="px-3 py-1.5 text-left align-middle text-[11px] font-semibold leading-4 whitespace-nowrap">Close Month</th>
                  <th scope="col" className="px-3 py-1.5 text-right align-middle text-[11px] font-semibold leading-4 whitespace-nowrap">Net RC</th>
                  <th scope="col" className="bg-secondary px-3 py-1.5 text-right align-middle text-[11px] font-semibold leading-4 whitespace-nowrap">Stage Age / Alerts</th>
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
                  // Working With is a supporting-team indicator, not ownership.
                  // Inline it beside an assigned SM only; other collaborators
                  // remain visible in Pipeline Quick View without adding rows.
                  const teamLabels = smWorkingWithTeamLabels(o, handler, master?.WorkingWithOption || []);
                  const regionName = maps.region[o.region_id]?.name || o.region_id || "Unassigned";
                  return (
                    <tr key={o.id}
                      className="group h-[64px] hover:bg-secondary/35 cursor-pointer transition-colors align-middle"
                      onClick={() => openQuickView(o.id)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault(); openQuickView(o.id);
                        }
                      }}
                      aria-label={"Open opportunity " + o.customer_name}>
                      <td className="sticky left-0 z-10 bg-card group-hover:bg-secondary px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate font-medium text-[12px]" title={o.customer_name}>
                            {o.customer_name}
                          </span>
                          {categoryName && <span title={[categoryName, o.product_details].filter(Boolean).join(" · ")}
                            className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {categoryName}
                          </span>}
                        </div>
                        {o.status !== "open" && <span className="text-[10px] text-muted-foreground">{STATUS_LABELS[o.status] || o.status}</span>}
                        <span className="sr-only">Product details: {o.product_details || "Not specified"}</span>
                      </td>
                      <td className="px-3 py-3 text-[12px] whitespace-nowrap">
                        <span className="inline-flex rounded-md bg-secondary/80 px-2 py-1 text-[11px] font-medium">
                          {maps.stage[o.stage_id]?.name || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 min-w-0">
                        {/* Fixed two-line owner/handler layout for every Pipeline.
                            Working With stays inline with the SM, never a third row. */}
                        <div className="flex h-[40px] min-w-0 flex-col justify-center gap-0.5">
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
                              <span className="inline-flex max-w-[116px] shrink-0 items-center gap-1 overflow-hidden rounded-md border border-sky-100 bg-sky-50 px-1.5 text-[10px] leading-[16px] text-sky-800"
                                title={"Working With: " + teamLabels.join(", ")}>
                                <span className="shrink-0 font-medium">With</span>
                                <span className="min-w-0 truncate">{teamLabels[0]}</span>
                                {teamLabels.length > 1 && <span className="shrink-0">+{teamLabels.length - 1}</span>}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {regionContext.showColumn && <td className="px-3 py-3 text-[11px] text-muted-foreground" title={regionName}>
                        <span className="line-clamp-2">{regionName}</span>
                      </td>}
                      <td className="px-3 py-3 text-[11px] text-muted-foreground whitespace-nowrap">
                        {formatMonth(o.expected_close_month)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums whitespace-nowrap">
                        {formatTHB(o.pipeline_value)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="font-medium tabular-nums text-[11px] whitespace-nowrap"
                          title={age === null ? "Original stage-entered date unavailable (legacy import)" : "Days in current Stage: " + age}>{age === null ? "Unknown" : `${age}d` }</div>
                        <div className="mt-0.5"><OverdueTags op={o} stages={maps.stage} stageWatchDays={config?.stage_watch_days} tasks={taskEntries} /></div>
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