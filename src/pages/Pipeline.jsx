import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useData } from "@/lib/dataContext";
import { formatNetRc as formatTHB } from "@/lib/netRc";
import { agingDays, formatMonth, STATUS_LABELS , monthOf } from "@/lib/pipeline";
import { downloadPipelineExcel } from "@/lib/pipelineExport";
import { db } from "@/api/client";
import { isStageSlaOverdue, isInternalSlaOverdue } from "@/lib/dashboardMetrics";
import PipelineCard from "@/components/PipelineCard";
import FilterBar from "@/components/FilterBar";
import RegionQuickFilter from "@/components/dashboard/RegionQuickFilter";
import {shouldClearOwnerOnRegionChange, matchesPipelineSearch} from "@/lib/pipelineFilterUi";
import { sortPipelineRows, smWorkingWithTeamLabels, regionDisplayContext } from "@/lib/pipelineListPresentation";
import OpportunityForm from "@/components/OpportunityForm";
import PipelineQuickView from "@/components/PipelineQuickView";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KanbanSquare, List, Plus, Download, AlertTriangle, RefreshCw } from "lucide-react";

const SORTS = [
  { value: "close_month", label: "Close Month ↑ · Net RC ↓" },
  { value: "value_desc", label: "Value — High to Low" },
  { value: "value_asc", label: "Value — Low to High" },
  { value: "stage_aging_desc", label: "Stage Aging — Longest First" },
  { value: "handler_aging_desc", label: "Handler Aging — Longest First" },
  { value: "updated_desc", label: "Recently Updated" },
  { value: "created_desc", label: "Created Date" },
  { value: "customer_asc", label: "Customer Name A-Z" },
  { value: "support_first", label: "Support Needed First" },
];



