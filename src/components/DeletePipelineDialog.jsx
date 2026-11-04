import React, { useEffect, useState } from "react";
import { useData } from "@/lib/dataContext";
import { actionableErrorMessage } from "@/lib/actionFeedback";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";

// Only server-authorized, logged deletes. Never call db.entities.Opportunity.delete().
export default function DeletePipelineDialog({ op, open, onClose, onDeleted }) {
  const { deletePipeline } = useData();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) { setReason(""); setError(""); }
  }, [open]);
  const close = () => { if (!saving) onClose(); };
  const confirm = async () => {
    if (saving || !op || reason.trim().length < 3 || reason.trim().length > 500) return;
    setSaving(true); setError("");
    try {
      await deletePipeline(op.id, reason.trim());
      onDeleted?.();
      onClose();
    } catch (err) {
      setError(actionableErrorMessage(err));
    } finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Trash2 className="h-4 w-4 text-destructive" />ลบ Pipeline</DialogTitle>
          <DialogDescription>
            นำ Pipeline ออกจากรายการปกติและยอดรายงาน โดยเก็บข้อมูลเดิมและ Change Log ไว้
            สามารถกู้คืนได้จากถังขยะ
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-lg border bg-secondary/30 px-3 py-2 text-sm font-medium">
            {op?.customer_name || op?.id} <span className="text-muted-foreground">· {op?.id}</span>
          </p>
          <div className="space-y-2">
            <Label htmlFor="pipeline-delete-reason">เหตุผลในการลบ Pipeline <span className="text-destructive">*</span></Label>
            <Textarea id="pipeline-delete-reason" value={reason} onChange={(event) => setReason(event.target.value)}
              placeholder="เช่น สร้าง Pipeline ซ้ำ หรือสร้างรายการผิด" rows={3} maxLength={500} disabled={saving} />
            <p className="text-xs text-muted-foreground">บันทึกชื่อผู้ลบ วันเวลา และเหตุผลลง Pipeline_Events โดยอัตโนมัติ</p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={saving}>ยกเลิก</Button>
          <Button type="button" variant="destructive" onClick={confirm}
            disabled={saving || reason.trim().length < 3 || reason.trim().length > 500}>
            {saving ? "กำลังลบ…" : "ยืนยันการลบ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
