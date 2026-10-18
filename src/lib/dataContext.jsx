import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { db } from "@/api/client";
import { useAuth } from "@/lib/AuthContext";
import { currentMonthKey } from "@/lib/pipeline";
import { buildQuickActionChanges } from "@/lib/quickActionChanges";

const DataContext = createContext(null);

const VALID_APP_ROLES = new Set(["ae", "sm", "management", "admin"]);

function normalizeAppRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return VALID_APP_ROLES.has(role) ? role : "";
}

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

  // Resolve the authenticated user's real profile from User Master.
  // user_id is the primary identity key for every role; email is only a legacy fallback.
  // If the master row is temporarily unavailable, preserve the backend session role
  // instead of escalating the user to Admin.
  const realProfile = useMemo(() => {
    if (!master) return null;
    const members = master.TeamMember || [];

    const matchById = user?.id
      ? members.find((m) => String(m.id) === String(user.id))
      : null;
    const matchByEmail = !matchById && user?.email
      ? members.find((m) => (m.email || "").toLowerCase() === user.email.toLowerCase())
      : null;
    const match = matchById || matchByEmail;

    if (match) {
      return {
        ...match,
        app_role: normalizeAppRole(match.app_role) || normalizeAppRole(user?.role) || "ae",
        isProvisional: false,
      };
    }

    return {
      id: user?.id || "provisional",
      name: user?.full_name || user?.email || "User",
      email: user?.email || "",
      app_role: normalizeAppRole(user?.role) || "ae",
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
      aging_threshold_days: Number(cfg.aging_threshold_days || 14), // legacy only
      internal_task_sla_days: cfg.internal_task_sla_days === "" || cfg.internal_task_sla_days == null
        ? null : Number(cfg.internal_task_sla_days),
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

  // Audit history is generated by the backend in the same write request as the
  // Pipeline mutation. Client-provided actor/event fields are never authoritative.
  const acceptPipelineResult = useCallback((result) => {
    const { _audit_events: events = [], ...opportunity } = result;
    if (events.length) setHistory((current) => [...events, ...current]);
    return opportunity;
  }, []);

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
      const rec = acceptPipelineResult(await db.entities.Opportunity.create(payload));
      setOpportunities((ops) => [rec, ...ops]);
      return rec;
    },
    [activeStages, acceptPipelineResult]
  );

  // One write request updates Pipeline and appends authoritative server-side audit.
  const updateWithHistory = useCallback(
    async (id, changes, histEntry) => {
      const payload = histEntry?.remark ? { ...changes, audit_remark: histEntry.remark } : changes;
      const rec = acceptPipelineResult(await db.entities.Opportunity.update(id, payload));
      setOpportunities((ops) => ops.map((o) => (o.id === id ? rec : o)));
      return rec;
    },
    [acceptPipelineResult]
  );

  // One persisted update for the three frequent Pipeline actions, with
  // independent timestamps and audit events for each changed field.
  const updateQuickActions = useCallback(async (id, { stageId, handlerId, workingWith }) => {
    const op = opportunities.find((item) => item.id === id);
    const { changes } = buildQuickActionChanges(
      op, { stageId, handlerId, workingWith },
      { stages: activeStages, maps, now: new Date().toISOString() }
    );
    if (!Object.keys(changes).length) return op;
    // One record update; Stage and Handler aging remain independent.
    return updateWithHistory(id, changes, null);
  }, [opportunities, activeStages, maps, updateWithHistory]);

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
      if (!op || op.status !== "open") throw new Error("Only an open Pipeline can be marked Won");
      const now = new Date().toISOString();
      await updateWithHistory(id, { status: "won", won_at: now, won_by: profile?.id || "" }, {
        event_type: "won",
        field: "status",
        previous_value: op.status,
        new_value: "won",
      });
    },
    [opportunities, updateWithHistory, profile?.id]
  );

  const markLost = useCallback(
    async (id, { reason_id, note }) => {
      const op = opportunities.find((o) => o.id === id);
      if (!op || op.status !== "open") throw new Error("Only an open Pipeline can be marked Lost");
      if (!(master?.LostReason || []).some((reason) => reason.active && reason.id === reason_id)) {
        throw new Error("Select an active Lost Reason");
      }
      const now = new Date().toISOString();
      await updateWithHistory(id, { status: "lost", lost_at: now, lost_by: profile?.id || "", lost_reason_id: reason_id, lost_note: note || "" }, {
        event_type: "lost",
        field: "status",
        previous_value: op.status,
        new_value: "lost",
        remark: maps.lostReason[reason_id]?.name || "",
      });
    },
    [opportunities, updateWithHistory, maps.lostReason, master?.LostReason, profile?.id]
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

  // Backend derives snapshot rows from authoritative Pipeline state. No client
  // deletes, no client-side bulk insert, no partial month replacement.
  const captureSnapshot = useCallback(
    async (snapshotPeriod) => {
      const result = await db.snapshots.capture(snapshotPeriod);
      try {
        const snapshots = await db.entities.MonthlySnapshot.list();
        setMaster((m) => ({ ...m, MonthlySnapshot: snapshots }));
      } catch (error) {
        // A post-commit display refresh failure must not misreport a
        // successful snapshot as failed, inviting unnecessary recapture.
        console.warn("Snapshot committed; list refresh failed", error);
        return { ...result, warning: "Saved successfully, but refresh the page to see the updated list." };
      }
      return result;
    },
    []
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
    updateQuickActions,
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