export default function Pipeline() {
  const { scopedOpportunities, opportunities, activeStages, maps, master, profile, config, loading, error, refresh } = useData();
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
    if (params.get("view") === "assigned-to-me" || params.get("assigned") === "me") f.handler = profile?.id;
    if (params.get("view") === "support-needed" || params.get("support") === "1") f.support = "1";
    if (params.get("stuck") === "1") f.stuck = "1";
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
  }, [params, profile?.id]);

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
      if (key === "region" && shouldClearOwnerOnRegionChange(
        f.owner, value, master?.TeamMember || [], scopedOpportunities
      )) next.owner = "";
      return next;
    });
  };

  const filteredWithoutStage = useMemo(() => {
    return scopedOpportunities.filter((o) => {
      if (!matchesPipelineSearch(o, filters.search)) return false;
      if (filters.created_month && o.created_month !== filters.created_month) return false;
      if (filters.close_month && o.expected_close_month !== filters.close_month) return false;
      if (filters.region && o.region_id !== filters.region) return false;
      if (filters.owner && o.owner_id !== filters.owner) return false;
      if (filters.handler && o.current_handler_id !== filters.handler) return false;
      if (filters.status && filters.status !== "all" && o.status !== filters.status) return false;
      if (filters.sm_info === "missing" &&
          (o.status !== "open" ||
            (o.scenario_id && o.ccp_check_result && o.ccp_check_result !== "pending"))) return false;
      if (filters.product_category && o.product_category_id !== filters.product_category) return false;
      if (filters.sales_channel && o.sales_channel !== filters.sales_channel) return false;
      if (filters.ccp_check_result && o.ccp_check_result !== filters.ccp_check_result) return false;
      if (filters.scenario && o.scenario_id !== filters.scenario) return false;
      if (filters.working_with) {
        const teamId = (master?.WorkingWithOption || [])
          .find(t => t.name === filters.working_with)?.id;
        const teamIds = String(o.working_with_team_ids || "")
          .split(",").map(id => id.trim()).filter(Boolean);
        if (o.working_with !== filters.working_with &&
            (!teamId || !teamIds.includes(teamId))) return false;
      }
      if (filters.support === "1" && !o.support_needed) return false;
      if (filters.support === "0" && o.support_needed) return false;
      if (filters.stuck === "1" && !isStageSlaOverdue(o, maps.stage)) return false;
      if (filters.internal_overdue === "1" && !isInternalSlaOverdue(o, config?.internal_task_sla_days)) return false;
      if (filters.won_month && monthOf(o.won_at) !== filters.won_month) return false;
      if (filters.lost_month && monthOf(o.lost_at) !== filters.lost_month) return false;
      if (filters.lost_reason && o.lost_reason_id !== filters.lost_reason) return false;
      return true;
    });
  }, [scopedOpportunities, filters, config, maps.stage, master?.WorkingWithOption]);

  const filtered = useMemo(() => filters.stage
    ? filteredWithoutStage.filter((o) => o.stage_id === filters.stage)
    : filteredWithoutStage, [filteredWithoutStage, filters.stage]);
  const sorted = useMemo(() => sortPipelineRows(filtered, sort), [filtered, sort]);
  // This is a presentation-only selector, never a replacement for server RBAC.
  // Match the Dashboard's region choices: Admin sees active Regions; all other
  // roles see only their own active User_Region assignments.
  const quickRegions = useMemo(() => (master?.Region || [])
    .filter((region) => region.active && (
      profile?.app_role === "admin" || (profile?.region_ids || []).includes(region.id)
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


  return (
    <div className="p-4 md:p-5 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{params.get("view") === "assigned-to-me" ? "Assigned to Me" : params.get("view") === "support-needed" ? "Needs Support" : "All Opportunities"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sorted.length} opportunities · {formatTHB(totalValue)}
            <span className="mx-2 text-border" aria-hidden="true">·</span>
            <span aria-label={"Region scope: " + regionContext.label}>{regionContext.label}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canExport && (
            <Button variant="outline" size="sm" className="rounded-lg" disabled={exporting} onClick={exportExcel}>
              <Download className="w-4 h-4 mr-1.5" /> {exporting ? "Generating Excel…" : "Export Excel"}
            </Button>
          )}
          <Button size="sm" className="rounded-lg" onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Pipeline
          </Button>
        </div>
      </div>

      {exportError && <p role="alert" className="text-sm text-red-600 mb-3">{exportError}</p>}
      {loading && <p role="status" className="text-sm text-muted-foreground mb-3">Loading Pipeline and access permissions…</p>}
      {error && (
        <div role="alert" className="flex flex-wrap gap-3 items-center justify-between rounded-xl border border-red-200 bg-red-50/70 p-3 mb-4 text-sm text-red-800">
          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> Unable to load data: {error.message}</span>
          <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Retry
          </Button>
        </div>
      )}
      {!loading && !error && scopedOpportunities.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground mb-3">
          {opportunities.length > 0
            ? "Pipeline records were returned, but none match your access scope. Check the User_Region mapping and deployment settings."
            : "No Pipelines are available for this account. If you expect records, check the deployment and access settings."}
        </p>
      )}
      <div className="rounded-xl border border-border bg-card p-3 mb-4">
        <FilterBar filters={filters} onFilter={onFilter} stageChipsVisible={view === "list"}
          showRegionControl={!hasRegionQuickFilter} />
      </div>

      {hasRegionQuickFilter && (
        <div className="mb-3">
          <RegionQuickFilter regions={quickRegions} value={filters.region || ""}
            onChange={(regionId) => onFilter("region", regionId)} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">

        <div className="inline-flex rounded-xl bg-secondary p-1" role="group" aria-label="Pipeline view">
          <button type="button" aria-pressed={view === "list"}
            onClick={() => setView("list")}
            className={view === "list"
              ? "flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg bg-card text-foreground shadow-soft font-medium"
              : "flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg text-muted-foreground hover:text-foreground"}>
            <List className="w-4 h-4" /> List
          </button>
          <button type="button" aria-pressed={view === "board"}
            onClick={() => setView("board")}
            className={view === "board"
              ? "flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg bg-card text-foreground shadow-soft font-medium"
              : "flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg text-muted-foreground hover:text-foreground"}>
            <KanbanSquare className="w-4 h-4" /> Board
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Sort</span>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[234px] max-w-[65vw] h-9 rounded-lg"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>


      {view === "list" && (
        <div className="flex items-center gap-2 flex-wrap mb-3" role="group" aria-label="Quick filter by Stage">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">Stage</span>
          <button type="button" onClick={() => onFilter("stage", "")}
            aria-pressed={!filters.stage}
            className={!filters.stage
              ? "rounded-full px-3 py-1.5 border border-primary/40 bg-brand-tint text-brand text-[11px] font-medium"
              : "rounded-full px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground text-[11px]"}>
            All Stages <span className="ml-1 text-[10px] opacity-75 tabular-nums">{filteredWithoutStage.length}</span>
          </button>
          {activeStages.map((stage) => (
            <button type="button" key={stage.id} onClick={() => onFilter("stage", stage.id)}
              aria-pressed={filters.stage === stage.id}
              className={filters.stage === stage.id
                ? "rounded-full px-3 py-1.5 border border-primary/40 bg-brand-tint text-brand text-[11px] font-medium"
                : "rounded-full px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground text-[11px]"}>
              {stage.name} <span className="ml-1 text-[10px] opacity-75 tabular-nums">{stageCounts.get(stage.id) || 0}</span>
            </button>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState title="No Pipelines match" description="Try adjusting filters or create a new Pipeline." icon={KanbanSquare} />
      ) : view === "board" ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {activeStages.map((stage) => {
              const stageOps = sorted.filter((o) => o.stage_id === stage.id);
              const stageValue = stageOps.reduce((a, o) => a + (o.pipeline_value || 0), 0);
              return (
                <div key={stage.id} className="flex flex-col w-[280px] shrink-0">
                  <div className="flex items-center justify-between mb-2.5 px-1">
                    <span className="font-medium text-[13px]">{stage.name}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums bg-secondary rounded-md px-2 py-0.5">{stageOps.length} · {formatTHB(stageValue)}</span>
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
        </DragDropContext>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto" aria-label="Pipeline opportunities table" tabIndex={0}>
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
              <thead className="bg-secondary/50 text-muted-foreground">
                <tr>
                  <th scope="col" className="sticky left-0 z-20 bg-secondary text-left font-medium px-3 py-3 text-[11px]">Opportunity</th>
                  <th scope="col" className="text-left font-medium px-3 py-3 text-[11px]">Stage</th>
                  <th scope="col" className="text-left font-medium px-3 py-3 text-[11px]">AE Owner / Handling</th>
                  {regionContext.showColumn && <th scope="col" className="text-left font-medium px-3 py-3 text-[11px]">Region</th>}
                  <th scope="col" className="text-left font-medium px-3 py-3 text-[11px]">Close Month</th>
                  <th scope="col" className="text-right font-medium px-3 py-3 text-[11px]">Net RC</th>
                  <th scope="col" className="text-right font-medium px-3 py-3 text-[11px]">Stage Age / Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {sorted.map((o) => {
                  const ownerName = maps.member[o.owner_id]?.name || "Unassigned";
                  const handler = maps.member[o.current_handler_id];
                  const handlerName = handler?.name || "Unassigned";
                  const categoryName = maps.category[o.product_category_id]?.name || "";
                  const overdue = isStageSlaOverdue(o, maps.stage);
                  const age = agingDays(o.stage_entered_at);
                  const differentOwner = Boolean(o.current_handler_id && o.owner_id !== o.current_handler_id);
                  // Working With is a supporting-team indicator, not ownership.
                  // Inline it beside an assigned SM only; other collaborators
                  // remain visible in Pipeline Quick View without adding rows.
                  const teamLabels = smWorkingWithTeamLabels(o, handler, master?.WorkingWithOption || []);
                  const regionName = maps.region[o.region_id]?.name || o.region_id || "Unassigned";
                  return (
                    <tr key={o.id}
                      className="group h-[72px] hover:bg-secondary/35 cursor-pointer transition-colors align-middle"
                      onClick={() => openQuickView(o.id)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault(); openQuickView(o.id);
                        }
                      }}
                      aria-label={"Open opportunity " + o.customer_name}>
                      <td className="sticky left-0 z-10 bg-card group-hover:bg-secondary px-3 py-3">
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
                          title={"Days in current Stage: " + age}>{age}d</div>
                        {overdue && <div className="text-[10px] text-amber-700 mt-0.5" title="Stage SLA overdue">SLA overdue</div>}
                        {o.support_needed && <div className="text-[10px] text-orange-700 mt-0.5" title="Support needed">Support</div>}
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