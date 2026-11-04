import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "@/api/client";
import { useData } from "@/lib/dataContext";
import { actionableErrorMessage } from "@/lib/actionFeedback";
import { formatDateTime } from "@/lib/pipeline";
import { formatNetRc } from "@/lib/netRc";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, RotateCcw } from "lucide-react";

export default function PipelineTrash() {
  const navigate = useNavigate();
  const { maps, refresh } = useData();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setItems(await db.pipelineTrash.list()); }
    catch (err) { setError(actionableErrorMessage(err)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const close = () => {
    if (saving) return;
    setSelected(null); setReason(""); setActionError("");
  };
  const restore = async () => {
    if (!selected || saving || reason.trim().length < 3 || reason.trim().length > 500) return;
    setSaving(true); setActionError("");
    try {
      if (typeof selected.updated_date !== "string")
        throw new Error("Refresh Recycle Bin before restoring this Pipeline.");
      await db.pipelineTrash.restore(selected.id, reason.trim(), selected.updated_date);
      setItems(current => current.filter(op => op.id !== selected.id));
      closeAfterRestore();
      // Restore to the server-authorized list, Dashboard and reporting view.
      refresh().catch((err) => setError(actionableErrorMessage(err)));
    } catch (err) { setActionError(actionableErrorMessage(err)); }
    finally { setSaving(false); }
  };
  const closeAfterRestore = () => { setSelected(null); setReason(""); setActionError(""); };

  return (
    <div className="geo-page pipeline-typography">
      <PageHeader title="ถังขยะ Pipeline" description="รายการที่ลบไว้จะไม่อยู่ในยอด Pipeline, Net RC และรายงานปัจจุบัน"
        actions={<Button variant="outline" size="sm" onClick={() => navigate("/pipeline")}><ArrowLeft className="mr-1.5 h-4 w-4" />กลับไป Pipeline</Button>} />
      <p className="mb-4 text-xs text-muted-foreground">ข้อมูลต้นฉบับและ Pipeline_Events ยังอยู่ครบ การลบและกู้คืนบันทึกผู้ทำรายการ เวลา และเหตุผลทุกครั้ง</p>
      {error && <div role="alert" className="mb-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
        {error} <Button variant="outline" size="sm" className="ml-2" onClick={load}>ลองอีกครั้ง</Button>
      </div>}
      {loading ? <p role="status" className="text-sm text-muted-foreground">กำลังโหลดรายการถังขยะ…</p>
        : !error && items.length === 0 ? <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">ไม่มี Pipeline ในถังขยะ</div>
        : !error && <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-3">Pipeline / ID</th><th className="px-4 py-3">สถานะเดิม</th>
                <th className="px-4 py-3">Net RC</th><th className="px-4 py-3">ผู้ลบ / เวลา</th>
                <th className="px-4 py-3">เหตุผล</th><th className="px-4 py-3 text-right">จัดการ</th></tr>
            </thead>
            <tbody className="divide-y">
              {items.map(op => <tr key={op.id} className="align-top">
                <td className="px-4 py-3"><p className="font-medium">{op.customer_name || "—"}</p><p className="text-xs text-muted-foreground">{op.id}</p></td>
                <td className="px-4 py-3">{String(op.status || "—").toUpperCase()}</td>
                <td className="px-4 py-3 tabular-nums">{formatNetRc(op.pipeline_value)}</td>
                <td className="px-4 py-3">
                  <p>{maps.member?.[op.deleted_by_user_id]?.name || op.deleted_by_user_id || "—"}</p>
                  <p className="text-xs text-muted-foreground">{op.deleted_at ? formatDateTime(op.deleted_at) : "—"}</p>
                </td>
                <td className="max-w-[240px] break-words px-4 py-3">{op.delete_reason || "—"}</td>
                <td className="px-4 py-3 text-right"><Button variant="outline" size="sm" onClick={() => { setSelected(op); setReason(""); setActionError(""); }}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />กู้คืน
                </Button></td>
              </tr>)}
            </tbody>
          </table>
        </div>}
      <Dialog open={!!selected} onOpenChange={next => { if (!next) close(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><RotateCcw className="h-4 w-4" />กู้คืน Pipeline</DialogTitle>
            <DialogDescription>นำ {selected?.customer_name || selected?.id} กลับสู่สถานะเดิม พร้อมบันทึกเหตุผลและผู้กู้คืนใน Change Log</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="restore-pipeline-reason">เหตุผลในการกู้คืน <span className="text-destructive">*</span></Label>
            <Textarea id="restore-pipeline-reason" rows={3} maxLength={500} disabled={saving}
              placeholder="เช่น ลบผิดรายการ" value={reason} onChange={e => setReason(e.target.value)} />
            {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>ยกเลิก</Button>
            <Button onClick={restore} disabled={saving || reason.trim().length < 3 || reason.trim().length > 500}>
              {saving ? "กำลังกู้คืน…" : "ยืนยันการกู้คืน"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
