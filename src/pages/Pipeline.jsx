import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useData } from "@/lib/dataContext";
import { formatNetRc as formatTHB } from "@/lib/netRc";
import { formatMonth, agingDays, formatDate, STATUS_LABELS } from "@/lib/pipeline";
import { isStageSlaOverdue, isInternalSlaOverdue } from "@/lib/dashboardMetrics";
import PipelineCard from "@/components/PipelineCard";
import FilterBar from "@/components/FilterBar";
import OpportunityForm from "@/components/OpportunityForm";
import PipelineQuickView from "@/components/PipelineQuickView";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KanbanSquare, List, Plus, Download } from "lucide-react";

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

function monthOf(iso) { if (!iso) return ""; return iso.slice(0, 7); }

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

function exportCSV(ops, maps) {
  const headers = [
    "Opportunity ID", "Customer Name", "Business ID", "Customer Type",
    "Sales Channel", "Partner Name", "Contact Name", "Contact Phone", "Remark",
    "Product Category", "Product Details", "Number of Subs", "Price per Sub", "OC", "Contract Period",
    "Net RC (THB/Month)", "Scenario", "CCP+ Check",
    "Region", "Territory", "Opportunity Owner", "Current Handler",
    "Stage", "Status", "Created At", "Created Month", "Expected Close Month",
    "Stage Aging (days)", "Handler Aging (days)",
    "Working With", "Working With Aging (days)",
    "Support Needed", "Support Type", "Support Note",
    "Won At", "Lost At", "Lost Reason", "Lost Note", "Created By", "Updated At",
  ];
  const rows = ops.map((o) => [
    o.id, o.customer_name, o.business_id || "", o.customer_type || "",
    o.sales_channel || "", o.partner_name || "", o.contact_name || "", o.contact_phone || "", o.remark || "",
    maps.category[o.product_category_id]?.name || "", o.product_details || "",
    o.quantity ?? "", o.price_per_sub ?? "", o.oc ?? "", o.contract_period ?? "",
    Number(o.pipeline_value || 0).toFixed(2),
    maps.scenario[o.scenario_id]?.name || "", o.ccp_check_result || "",
    maps.region[o.region_id]?.name || "", maps.territory[o.territory_id]?.name || "",
    maps.member[o.owner_id]?.name || "", maps.member[o.current_handler_id]?.name || "",
    maps.stage[o.stage_id]?.name || "", STATUS_LABELS[o.status] || o.status,
    formatDate(o.created_date), o.created_month || "", formatMonth(o.expected_close_month),
    agingDays(o.stage_entered_at), agingDays(o.handler_since),
    o.working_with || "", o.working_with ? agingDays(o.working_with_since) : "",
    o.support_needed ? "Yes" : "No", o.support_type || "", o.support_note || "",
    formatDate(o.won_at), formatDate(o.lost_at), maps.lostReason[o.lost_reason_id]?.name || "", o.lost_note || "",
    maps.member[o.created_by_user_id]?.name || "", formatDate(o.updated_date),
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pipeline_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Pipeline() {
  const { scopedOpportunities, activeStages, maps, profile, config } = useData();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [view, setView] = useState("board");
  const [sort, setSort] = useState("close_month");
  const [formOpen, setFormOpen] = useState(false);
  const [quickView, setQuickView] = useState(null); // { id, targetStageId? }
  const [filters, setFilters] = useState({ status: "open" });

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
    if (params.get("status")) f.status = params.get("status");
    if (params.get("sort")) setSort(params.get("sort"));
    setFilters(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, profile?.id]);

  const onFilter = (key, value) => {
    if (key === "clear") {
      setFilters({ status: "open" });
      setParams({});
      setSort("close_month");
      return;
    }
    setFilters((f) => ({ ...f, [key]: value || "" }));
  };

  const filtered = useMemo(() => {
    return scopedOpportunities.filter((o) => {
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
  }, [scopedOpportunities, filters, config, maps.stage]);

  const sorted = useMemo(() => applySort(filtered, sort), [filtered, sort]);

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
          <Button variant="outline" size="sm" className="rounded-lg" onClick={() => exportCSV(sorted, maps)}>
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
          <Button size="sm" className="rounded-lg" onClick={() => setFormOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Pipeline
          </Button>
        </div>
      </div>

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