import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useData } from "@/lib/dataContext";
import PipelineTaskPanel from "@/components/PipelineTaskPanel";
import { formatNetRc as formatTHB } from "@/lib/netRc";
import { formatMonth, formatDate, agingDays, STATUS_LABELS } from "@/lib/pipeline";
import HistoryTimeline from "@/components/HistoryTimeline";
import OpportunityForm from "@/components/OpportunityForm";
import { PipelineQuickActions } from "@/components/PipelineQuickView";
import PipelineCloseActions from "@/components/PipelineCloseActions";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { actionableErrorMessage } from "@/lib/actionFeedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Pencil, Users, Archive, RefreshCw, CalendarClock, MoreHorizontal, Copy } from "lucide-react";
import SupportToggleAction from "@/components/SupportToggleAction";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const statusColor = {
  open: "bg-blue-100 text-blue-700 border border-blue-200",
  won: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  lost: "bg-rose-100 text-rose-700 border border-rose-200",
  archived: "bg-secondary text-muted-foreground border border-border",
};

export default function OpportunityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { opportunities, maps, activeStages, master, profile, moveStage, handoff, reassign, archiveOp, reopen, changeCloseMonth, setWorkingWith, setSupport } = useData();
  const op = opportunities.find((o) => o.id === id);

  const [editOpen, setEditOpen] = useState(false);
  const [action, setAction] = useState(null); // {type, ...}
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  if (!op) {
    return <EmptyState title="Pipeline not found" description="It may be outside your permission scope or has been removed." icon={ArrowLeft} action={<Button onClick={() => navigate("/pipeline")}>Back to Pipeline</Button>} />;
  }

  const owner = maps.member[op.owner_id];
  const originalOwner = maps.member[op.original_owner_id];
  const handler = maps.member[op.current_handler_id];
  const region = maps.region[op.region_id];
  const territory = maps.territory[op.territory_id];
  const category = maps.category[op.product_category_id];
  const stage = maps.stage[op.stage_id];
  const scenario = maps.scenario[op.scenario_id];
  const lostReason = maps.lostReason[op.lost_reason_id];

  const members = (master?.TeamMember || []).filter((m) => m.active);
  const stageAging = agingDays(op.stage_entered_at);
  const handlerAging = agingDays(op.handler_since);
  const workingTeams = String(op.working_with_team_ids || "").split(",").filter(Boolean)
    .map(x => (master?.WorkingWithOption || []).find(t=>t.id===x)?.name || x);

  const closeAction = () => {
    if (saving) return;
    setAction(null);
    setRemark("");
    setActionError("");
  };

  const runAction = async () => {
    const a = action;
    if (!a || saving) return;
    setSaving(true);
    setActionError("");
    try {
      if (a.type === "stage") await moveStage(op.id, a.stageId, remark);
      else if (a.type === "handoff") await handoff(op.id, a.handlerId, remark);
      else if (a.type === "reassign") await reassign(op.id, { owner_id: a.ownerId, current_handler_id: a.handlerId, remark });
      else if (a.type === "closemonth") await changeCloseMonth(op.id, a.month, remark);
      else if (a.type === "archive") await archiveOp(op.id);
      else if (a.type === "reopen") await reopen(op.id, remark);
      else if (a.type === "workingwith") await setWorkingWith(op.id, a.value);
      else if (a.type === "support") await setSupport(op.id, { needed: a.needed, type: a.type_, note: a.note });
      else throw new Error("Unsupported action");
      setAction(null);
      setRemark("");
    } catch (error) {
      setActionError(actionableErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const canEdit = op.status === "open" && (
    ["admin", "sm", "management"].includes(profile?.app_role) ||
    op.owner_id === profile?.id || op.current_handler_id === profile?.id
  );
  const canReassignOwner = ["sm", "management", "admin"].includes(profile?.app_role);
  const canChangeArchiveState = canReassignOwner;

  return (
    <div className="mx-auto max-w-[1440px] p-4 md:p-6 lg:p-8">
      <button type="button" onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Pipeline
      </button>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">{op.customer_name}</h1>
            <Badge className={statusColor[op.status]}>{STATUS_LABELS[op.status]}</Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{region?.name || "Not assigned"} · AE: {owner?.name || "Not assigned"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{category?.name || "—"}{op.product_details ? ` · ${op.product_details}` : ""}</p>
        </div>
        {(canEdit || canChangeArchiveState) && <div className="flex flex-wrap items-center gap-2">
          {canEdit && <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Pencil className="mr-1.5 h-4 w-4" />Edit</Button>}
          {canEdit && canReassignOwner && <Button size="sm" variant="outline" onClick={() => setAction({ type: "reassign" })}><Users className="mr-1.5 h-4 w-4" />Reassign</Button>}
          {canEdit && <PipelineCloseActions op={op} compact />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><MoreHorizontal className="mr-1.5 h-4 w-4" />More</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && <DropdownMenuItem onSelect={() => setAction({ type: "closemonth" })}><CalendarClock className="mr-2 h-4 w-4" />Change Close Month</DropdownMenuItem>}
              {canChangeArchiveState && op.status !== "archived" && <DropdownMenuItem onSelect={() => setAction({ type: "archive" })}><Archive className="mr-2 h-4 w-4" />Archive Pipeline</DropdownMenuItem>}
              {canChangeArchiveState && op.status !== "open" && <DropdownMenuItem onSelect={() => setAction({ type: "reopen" })}><RefreshCw className="mr-2 h-4 w-4" />Reopen Pipeline</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.85fr)_minmax(290px,1fr)]">
        <div className="min-w-0 rounded-2xl border bg-card px-5 md:px-7">
          <DetailSection number="01" title="Customer Information">
            <Field label="AE Owner" value={owner?.name || op.owner_id} />
            <Field label="Customer Name" value={op.customer_name} />
            <Field label="Business ID" value={<span className="inline-flex flex-wrap items-center gap-2"><span className="tabular-nums">{op.business_id}</span>{op.business_id && <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Copy Business ID" title="Copy Business ID" onClick={() => navigator.clipboard?.writeText(String(op.business_id))}><Copy className="h-3.5 w-3.5"/></button>}</span>} />
            <Field label="Customer Type" value={op.customer_type} />
            <Field label="Sales Channel" value={op.sales_channel} />
            {op.partner_name && <Field label="Partner Name" value={op.partner_name} />}
            <Field label="Contact Name" value={op.contact_name} />
            <Field label="Contact Phone" value={op.contact_phone ? <a className="hover:underline" href={`tel:${String(op.contact_phone).replace(/[^+0-9]/g,"")}`}>{op.contact_phone}</a> : "Not provided"} />
            <Field wide label="Remark" value={op.remark || "No remark"} />
          </DetailSection>

          <DetailSection number="02" title="Product & Value">
            <Field label="Product Category" value={category?.name} />
            <Field label="Product Description" value={op.product_details} />
            <Field label="Number of Subs" value={op.quantity} />
            <Field label="Price per Sub (THB/Month)" value={op.price_per_sub != null ? formatTHB(op.price_per_sub) : "Legacy value"} />
            <Field label="OC (THB)" value={op.oc != null ? formatTHB(op.oc) : "—"} />
            <Field label="Contract Period" value={op.contract_period ? `${op.contract_period} months` : "—"} />
            <div className="col-span-full rounded-r-lg border-l-[3px] border-red-600 bg-secondary/35 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{op.price_per_sub == null ? "Pipeline Value (Legacy)" : "Net RC / Month"}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{formatTHB(op.pipeline_value)}</div>
              {op.price_per_sub != null && <p className="mt-1 text-xs text-muted-foreground">Number of Subs × Price per Sub + OC ÷ 12</p>}
            </div>
          </DetailSection>

          <DetailSection number="03" title="Pipeline Information">
            <Field label="Current Stage" value={stage?.name} />
            <Field label="Expected Close Month" value={formatMonth(op.expected_close_month)} />
            <Field label="Stage Entered" value={`${formatDate(op.stage_entered_at)} · ${stageAging} days`} />
            <Field label="Created" value={`${formatDate(op.created_date)} · ${maps.member[op.created_by_user_id]?.name || "—"}`} />
            <Field label="Scenario" value={scenario?.name || "Pending SM Review"} />
            <Field label="CCP+ Check" value={{
              not_in_base: "Not in Base (New Customer)",
              enterprise_base: "Enterprise Existing Base",
              pending: "Pending Review",
            }[op.ccp_check_result] || op.ccp_check_result || "Pending SM Review"} />
          </DetailSection>

          <DetailSection number="04" title="Ownership & Support">
            <Field label="Current Handler" value={handler ? `${handler.name} · ${(handler.app_role || "").toUpperCase()}` : op.current_handler_id} />
            <Field label="Handler Since" value={`${formatDate(op.handler_since)} · ${handlerAging} days`} />
            <Field label="Region" value={region?.name} />
            <Field label="Territory" value={territory?.name || "Not assigned"} />
            {originalOwner && originalOwner.id !== op.owner_id && <Field label="Original Owner" value={originalOwner.name} />}
            <div className="col-span-full border-t pt-4">
              <h3 className="mb-2 text-sm font-semibold">Working With</h3>
              <div className="flex flex-wrap gap-2">
                {workingTeams.length ? workingTeams.map((team) => <span key={team} className="rounded-md border bg-secondary/50 px-2.5 py-1 text-xs font-medium">{team}</span>)
                : <span className="text-sm text-muted-foreground">{op.working_with || "Not assigned"}</span>}
              </div>
            </div>
            <div className="col-span-full border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Needs Support</h3>
                  <Badge variant="outline" className={op.support_needed ? "border-amber-200 bg-amber-50 text-amber-800" : "text-muted-foreground"}>{op.support_needed ? "Yes" : "No"}</Badge>
                </div>
                <SupportToggleAction op={op} canEdit={canEdit} />
              </div>
              {op.support_needed && <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Support Type" value={op.support_type} />
                <Field wide label="Support Note" value={op.support_note} />
              </div>}
              {!op.support_needed && <p className="mt-2 text-xs text-muted-foreground">No support requested</p>}
            </div>
          </DetailSection>

          {op.status !== "open" && <DetailSection number="—" title="Closure">
            {op.status === "won" && <Field label="Won At" value={formatDate(op.won_at)} />}
            {op.status === "won" && <Field label="Won By" value={maps.member[op.won_by]?.name} />}
            {op.status === "lost" && <Field label="Lost At" value={formatDate(op.lost_at)} />}
            {op.status === "lost" && <Field label="Lost By" value={maps.member[op.lost_by]?.name} />}
            {op.status === "lost" && <Field label="Lost Reason" value={lostReason?.name} />}
            {op.status === "lost" && <Field wide label="Lost Note" value={op.lost_note} />}
            {op.status === "archived" && <Field label="Archived At" value={formatDate(op.archived_at)} />}
          </DetailSection>}
        </div>
        <aside className="min-w-0 xl:sticky xl:top-5">
          <div className="rounded-2xl border bg-card p-4 shadow-soft md:p-5">
            <h2 className="mb-4 text-base font-semibold">Quick Update</h2>
            <PipelineQuickActions op={op} />
          <PipelineTaskPanel op={op} />
          </div>
        </aside>
      </div>

      <section className="mt-6 rounded-2xl border bg-card p-5 md:p-7" aria-label="Activity History">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-sm font-bold text-red-600">05</span>
          <h2 className="text-base font-semibold">Activity History</h2>
        </div>
        <HistoryTimeline opportunityId={op.id} revision={op.updated_date} />
      </section>

      <OpportunityForm open={editOpen} onClose={() => setEditOpen(false)} opportunity={op} />

      {/* Action dialog */}
      <Dialog open={!!action} onOpenChange={(o) => !o && closeAction()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionTitle(action)}</DialogTitle>
          </DialogHeader>
          <ActionBody action={action} setAction={setAction} remark={remark} setRemark={setRemark}
            members={members} stages={activeStages} supportTypes={(master?.SupportType || []).filter((s) => s.active)} op={op} />
          {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={closeAction} disabled={saving}>Cancel</Button>
            <Button onClick={runAction} disabled={saving || !actionValid(action, remark)}>{saving ? "Saving…" : "Confirm"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function actionTitle(action) {
  if (action?.type === "support")
    return action.needed ? "Mark Needs Support" : "Remove Needs Support?";
  return ({
    reassign: "Reassign", closemonth: "Change Close Month",
    archive: "Archive", reopen: "Reopen",
    workingwith: "Set Working With",
  })[action?.type] || "Action";
}

function actionValid(a, remark = "") {
  if (!a) return false;
  if (a.type === "reopen") return !!remark.trim();
  if (a.type === "stage") return !!a.stageId;
  if (a.type === "handoff") return !!a.handlerId;
  if (a.type === "reassign") return !!a.ownerId || !!a.handlerId;
  if (a.type === "closemonth") return !!a.month;
  if (a.type === "support") return !a.needed || (!!a.type_ && !!String(a.note||"").trim());
  return true;
}

function ActionBody({ action, setAction, remark, setRemark, members, stages, supportTypes, op }) {
  if (!action) return null;
  const t = action.type;
  const allowed = members.filter((m) => (m.region_ids || []).includes(op.region_id));
  const memberOpts = allowed.filter((m) => ["ae", "sm"].includes(m.app_role))
    .map((m) => ({ id: m.id, label: `${m.name} (${m.app_role.toUpperCase()})` }));
  const ownerOpts = allowed.filter((m) => m.app_role === "ae")
    .map((m) => ({ id: m.id, label: m.name }));
  if (t === "stage")
    return (
      <div className="space-y-2">
        <Label>New Stage</Label>
        <Select value={action.stageId || ""} onValueChange={(v) => setAction({ ...action, stageId: v })}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
        <RemarkField remark={remark} setRemark={setRemark} />
      </div>
    );
  if (t === "handoff")
    return (
      <div className="space-y-2">
        <Label>New Handler</Label>
        <Select value={action.handlerId || ""} onValueChange={(v) => setAction({ ...action, handlerId: v })}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{memberOpts.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
        </Select>
        <RemarkField remark={remark} setRemark={setRemark} />
      </div>
    );
  if (t === "reassign")
    return (
      <div className="space-y-2">
        <Label>AE Owner</Label>
        <Select value={action.ownerId || ""} onValueChange={(v) => setAction({ ...action, ownerId: v })}>
          <SelectTrigger><SelectValue placeholder="Keep current" /></SelectTrigger>
          <SelectContent>{ownerOpts.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
        </Select>
        <Label>Current Handler</Label>
        <Select value={action.handlerId || ""} onValueChange={(v) => setAction({ ...action, handlerId: v })}>
          <SelectTrigger><SelectValue placeholder="Keep current" /></SelectTrigger>
          <SelectContent>{memberOpts.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
        </Select>
        <RemarkField remark={remark} setRemark={setRemark} />
      </div>
    );
  if (t === "closemonth") {
    return (
      <div className="space-y-2">
        <Label>New Expected Close Month</Label>
        <Input type="month" value={action.month || op.expected_close_month || ""} onChange={(e) => setAction({ ...action, month: e.target.value })} />
        <RemarkField remark={remark} setRemark={setRemark} />
      </div>
    );
  }
  if (t === "workingwith") {
    const opts = ["", "Presales", "Pricing", "Product", "Fulfillment", "Operation", "Other"];
    return (
      <div className="space-y-2">
        <Label>Working With</Label>
        <Select value={action.value || ""} onValueChange={(v) => setAction({ ...action, value: v })}>
          <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
          <SelectContent>{opts.filter(Boolean).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    );
  }
  if (t === "support") {
    if (!action.needed) return <DialogDescription>
      Remove the Needs Support flag from this Pipeline? Support Type and Note will be
      cleared from its current details. The change will remain in Pipeline History.
    </DialogDescription>;
    return (
      <div className="space-y-2">
        <Label>Support Type</Label>
        <Select value={action.type_ || ""} onValueChange={(v) => setAction({ ...action, type_: v })} disabled={!action.needed}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{(supportTypes || []).map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
        <Label>Support Note</Label>
        <Textarea value={action.note || ""} onChange={(e) => setAction({ ...action, note: e.target.value })} rows={2} />
      </div>
    );
  }
  if (t === "reopen") return (
    <div className="space-y-2">
      <DialogDescription>Reopen this Pipeline. Your reason will be saved in Pipeline History.</DialogDescription>
      <Label htmlFor="reopen-reason">Reason for Reopen <span className="text-red-600">*</span></Label>
      <Textarea id="reopen-reason" required maxLength={500} value={remark} onChange={(e) => setRemark(e.target.value)} rows={3} placeholder="Explain why this Pipeline needs to be reopened" />
    </div>
  );
  if (t === "archive")
    return <DialogDescription>Confirm Archive. A history entry will be recorded automatically.</DialogDescription>;
  return null;
}

function RemarkField({ remark, setRemark }) {
  return (
    <>
      <Label>Remark (optional)</Label>
      <Textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} placeholder="Short note…" />
    </>
  );
}

function DetailSection({ number, title, children }) {
  return (
    <section className="border-b py-6 last:border-b-0">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-sm font-bold text-red-600">{number}</span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, value, wide = false }) {
  return (
    <div className={wide ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="break-words text-sm leading-relaxed text-foreground">{value || value === 0 ? value : "—"}</div>
    </div>
  );
}
