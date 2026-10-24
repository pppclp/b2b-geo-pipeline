import React, { useCallback, useEffect, useState } from "react";
import { Bell, Inbox, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { db } from "@/api/client";

// Handoff alerts are recipient-scoped by the authenticated backend session.
export default function HandoffBell({ userId }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread_count: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await db.notifications.list();
      setData({
        items: Array.isArray(result?.items) ? result.items : [],
        unread_count: Number(result?.unread_count) || 0,
      });
      setError("");
    } catch {
      setError("Unable to load notifications. Please retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setData({ items: [], unread_count: 0 });
      setError("");
      return;
    }
    refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [userId, refresh]);

  const openItem = async (item) => {
    if (busy) return;
    setBusy(true);
    try {
      await db.notifications.markRead(item.id);
      await refresh();
      setOpen(false);
      navigate("/opportunity/" + encodeURIComponent(item.opportunity_id));
    } catch {
      setError("Unable to open this Pipeline. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button type="button" aria-label={"Notifications, " + data.unread_count + " unread"}
        aria-expanded={open} onClick={() => { setOpen((v) => !v); if (!open) refresh(); }}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border hover:bg-secondary/70">
        <Bell className="w-[18px] h-[18px]" />
        {data.unread_count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 rounded-full bg-red-600 px-1 text-[10px] font-bold text-white flex items-center justify-center">
            {data.unread_count > 99 ? "99+" : data.unread_count}
          </span>
        )}
      </button>
      {open && (
        <div role="region" aria-label="Notifications" className="absolute right-0 top-11 z-50 w-[min(350px,90vw)] rounded-xl border border-border bg-card shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <strong className="text-sm font-semibold">Notifications</strong>
            <button type="button" aria-label="Refresh notifications" title="Refresh notifications" disabled={loading}
              className="p-1 rounded hover:bg-secondary disabled:opacity-50" onClick={refresh}>
              <RefreshCw className={"h-4 w-4" + (loading ? " animate-spin" : "")} />
            </button>
          </div>
          {error && <p role="alert" className="text-xs text-red-600 mb-2">{error}</p>}
          <div className="max-h-80 overflow-auto space-y-1">
            {loading && data.items.length === 0 && !error && (
              <p role="status" className="text-xs text-muted-foreground py-4 text-center">Loading notifications…</p>
            )}
            {!loading && !error && data.items.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-5 text-center">
                <Inbox className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs font-medium">No notifications yet</span>
                <span className="text-[11px] text-muted-foreground">New assignments and SM input alerts will appear here.</span>
              </div>
            )}
            {data.items.map((item) => (
              <button type="button" key={item.id} disabled={busy}
                onClick={() => openItem(item)}
                className={"w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-secondary/70 " + (!item.read_at ? "bg-red-50/60" : "")}>
                <span className="block font-semibold">
                  {item.type === "sm_input_needed" ? "New Pipeline · SM Input Needed" :
                    item.type === "pipeline_assigned" ? "New Pipeline Assigned to You" :
                    "Pipeline Handed Off to You"}
                </span>
                <span className="block text-muted-foreground mt-1">
                  {item.customer_name || item.opportunity_id}
                  {item.customer_name && <span className="block text-[10px]">{item.opportunity_id}</span>}
                </span>
                {item.type === "sm_input_needed" && (
                  <span className="block text-[11px] mt-1">
                    {item.needs_sm_input ? "Complete Scenario / CCP+ Check" : "SM information completed"}
                  </span>
                )}
                <span className="block text-muted-foreground mt-1">
                  From: {item.actor_name || "Unknown"} · {item.created_at ? new Date(item.created_at).toLocaleString("en-US", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  }) : "—"}
                </span>
                {!item.read_at && <span className="text-red-600 text-[11px]">Unread</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
