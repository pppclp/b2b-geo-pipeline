import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { db } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { currentMonthKey } from "@/lib/pipeline";

const DataContext = createContext(null);

const MASTER_ENTITIES = [
  "Region",
  "Territory",
  "Stage",
  "ProductCategory",
  "Product",
  "Scenario",
  "LostReason",
  "WorkingWithOption",
  "SupportType",
  "TeamMember",
  "AppConfig",
  "MonthlySnapshot",
];

// One round trip for everything the app needs; an entity the user may not read comes back empty.
async function fetchAllEntities(entities) {
  const results = await db.batch(entities.map((e) => ({ path: `entities/${e}`, query: { sort: "-created_date" } })));
  return results.map((r, i) => {
    if (r.status !== 200) console.warn(`Failed to load ${entities[i]}: ${r.body?.message}`);
    return r.status === 200 && Array.isArray(r.body) ? r.body : [];
  });
}

export function DataProvider({ children }) {
  const { user, isAuthenticated } = useAuth();
  const [master, setMaster] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [demoMemberId, setDemoMemberId] = useState(() => {
    try { return localStorage.getItem("geo_demo_as") || ""; } catch { return ""; }
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await fetchAllEntities([...MASTER_ENTITIES, "Opportunity", "OpportunityHistory"]);
      const masterObj = {};
      MASTER_ENTITIES.forEach((e, i) => (masterObj[e] = results[i]));
      setMaster(masterObj);
      setOpportunities(results[MASTER_ENTITIES.length] || []);
      setHistory(results[MASTER_ENTITIES.length + 1] || []);
    } catch (e) {
      console.error(e);
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) loadAll();
  }, [isAuthenticated, loadAll]);

  // Resolve current user's real team member profile (never affected by Demo As)
  const realProfile = useMemo(() => {
    if (!master) return null;
    const members = master.TeamMember || [];
    const match = user?.email ? members.find((m) => (m.email || "").toLowerCase() === user.email.toLowerCase()) : null;
    if (match) return { ...match, isProvisional: false };
    // Provisional admin so the first logged-in user can configure the app
    return {
      id: user?.id || "provisional",
      name: user?.full_name || user?.email || "Administrator",
      email: user?.email || "",
      app_role: "admin",
      region_ids: [],
      territory_ids: [],
      active: true,
      isProvisional: true,
    };
  }, [master, user]);

  // Demo As — admin can simulate another role/user. Does not change the real account.
  const isDemoing = !!demoMemberId && realProfile?.app_role === "admin";
  const demoMember = useMemo(() => {
    if (!isDemoing || !master) return null;
    return (master.TeamMember || []).find((m) => m.id === demoMemberId) || null;
  }, [isDemoing, master, demoMemberId]);
  const profile = useMemo(() => {
    if (isDemoing && demoMember) return { ...demoMember, isDemo: true, isProvisional: false };
    return realProfile ? { ...realProfile, isDemo: false } : realProfile;
  }, [isDemoing, demoMember, realProfile]);

  const demoAs = useCallback((memberId) => {
    setDemoMemberId(memberId);
    try { localStorage.setItem("geo_demo_as", memberId); } catch (e) {}
    loadAll(); // backend scopes data to the demo user
  }, [loadAll]);
  const exitDemo = useCallback(() => {
    setDemoMemberId("");
    try { localStorage.removeItem("geo_demo_as"); } catch (e) {}
    loadAll();
  }, [loadAll]);

  // Lookup maps
  const maps = useMemo(() => {
    if (!master) return {};
    const byId = (arr) => Object.fromEntries((arr || []).map((x) => [x.id, x]));
    return {
      region: byId(master.Region),
      territory: byId(master.Territory),
      stage: byId(master.Stage),
      category: byId(master.ProductCategory),
      product: byId(master.Product),
      scenario: byId(master.Scenario),
      lostReason: byId(master.LostReason),
      workingWith: byId(master.WorkingWithOption),
      supportType: byId(master.SupportType),
      member: byId(master.TeamMember),
    };
  }, [master]);

  const config = useMemo(() => {
    const cfg = {};
    (master?.AppConfig || []).forEach((c) => (cfg[c.key] = c.value));
    return {
      aging_threshold_days: Number(cfg.aging_threshold_days || 14),
      pipeline_value_metric: cfg.pipeline_value_metric || "pipeline_value",
      weighted_enabled: cfg.weighted_enabled === "true",
    };
  }, [master]);

  const activeStages = useMemo(
    () => (master?.Stage || []).filter((s) => s.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [master]
  );
  const stageWeightMap = useMemo(() => {
    const m = {};
    (master?.Stage || []).forEach((s) => (m[s.id] = (Number(s.weight) || 0) / 100));
    return m;
  }, [master]);

  // Permission scope predicate
  const scopeFilter = useCallback(
    (op) => {
      if (!profile) return false;
      if (profile.app_role === "admin") return true;
      if (profile.app_role === "management") {
        if (!profile.region_ids?.length) return true;
        return profile.region_ids.includes(op.region_id);
      }
      if (profile.app_role === "sm") {
        return (profile.region_ids || []).includes(op.region_id);
      }
      // ae
      return op.owner_id === profile.id || op.current_handler_id === profile.id;
    },
    [profile]
  );

  const scopedOpportunities = useMemo(() => opportunities.filter(scopeFilter), [opportunities, scopeFilter]);

  // ---- History helper ----
  const addHistory = useCallback(
    async (opportunity_id, entry) => {
      const rec = {
        opportunity_id,
        actor_name: entry.actor_name || profile?.name || "System",
        actor_id: entry.actor_id || profile?.id || "",
        event_type: entry.event_type,
        field: entry.field || "",
        previous_value: entry.previous_value || "",
        new_value: entry.new_value || "",
        remark: entry.remark || "",
      };
      try {
        await db.entities.OpportunityHistory.create(rec);
        setHistory((h) => [rec, ...h]);
      } catch (e) {
        console.warn("history write failed", e);
      }
    },
    [profile]
  );

  // ---- Master data CRUD ----
  const createMaster = useCallback(async (entity, data) => {
    const rec = await db.entities[entity].create(data);
    setMaster((m) => ({ ...m, [entity]: [...(m[entity] || []), rec] }));
    return rec;
  }, []);

  const updateMaster = useCallback(async (entity, id, data) => {
    const rec = await db.entities[entity].update(id, data);
    setMaster((m) => ({
      ...m,
      [entity]: (m[entity] || []).map((x) => (x.id === id ? { ...x, ...rec } : x)),
    }));
    return rec;
  }, []);

  const deleteMaster = useCallback(async (entity, id) => {
    await db.entities[entity].delete(id);
    setMaster((m) => ({ ...m, [entity]: (m[entity] || []).filter((x) => x.id !== id) }));
  }, []);

  // ---- Opportunity CRUD with history ----
  const refreshOp = useCallback(async (id) => {
    const rec = await db.entities.Opportunity.get(id);
    setOpportunities((ops) => ops.map((o) => (o.id === id ? rec : o)));
    return rec;
  }, []);

  const createOpportunity = useCallback(
    async (data) => {
      const now = new Date().toISOString();
      const firstStage = activeStages[0];
      const payload = {
        ...data,
        status: data.status || "open",
        current_handler_id: data.current_handler_id || data.owner_id,
        original_owner_id: data.original_owner_id || data.owner_id,
        handler_since: now,
        stage_entered_at: now,
        created_month: currentMonthKey(),
      };
      if (!payload.stage_id && firstStage) payload.stage_id = firstStage.id;
      const rec = await db.entities.Opportunity.create(payload);
      setOpportunities((ops) => [rec, ...ops]);
      await addHistory(rec.id, {
        event_type: "create",
        new_value: `Opportunity created at stage ${maps.stage[firstStage?.id]?.name || ""}`,
      });
      return rec;
    },
    [activeStages, addHistory, maps.stage]
  );

  // Generic update that also logs history for a named field
  const updateWithHistory = useCallback(
    async (id, changes, histEntry) => {
      const rec = await db.entities.Opportunity.update(id, changes);
      setOpportunities((ops) => ops.map((o) => (o.id === id ? rec : o)));
      if (histEntry) await addHistory(id, histEntry);
      return rec;
    },
    [addHistory]
  );

  const moveStage = useCallback(
    async (id, newStageId, remark) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op || op.stage_id === newStageId) return;
      const now = new Date().toISOString();
      await updateWithHistory(id, { stage_id: newStageId, stage_entered_at: now }, {
        event_type: "stage_change",
        field: "stage",
        previous_value: maps.stage[op.stage_id]?.name || op.stage_id,
        new_value: maps.stage[newStageId]?.name || newStageId,
        remark,
      });
    },
    [opportunities, updateWithHistory, maps.stage]
  );

  const handoff = useCallback(
    async (id, newHandlerId, remark) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op || op.current_handler_id === newHandlerId) return;
      const now = new Date().toISOString();
      await updateWithHistory(id, { current_handler_id: newHandlerId, handler_since: now, last_remark: remark || "" }, {
        event_type: "handler_change",
        field: "current_handler",
        previous_value: maps.member[op.current_handler_id]?.name || op.current_handler_id,
        new_value: maps.member[newHandlerId]?.name || newHandlerId,
        remark,
      });
    },
    [opportunities, updateWithHistory, maps.member]
  );

  const reassign = useCallback(
    async (id, { owner_id, current_handler_id, remark }) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op) return;
      const changes = {};
      const now = new Date().toISOString();
      if (owner_id && owner_id !== op.owner_id) changes.owner_id = owner_id;
      if (current_handler_id && current_handler_id !== op.current_handler_id) {
        changes.current_handler_id = current_handler_id;
        changes.handler_since = now;
      }
      if (!Object.keys(changes).length) return;
      await updateWithHistory(id, changes, {
        event_type: "reassign",
        field: owner_id ? "owner" : "handler",
        previous_value: owner_id ? maps.member[op.owner_id]?.name : maps.member[op.current_handler_id]?.name,
        new_value: owner_id ? maps.member[owner_id]?.name : maps.member[current_handler_id]?.name,
        remark,
      });
    },
    [opportunities, updateWithHistory, maps.member]
  );

  const changeCloseMonth = useCallback(
    async (id, newMonth, remark) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op || op.expected_close_month === newMonth) return;
      await updateWithHistory(id, { expected_close_month: newMonth }, {
        event_type: "close_month_change",
        field: "expected_close_month",
        previous_value: op.expected_close_month || "",
        new_value: newMonth,
        remark,
      });
    },
    [opportunities, updateWithHistory]
  );

  const setWorkingWith = useCallback(
    async (id, value) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op) return;
      const now = new Date().toISOString();
      const changes = { working_with: value || "", working_with_since: value ? now : "" };
      await updateWithHistory(id, changes, {
        event_type: "working_with_change",
        field: "working_with",
        previous_value: op.working_with || "",
        new_value: value || "",
      });
    },
    [opportunities, updateWithHistory]
  );

  const setSupport = useCallback(
    async (id, { needed, type, note }) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op) return;
      const changes = {
        support_needed: !!needed,
        support_type: needed ? type || "" : "",
        support_note: needed ? note || "" : "",
      };
      await updateWithHistory(id, changes, {
        event_type: needed ? "support_on" : "support_off",
        field: "support_needed",
        previous_value: op.support_needed ? "On" : "Off",
        new_value: needed ? "On" : "Off",
      });
    },
    [opportunities, updateWithHistory]
  );

  const markWon = useCallback(
    async (id) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op) return;
      const now = new Date().toISOString();
      await updateWithHistory(id, { status: "won", won_at: now, won_by: op.owner_id }, {
        event_type: "won",
        field: "status",
        previous_value: op.status,
        new_value: "won",
      });
    },
    [opportunities, updateWithHistory]
  );

  const markLost = useCallback(
    async (id, { reason_id, note }) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op) return;
      const now = new Date().toISOString();
      await updateWithHistory(id, { status: "lost", lost_at: now, lost_by: op.owner_id, lost_reason_id: reason_id, lost_note: note || "" }, {
        event_type: "lost",
        field: "status",
        previous_value: op.status,
        new_value: "lost",
        remark: maps.lostReason[reason_id]?.name || "",
      });
    },
    [opportunities, updateWithHistory, maps.lostReason]
  );

  const archiveOp = useCallback(
    async (id) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op) return;
      const now = new Date().toISOString();
      await updateWithHistory(id, { status: "archived", archived_at: now }, {
        event_type: "archived",
        field: "status",
        previous_value: op.status,
        new_value: "archived",
      });
    },
    [opportunities, updateWithHistory]
  );

  const reopen = useCallback(
    async (id) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op) return;
      await updateWithHistory(id, { status: "open" }, {
        event_type: "status_change",
        field: "status",
        previous_value: op.status,
        new_value: "open",
      });
    },
    [opportunities, updateWithHistory]
  );

  const historyFor = useCallback((opId) => history.filter((h) => h.opportunity_id === opId), [history]);

  // Capture a month-end snapshot of all open opportunities (admin action)
  const captureSnapshot = useCallback(
    async (snapshotMonth) => {
      const rows = scopedOpportunities
        .filter((o) => o.status === "open" || o.status === "won" || o.status === "lost")
        .map((o) => ({
          snapshot_month: snapshotMonth,
          opportunity_id: o.id,
          customer_name: o.customer_name || "",
          owner_id: o.owner_id || "",
          current_handler_id: o.current_handler_id || "",
          region_id: o.region_id || "",
          product_id: o.product_id || "",
          stage_id: o.stage_id || "",
          status: o.status,
          expected_close_month: o.expected_close_month || "",
          pipeline_value: o.pipeline_value || 0,
          support_needed: !!o.support_needed,
        }));
      if (!rows.length) return { captured: 0 };
      // Remove any existing snapshot rows for this month to allow re-capture
      try {
        const existing = await db.entities.MonthlySnapshot.filter({ snapshot_month: snapshotMonth }, "-created_date", 500);
        const ex = Array.isArray(existing) ? existing : existing?.items || [];
        if (ex.length) await db.entities.MonthlySnapshot.deleteMany({ snapshot_month: snapshotMonth });
      } catch (e) { console.warn("snapshot cleanup failed", e); }
      const createdRows = await db.entities.MonthlySnapshot.bulkCreate(rows);
      setMaster((m) => ({ ...m, MonthlySnapshot: [...(m.MonthlySnapshot || []), ...createdRows] }));
      return { captured: createdRows.length };
    },
    [scopedOpportunities]
  );

  const value = {
    loading,
    error,
    master,
    maps,
    config,
    activeStages,
    stageWeightMap,
    profile,
    realProfile,
    isDemoing,
    demoAs,
    exitDemo,
    opportunities,
    scopedOpportunities,
    scopeFilter,
    history,
    historyFor,
    refresh: loadAll,
    createMaster,
    updateMaster,
    deleteMaster,
    createOpportunity,
    updateWithHistory,
    moveStage,
    handoff,
    reassign,
    changeCloseMonth,
    setWorkingWith,
    setSupport,
    markWon,
    markLost,
    archiveOp,
    reopen,
    refreshOp,
    captureSnapshot,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}