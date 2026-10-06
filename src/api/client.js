// Client for the GEO backend (local Excel API now, Apps Script later).
// Exposes db.entities.<Entity>.list/get/filter/create/update/delete/bulkCreate/deleteMany,
// the same shape the pages used with the Base44 SDK.

const API_BASE = import.meta.env.VITE_GEO_API_URL || "/api";
const USER_KEY = "geo_user_id";
const DEMO_KEY = "geo_demo_as";

const storage = {
  get(k) {
    try { return localStorage.getItem(k) || ""; } catch { return ""; }
  },
  set(k, v) {
    try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage unavailable */ }
  },
};

export const session = {
  userId: () => storage.get(USER_KEY),
  setUserId: (id) => storage.set(USER_KEY, id),
  clear: () => { storage.set(USER_KEY, ""); storage.set(DEMO_KEY, ""); },
};

// VITE_GEO_API_URL ending in /exec = Apps Script web app; otherwise a REST base (default /api).
const IS_APPS_SCRIPT = /\/exec$/.test(API_BASE);

async function request(method, path, { query, body } = {}) {
  const q = Object.fromEntries(
    Object.entries(query || {})
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
  );
  let res;
  if (IS_APPS_SCRIPT) {
    // Apps Script reads neither custom headers nor HTTP methods: send everything in a
    // text/plain POST (no CORS preflight) and unwrap { status, body }.
    res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ method, path: path.replace(/^\//, ""), query: q, body, userId: session.userId(), demoAs: storage.get(DEMO_KEY) }),
    });
  } else {
    const url = new URL(`${API_BASE}${path}`, window.location.origin);
    Object.entries(q).forEach(([k, v]) => url.searchParams.set(k, v));
    const headers = { "Content-Type": "application/json" };
    if (session.userId()) headers["X-User-Id"] = session.userId();
    if (storage.get(DEMO_KEY)) headers["X-Demo-As"] = storage.get(DEMO_KEY);
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  let data = await res.json().catch(() => ({}));
  let status = res.status;
  if (IS_APPS_SCRIPT && res.ok) ({ status, body: data } = data);
  if (status >= 400 || !res.ok) {
    const err = new Error(data?.message || `${method} ${path} failed (${status})`);
    err.status = status;
    throw err;
  }
  return data;
}

function entity(name) {
  const base = `/entities/${name}`;
  return {
    list: (sort, limit) => request("GET", base, { query: { sort, limit } }),
    filter: (q, sort, limit) => request("GET", base, { query: { q, sort, limit } }),
    get: (id) => request("GET", `${base}/${encodeURIComponent(id)}`),
    create: (data) => request("POST", base, { body: data }),
    bulkCreate: (items) => request("POST", `${base}/bulk`, { body: items }),
    update: (id, data) => request("PUT", `${base}/${encodeURIComponent(id)}`, { body: data }),
    delete: (id) => request("DELETE", `${base}/${encodeURIComponent(id)}`),
    deleteMany: (q) => request("DELETE", base, { query: { q } }),
  };
}

export const db = {
  entities: new Proxy({}, { get: (_, name) => entity(String(name)) }),
  session: {
    users: () => request("GET", "/session/users"),
    me: () => request("GET", "/session/me"),
  },
  access: () => request("GET", "/access"),
  // Raw row editor over the source sheets bound in access_control.
  sheets: {
    list: () => request("GET", "/sheets"),
    read: (file, sheet) => request("GET", sheetPath(file, sheet)),
    create: (file, sheet, row) => request("POST", sheetPath(file, sheet), { body: row }),
    update: (file, sheet, id, changes) => request("PUT", sheetPath(file, sheet, id), { body: changes }),
    remove: (file, sheet, id) => request("DELETE", sheetPath(file, sheet, id)),
  },
};

function sheetPath(file, sheet, id) {
  return ["/sheets", file, sheet, id].filter((p) => p !== undefined).map((p, i) => (i ? encodeURIComponent(p) : p)).join("/");
}
