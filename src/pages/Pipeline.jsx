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
import {shouldClearOwnerOnRegionChange, matchesPipelineSearch} from "@/lib/pipelineFilterUi";
import OpportunityForm from "@/components/OpportunityForm";
import PipelineQuickView from "@/components/PipelineQuickView";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KanbanSquare, List, Plus, Download, AlertTriangle, RefreshCw } from "lucide-react";

const SORTS = [
  { value: "close_month", label: "Expected Close Month" },
  { value: "value_desc", label: "Value — High to Low" },
  { value: "value_asc", label: "Value — Low to High" },
  { value: "stage_aging_desc", label: "Stage Aging — Longest First" },
  { value: "handler_aging_desc", label: "Handler Aging — Longest First" },
  { value: "updated_desc", label: "Recently Updated" },
  { value: "created_desc", label: "Created Date" },
  { value: "customer_asc", label: "Customer Name A-Z" },
  { value: "support_first", label: "Support Needed First" },
];



function applySort(ops, sort) {
  const arr = [...ops];
  switch (sort) {
    case "value_desc": return arr.sort((a, b) => (b.pipeline_value || 0) - (a.pipeline_value || 0));
    case "value_asc": return arr.sort((a, b) => (a.pipeline_value || 0) - (b.pipeline_value || 0));
    case "stage_aging_desc": return arr.sort((a, b) => agingDays(b.stage_entered_at) - agingDays(a.stage_entered_at));
    case "handler_aging_desc": return arr.sort((a, b) => agingDays(b.handler_since) - agingDays(a.handler_since));
    case "updated_desc": return arr.sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));
    case "created_desc": return arr.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    case "customer_asc": return arr.sort((a, b) => (a.customer_name || "").localeCompare(b.customer_name || ""));
    case "support_first": return arr.sort((a, b) => (b.support_needed ? 1 : 0) - (a.support_needed ? 1 : 0));
    case "close_month":
    default: return arr.sort((a, b) => (a.expected_close_month || "9999").localeCompare(b.expected_close_month || "9999"));
  }
}

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

  const filtered = useMemo(() => {
    return scopedOpportunities.filter((o) => {
      if (!matchesPipelineSearch(o, filters.search)) return false;
      if (filters.created_month && o.created_month !== filters.created_month) return false;
      if (filters.close_month && o.expected_close_month !== filters.close_month) return false;
      if (filters.region && o.region_id !== filters.region) return false;
      if (filters.owner && o.owner_id !== filters.owner) return false;
      if (filters.handler && o.current_handler_id !== filters.handler) return false;
      if (filters.stage && o.stage_id !== filters.stage) return false;
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

  const sorted = useMemo(() => applySort(filtered, sort), [filtered, sort]);
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
  // When every displayed opportunity has the same handler, state that once above
  // the table instead of repeating the same name in every row.
  const sharedHandlerId = sorted.length >= 3 &&
    sorted[0]?.current_handler_id &&
    sorted.every((o) => o.current_handler_id === sorted[0].current_handler_id) &&
    sorted.some((o) => o.owner_id !== sorted[0].current_handler_id)
      ? sorted[0].current_handler_id
      : null;
  const sharedHandlerName = sharedHandlerId
    ? maps.member[sharedHandlerId]?.name || sharedHandlerId
    : "";


  return (
    <div className="p-4 md:p-5 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{params.get("view") === "assigned-to-me" ? "Assigned to Me" : params.get("view") === "support-needed" ? "Needs Support" : "All Opportunities"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{sorted.length} opportunities · {formatTHB(totalValue)}</p>
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
        <FilterBar filters={filters} onFilter={onFilter} stageChipsVisible={view === "list"} />
      </div>

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
            <SelectTrigger className="w-[210px] h-9 rounded-lg"><SelectValue /></SelectTrigger>
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
            All Stages
          </button>
          {activeStages.map((stage) => (
            <button type="button" key={stage.id} onClick={() => onFilter("stage", stage.id)}
              aria-pressed={filters.stage === stage.id}
              className={filters.stage === stage.id
                ? "rounded-full px-3 py-1.5 border border-primary/40 bg-brand-tint text-brand text-[11px] font-medium"
                : "rounded-full px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground text-[11px]"}>
              {stage.name}
            </button>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState title="No Pipelines match" description="Try adjusting filters or create a new Pipeline." icon={KanbanSquare} />
      ) : view === "board" ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="relative">
            <div className="mb-2 text-right text-[11px] text-muted-foreground xl:hidden">
              Scroll horizontally to see all stages →
            </div>
            <div className="flex gap-3 overflow-x-auto pb-4" aria-label="Sales stages — scroll horizontally for more">
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
                                <PipelineCard op={op} onOpen={openQuickView} />
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
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent" />
          </div>
        </DragDropContext>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {sharedHandlerName && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-secondary/25 px-3 py-2 text-[11px] text-muted-foreground">
              <span>All shown opportunities are with</span>
              <span className="font-medium text-foreground">{sharedHandlerName}</span>
              <span>· Current Handler</span>
            </div>
          )}
          <div className="divide-y divide-border/70 md:hidden" role="list" aria-label="Pipeline opportunities">
            {sorted.map((o) => {
              const age = agingDays(o.stage_entered_at);
              const overdue = isStageSlaOverdue(o, maps.stage);
              return (
                <button key={o.id} type="button" role="listitem"
                  className="flex w-full flex-col gap-1.5 px-3 py-3 text-left hover:bg-secondary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => openQuickView(o.id)}
                  aria-label={"Open opportunity " + o.customer_name}>
                  <span className="flex min-w-0 items-start justify-between gap-3">
                    <span className="min-w-0 truncate text-[13px] font-semibold">{o.customer_name}</span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">{formatTHB(o.pipeline_value)}</span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{maps.stage[o.stage_id]?.name || "—"}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatMonth(o.expected_close_month)}</span>
                    <span aria-hidden="true">·</span>
                    <span className={overdue ? "font-semibold text-amber-700" : ""}>{age}d in stage</span>
                    {o.support_needed && <span className="inline-flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true"/>Needs Support
                    </span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block" aria-label="Pipeline opportunities table">
            <table className="w-full min-w-[1020px] table-fixed text-[12px]">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[9%]" />
                <col className="w-[26%]" />
                <col className="w-[12%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="bg-secondary/50 text-muted-foreground">
                <tr>
                  <th scope="col" className="text-left font-medium px-3 py-2 text-[11px]">Opportunity</th>
                  <th scope="col" className="text-left font-medium px-3 py-2 text-[11px]">Stage</th>
                  <th scope="col" className="text-left font-medium px-3 py-2 text-[11px]">
                    {sharedHandlerName ? "AE Owner" : "Handler / AE Owner"}
                  </th>
                  <th scope="col" className="text-left font-medium px-3 py-2 text-[11px]">Close</th>
                  <th scope="col" className="text-right font-medium px-3 py-2 text-[11px]">Net RC</th>
                  <th scope="col" className="text-right font-medium px-3 py-2 text-[11px]">Age / Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {sorted.map((o) => {
                  const ownerName = maps.member[o.owner_id]?.name || "Unassigned";
                  const handlerName = maps.member[o.current_handler_id]?.name || "Unassigned";
                  const categoryName = maps.category[o.product_category_id]?.name || "";
                  const overdue = isStageSlaOverdue(o, maps.stage);
                  const age = agingDays(o.stage_entered_at);
                  const differentOwner = o.owner_id !== o.current_handler_id;
                  return (
                    <tr key={o.id}
                      className="h-[54px] hover:bg-secondary/35 cursor-pointer transition-colors align-middle"
                      onClick={() => openQuickView(o.id)}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault(); openQuickView(o.id);
                        }
                      }}
                      aria-label={"Open opportunity " + o.customer_name}>
                      <td className="px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 truncate font-medium text-[12px]" title={o.customer_name}>
                            {o.customer_name}
                          </span>
                          {categoryName && (
                            <span title={[categoryName, o.product_details].filter(Boolean).join(" · ")}
                              className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {categoryName}
                            </span>
                          )}
                          {o.status !== "open" && (
                            <span className="shrink-0 text-[10px] font-semibold text-muted-foreground">
                              {STATUS_LABELS[o.status] || o.status}
                            </span>
                          )}
                        </div>
                        <div className="sr-only">Product details: {o.product_details || "Not specified"}</div>
                      </td>
                      <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                        {maps.stage[o.stage_id]?.name || "—"}
                      </td>
                      <td className="px-3 py-2 min-w-0">
                        {sharedHandlerName ? (
                          <div className="truncate text-[12px]" title={"AE Owner: " + ownerName}>{ownerName}</div>
                        ) : (
                          <>
                            <div className="truncate text-[12px]" title={"Current Handler: " + handlerName}>
                              {handlerName}
                            </div>
                            {differentOwner && (
                              <div className="truncate text-[10px] text-muted-foreground mt-0.5"
                                title={"AE Owner: " + ownerName}>Owner: {ownerName}</div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                        {formatMonth(o.expected_close_month)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">
                        {formatTHB(o.pipeline_value)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <span className={overdue ? "font-semibold tabular-nums text-amber-700" : "tabular-nums text-muted-foreground"}
                            title={overdue ? "Stage SLA overdue · " + age + " days in stage" : "Stage age · " + age + " days"}>
                            {age}d
                          </span>
                          {o.support_needed && (
                            <span role="img" aria-label="Needs Support" title="Needs Support">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                            </span>
                          )}
                        </div>
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