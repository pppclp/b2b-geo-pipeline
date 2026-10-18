import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useData } from "@/lib/dataContext";
import { formatNetRc as formatTHB } from "@/lib/netRc";
import { agingDays, formatMonth, STATUS_LABELS , monthOf } from "@/lib/pipeline";
import { downloadPipelineExcel } from "@/lib/pipelineExport";
import { db } from "@/api/client";
import { isStageSlaOverdue, isInternalSlaOverdue } from "@/lib/dashboardMetrics";
import { isPendingSmReview, roleOwnershipMatches } from "@/lib/roleFilterModel";
import PipelineCard from "@/components/PipelineCard";
import FilterBar from "@/components/FilterBar";
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
  const { scopedOpportunities, opportunities, activeStages, maps, profile, config, loading, error, refresh } = useData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [view, setView] = useState("board");
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
    if (params.get("search")) f.search = params.get("search");
    if (params.get("ownership_view")) f.ownership_view = params.get("ownership_view");
    if (params.get("with_me")) f.with_me = params.get("with_me");
    if (params.get("needs_review")) f.needs_review = params.get("needs_review");
    if (params.get("scenario")) f.scenario = params.get("scenario");
    if (params.get("working_with")) f.working_with = params.get("working_with");
    if (params.get("ccp_check_result")) f.ccp_check_result = params.get("ccp_check_result");
    if (params.get("close_month")) f.close_month = params.get("close_month");
    if (params.get("created_month")) f.created_month = params.get("created_month");
    if (params.get("won_month")) f.won_month = params.get("won_month");
    if (params.get("lost_month")) f.lost_month = params.get("lost_month");
    if (params.get("lost_reason")) f.lost_reason = params.get("lost_reason");
    if (params.get("stage")) f.stage = params.get("stage");
    if (params.get("status")) f.status = params.get("status");
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
    // Keep the existing Dashboard deep-link semantics while ensuring an AE
    // choosing a new ownership view does not retain an invisible Handler filter.
    const fromAssigned = params.get("view") === "assigned-to-me" || params.get("assigned") === "me";
    setFilters((f) => {
      const updated = { ...f, [key]: value || "" };
      if ((key === "ownership_view" || key === "with_me") && fromAssigned) delete updated.handler;
      return updated;
    });
    setParams((existing) => {
      const next = new URLSearchParams(existing);
      if (value && !(key === "status" && value === "open")) next.set(key, value);
      else next.delete(key);
      if (key === "ownership_view" || key === "with_me" || key === "handler") {
        if (fromAssigned && key !== "handler") next.delete("handler");
        next.delete("view");
        next.delete("assigned");
      }
      return next;
    }, { replace: true });
  };

  const filtered = useMemo(() => {
    return scopedOpportunities.filter((o) => {
      if (filters.search) {
        const needle = filters.search.trim().toLocaleLowerCase();
        if (needle && ![o.customer_name, o.business_id, o.contact_name]
          .some((term) => String(term || "").toLocaleLowerCase().includes(needle))) return false;
      }
      if (profile?.app_role === "ae" &&
          !roleOwnershipMatches(o, profile.id, filters.ownership_view)) return false;
      if (profile?.app_role === "sm" && filters.with_me === "1" &&
          o.current_handler_id !== profile.id) return false;
      if (["sm", "admin"].includes(profile?.app_role) && filters.needs_review === "1" &&
          !isPendingSmReview(o)) return false;
      if (filters.created_month && o.created_month !== filters.created_month) return false;
      if (filters.close_month && o.expected_close_month !== filters.close_month) return false;
      if (filters.region && o.region_id !== filters.region) return false;
      if (filters.owner && o.owner_id !== filters.owner) return false;
      if (filters.handler && o.current_handler_id !== filters.handler) return false;
      if (filters.stage && o.stage_id !== filters.stage) return false;
      if (filters.status && filters.status !== "all" && o.status !== filters.status) return false;
      if (filters.product_category && o.product_category_id !== filters.product_category) return false;
      if (filters.sales_channel && o.sales_channel !== filters.sales_channel) return false;
      if (filters.ccp_check_result && o.ccp_check_result !== filters.ccp_check_result) return false;
      if (filters.scenario && o.scenario_id !== filters.scenario) return false;
      if (filters.working_with && o.working_with !== filters.working_with) return false;
      if (filters.support === "1" && !o.support_needed) return false;
      if (filters.support === "0" && o.support_needed) return false;
      if (filters.stuck === "1" && !isStageSlaOverdue(o, maps.stage)) return false;
      if (filters.internal_overdue === "1" && !isInternalSlaOverdue(o, config?.internal_task_sla_days)) return false;
      if (filters.won_month && monthOf(o.won_at) !== filters.won_month) return false;
      if (filters.lost_month && monthOf(o.lost_at) !== filters.lost_month) return false;
      if (filters.lost_reason && o.lost_reason_id !== filters.lost_reason) return false;
      return true;
    });
  }, [scopedOpportunities, filters, config, maps.stage, profile]);

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

  return (
    <div className="p-5 md:p-7 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
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
      {loading && <p role="status" className="text-sm text-muted-foreground mb-3">กำลังโหลด Pipeline และสิทธิ์ผู้ใช้…</p>}
      {error && (
        <div role="alert" className="flex flex-wrap gap-3 items-center justify-between rounded-xl border border-red-200 bg-red-50/70 p-3 mb-4 text-sm text-red-800">
          <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" /> โหลดข้อมูลไม่สำเร็จ: {error.message}</span>
          <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> ลองโหลดใหม่
          </Button>
        </div>
      )}
      {!loading && !error && scopedOpportunities.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground mb-3">
          {opportunities.length > 0
            ? "Backend ส่ง Pipeline กลับมาแล้ว แต่ไม่ตรงกับ Role / Region Access ที่โหลดในหน้านี้ กรุณาตรวจ User_Region และการตั้งค่า Deployment"
            : "ยังไม่มี Pipeline ที่บัญชีนี้มีสิทธิ์เห็น ถ้าควรมีข้อมูล กรุณาตรวจ Apps Script Deployment, Users และ User_Region"}
        </p>
      )}
      <div className="rounded-2xl border border-border bg-card shadow-soft p-4 mb-5">
        <FilterBar filters={filters} onFilter={onFilter} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="inline-flex rounded-xl bg-secondary p-1">
          <button
            onClick={() => setView("board")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg transition-all ${view === "board" ? "bg-card text-foreground shadow-soft font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            <KanbanSquare className="w-4 h-4" /> Board
          </button>
          <button
            onClick={() => setView("list")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] rounded-lg transition-all ${view === "list" ? "bg-card text-foreground shadow-soft font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            <List className="w-4 h-4" /> List
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

      {sorted.length === 0 ? (
        <EmptyState title="No Pipelines match" description="Try adjusting filters or create a new Pipeline." icon={KanbanSquare} />
      ) : view === "board" ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {activeStages.map((stage) => {
              const stageOps = sorted.filter((o) => o.stage_id === stage.id);
              const stageValue = stageOps.reduce((a, o) => a + (o.pipeline_value || 0), 0);
              return (
                <div key={stage.id} className="flex flex-col w-72 shrink-0">
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
        </DragDropContext>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-3 text-xs uppercase tracking-wide">Customer</th>
                  <th className="text-left font-medium px-4 py-3 text-xs uppercase tracking-wide">Product & Details</th>
                  <th className="text-left font-medium px-4 py-3 text-xs uppercase tracking-wide">Stage</th>
                  <th className="text-left font-medium px-4 py-3 text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left font-medium px-4 py-3 text-xs uppercase tracking-wide">Owner</th>
                  <th className="text-left font-medium px-4 py-3 text-xs uppercase tracking-wide">Handler</th>
                  <th className="text-right font-medium px-4 py-3 text-xs uppercase tracking-wide">Net RC</th>
                  <th className="text-left font-medium px-4 py-3 text-xs uppercase tracking-wide">Close</th>
                  <th className="text-right font-medium px-4 py-3 text-xs uppercase tracking-wide">Stage Age</th>
                  <th className="text-left font-medium px-4 py-3 text-xs uppercase tracking-wide">Support</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((o) => (
                  <tr key={o.id} className="hover:bg-secondary/40 cursor-pointer transition-colors" onClick={() => openQuickView(o.id)}>
                    <td className="px-4 py-3 font-medium">{o.customer_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{maps.category[o.product_category_id]?.name}{o.product_details ? ` · ${o.product_details}` : ""}</td>
                    <td className="px-4 py-3">{maps.stage[o.stage_id]?.name}</td>
                    <td className="px-4 py-3">{STATUS_LABELS[o.status]}</td>
                    <td className="px-4 py-3">{maps.member[o.owner_id]?.name}</td>
                    <td className="px-4 py-3">{maps.member[o.current_handler_id]?.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatTHB(o.pipeline_value)}</td>
                    <td className="px-4 py-3">{formatMonth(o.expected_close_month)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{agingDays(o.stage_entered_at)}d</td>
                    <td className="px-4 py-3">{o.support_needed ? <span className="inline-flex items-center rounded-md bg-amber-100 text-amber-700 px-1.5 py-0.5 text-xs">Yes</span> : "—"}</td>
                  </tr>
                ))}
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