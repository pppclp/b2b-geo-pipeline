import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useData } from "@/lib/dataContext";
import { formatTHB, formatMonth, formatDate, formatDateTime, agingDays, STATUS_LABELS } from "@/lib/pipeline";
import HistoryTimeline from "@/components/HistoryTimeline";
import OpportunityForm from "@/components/OpportunityForm";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Pencil, ArrowRightLeft, Users, GitBranch, Trophy, XCircle, Archive, RefreshCw, CalendarClock, Wrench } from "lucide-react";

const statusColor = {
  open: "bg-blue-100 text-blue-700 border border-blue-200",
  won: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  lost: "bg-rose-100 text-rose-700 border border-rose-200",
  archived: "bg-secondary text-muted-foreground border border-border",
};

export default function OpportunityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { opportunities, maps, activeStages, master, profile, moveStage, handoff, reassign, markWon, markLost, archiveOp, reopen, changeCloseMonth, setWorkingWith, setSupport } = useData();
  const op = opportunities.find((o) => o.id === id);

  const [editOpen, setEditOpen] = useState(false);
  const [action, setAction] = useState(null); // {type, ...}
  const [remark, setRemark] = useState("");

  if (!op) {
    return <EmptyState title="Opportunity not found" description="It may be outside your permission scope or has been removed." icon={ArrowLeft} action={<Button onClick={() => navigate("/pipeline")}>Back to Pipeline</Button>} />;
  }

  const owner = maps.member[op.owner_id];
  const originalOwner = maps.member[op.original_owner_id];
  const handler = maps.member[op.current_handler_id];
  const region = maps.region[op.region_id];
  const territory = maps.territory[op.territory_id];
  const category = maps.category[op.product_category_id];
  const product = maps.product[op.product_id];
  const stage = maps.stage[op.stage_id];
  const scenario = maps.scenario[op.scenario_id];
  const lostReason = maps.lostReason[op.lost_reason_id];

  const members = (master?.TeamMember || []).filter((m) => m.active);
  const stageAging = agingDays(op.stage_entered_at);
  const handlerAging = agingDays(op.handler_since);
  const wwAging = op.working_with ? agingDays(op.working_with_since) : 0;

  const closeAction = () => { setAction(null); setRemark(""); };

  const runAction = async () => {
    const a = action;
    if (a.type === "stage") await moveStage(op.id, a.stageId, remark);
    else if (a.type === "handoff") await handoff(op.id, a.handlerId, remark);
    else if (a.type === "reassign") await reassign(op.id, { owner_id: a.ownerId, current_handler_id: a.handlerId, remark });
    else if (a.type === "closemonth") await changeCloseMonth(op.id, a.month, remark);
    else if (a.type === "lost") await markLost(op.id, { reason_id: a.reasonId, note: a.note });
    else if (a.type === "won") await markWon(op.id);
    else if (a.type === "archive") await archiveOp(op.id);
    else if (a.type === "reopen") await reopen(op.id);
    else if (a.type === "workingwith") await setWorkingWith(op.id, a.value);
    else if (a.type === "support") await setSupport(op.id, { needed: a.needed, type: a.type_, note: a.note });
    closeAction();
  };

  const canEdit = profile?.app_role === "admin" || profile?.app_role === "sm" || op.owner_id === profile?.id || op.current_handler_id === profile?.id;

  return (
    <div className="p-5 md:p-7 max-w-[1200px] mx-auto">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 px-2.5 py-1 rounded-lg hover:bg-secondary transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{op.customer_name}</h1>
            <Badge className={statusColor[op.status]}>{STATUS_LABELS[op.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1.5">
            {category?.name}{product ? ` · ${product.name}` : ""} · {stage?.name} · {formatTHB(op.pipeline_value)} · Close {formatMonth(op.expected_close_month)}
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4 mr-1.5" /> Edit</Button>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setAction({ type: "stage" })}><GitBranch className="w-4 h-4 mr-1.5" /> Move Stage</Button>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setAction({ type: "handoff" })}><ArrowRightLeft className="w-4 h-4 mr-1.5" /> Handoff</Button>
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setAction({ type: "reassign" })}><Users className="w-4 h-4 mr-1.5" /> Reassign</Button>
            {op.status === "open" && <Button variant="outline" size="sm" className="rounded-lg text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => setAction({ type: "won" })}><Trophy className="w-4 h-4 mr-1.5" /> Won</Button>}
            {op.status === "open" && <Button variant="outline" size="sm" className="rounded-lg text-rose-600 border-rose-200 hover:bg-rose-50" onClick={() => setAction({ type: "lost" })}><XCircle className="w-4 h-4 mr-1.5" /> Lost</Button>}
            {op.status !== "archived" && <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setAction({ type: "archive" })}><Archive className="w-4 h-4 mr-1.5" /> Archive</Button>}
            {op.status !== "open" && <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setAction({ type: "reopen" })}><RefreshCw className="w-4 h-4 mr-1.5" /> Reopen</Button>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Section title="Overview">
            <Field label="Customer Name" value={op.customer_name} />
            <Field label="Business ID" value={op.business_id} />
            <Field label="Customer Type" value={op.customer_type} />
            <Field label="Scenario" value={scenario?.name} />
          </Section>

          <Section title="Ownership & Assignment">
            <Field label="Opportunity Owner" value={owner?.name} />
            {originalOwner && originalOwner.id !== op.owner_id && <Field label="Original Owner" value={originalOwner?.name} />}
            <Field label="Current Handler" value={handler?.name} />
            <Field label="Region" value={region?.name} />
            <Field label="Territory" value={territory?.name} />
            <Field label="Handler Since" value={`${formatDate(op.handler_since)} (${handlerAging} days)`} />
          </Section>

          <Section title="Product">
            <Field label="Product Category" value={category?.name} />
            <Field label="Product" value={product?.name} />
          </Section>

          <Section title="Commercial">
            <Field label="Pipeline Value" value={formatTHB(op.pipeline_value)} />
            <Field label="Quantity" value={op.quantity} />
            <Field label="RC (recurring)" value={op.rc != null ? formatTHB(op.rc) : ""} />
            <Field label="OC (one-time)" value={op.oc != null ? formatTHB(op.oc) : ""} />
            <Field label="Discount (%)" value={op.discount} />
            <Field label="Contract Period (months)" value={op.contract_period} />
            <p className="text-xs text-muted-foreground col-span-2 mt-1">Commercial formulas (Net RC, Contract Value) are not calculated until business definitions are confirmed.</p>
          </Section>

          <Section title="Pipeline">
            <Field label="Stage" value={stage?.name} />
            <Field label="Stage Entered" value={`${formatDate(op.stage_entered_at)} (${stageAging} days)`} />
            <Field label="Expected Close Month" value={formatMonth(op.expected_close_month)} />
            <Field label="Created" value={`${formatDate(op.created_date)} (${op.created_month || "—"})`} />
            <Field label="Created By" value={maps.member[op.created_by_id]?.name || "—"} />
          </Section>

          <Section title="Support / Internal Coordination">
            <Field label="Working With" value={op.working_with ? `${op.working_with} (${wwAging} days)` : "—"} />
            <Field label="Support Needed" value={op.support_needed ? "Yes" : "No"} />
            {op.support_needed && <Field label="Support Type" value={op.support_type} />}
            {op.support_needed && <Field label="Support Note" value={op.support_note} />}
          </Section>

          {op.status !== "open" && (
            <Section title="Closure">
              {op.status === "won" && <Field label="Won At" value={formatDate(op.won_at)} />}
              {op.status === "won" && <Field label="Won By" value={maps.member[op.won_by]?.name} />}
              {op.status === "lost" && <Field label="Lost At" value={formatDate(op.lost_at)} />}
              {op.status === "lost" && <Field label="Lost By" value={maps.member[op.lost_by]?.name} />}
              {op.status === "lost" && <Field label="Lost Reason" value={lostReason?.name} />}
              {op.status === "lost" && <Field label="Lost Note" value={op.lost_note} />}
              {op.status === "archived" && <Field label="Archived At" value={formatDate(op.archived_at)} />}
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <Section title="Quick Actions" stacked>
            <div className="grid grid-cols-1 gap-2">
              <Button variant="outline" size="sm" className="rounded-lg justify-start" onClick={() => setAction({ type: "closemonth" })}><CalendarClock className="w-4 h-4 mr-2" /> Change Close Month</Button>
              <Button variant="outline" size="sm" className="rounded-lg justify-start" onClick={() => setAction({ type: "workingwith" })}><Wrench className="w-4 h-4 mr-2" /> Set Working With</Button>
              <Button variant="outline" size="sm" className="rounded-lg justify-start" onClick={() => setAction({ type: "support", needed: !op.support_needed })}>
                <Wrench className="w-4 h-4 mr-2" /> {op.support_needed ? "Disable Support" : "Enable Support"}
              </Button>
            </div>
          </Section>

          <Section title="History" stacked>
            <HistoryTimeline opportunityId={op.id} />
          </Section>
        </div>
      </div>

      <OpportunityForm open={editOpen} onClose={() => setEditOpen(false)} opportunity={op} />

      {/* Action dialog */}
      <Dialog open={!!action} onOpenChange={(o) => !o && closeAction()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionTitle(action?.type)}</DialogTitle>
          </DialogHeader>
          <ActionBody action={action} setAction={setAction} remark={remark} setRemark={setRemark}
            members={members} stages={activeStages} lostReasons={(master?.LostReason || []).filter((r) => r.active)} supportTypes={(master?.SupportType || []).filter((s) => s.active)} op={op} />
          <DialogFooter>
            <Button variant="outline" onClick={closeAction}>Cancel</Button>
            <Button onClick={runAction} disabled={!actionValid(action)}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function actionTitle(t) {
  return ({
    stage: "Move Stage", handoff: "Handoff", reassign: "Reassign", closemonth: "Change Close Month",
    won: "Mark Won", lost: "Mark Lost", archive: "Archive", reopen: "Reopen",
    workingwith: "Set Working With", support: "Toggle Support Needed",
  })[t] || "Action";
}

function actionValid(a) {
  if (!a) return false;
  if (a.type === "stage") return !!a.stageId;
  if (a.type === "handoff") return !!a.handlerId;
  if (a.type === "reassign") return !!a.ownerId || !!a.handlerId;
  if (a.type === "closemonth") return !!a.month;
  if (a.type === "lost") return !!a.reasonId;
  return true;
}

function ActionBody({ action, setAction, remark, setRemark, members, stages, lostReasons, supportTypes, op }) {
  if (!action) return null;
  const t = action.type;
  const memberOpts = members.map((m) => ({ id: m.id, label: `${m.name} (${m.app_role.toUpperCase()})` }));
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
        <Label>Opportunity Owner</Label>
        <Select value={action.ownerId || ""} onValueChange={(v) => setAction({ ...action, ownerId: v })}>
          <SelectTrigger><SelectValue placeholder="Keep current" /></SelectTrigger>
          <SelectContent>{memberOpts.map((m) => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
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
  if (t === "lost")
    return (
      <div className="space-y-2">
        <Label>Lost Reason *</Label>
        <Select value={action.reasonId || ""} onValueChange={(v) => setAction({ ...action, reasonId: v })}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>{lostReasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
        </Select>
        <Label>Lost Note</Label>
        <Textarea value={action.note || ""} onChange={(e) => setAction({ ...action, note: e.target.value })} rows={2} />
      </div>
    );
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
  if (t === "won" || t === "archive" || t === "reopen")
    return <DialogDescription>Confirm this action. A history entry will be recorded automatically.</DialogDescription>;
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

function Section({ title, children, stacked }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <h3 className="text-[13px] font-semibold mb-4 text-foreground/80">{title}</h3>
      {stacked ? children : <div className="grid grid-cols-2 gap-x-5 gap-y-4">{children}</div>}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-[13px] mt-1 text-foreground/90">{value || value === 0 ? value : "—"}</div>
    </div>
  );
}