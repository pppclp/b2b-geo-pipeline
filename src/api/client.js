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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Apps Script answers { status, body }. Google sometimes redirects a call before
// running it and the request arrives as a bare GET (health-check reply, or an
// HTML error page): nothing ran, so it is safe to retry.
async function appsScript(method, payload) {
  for (let attempt = 1; ; attempt++) {
    const res =
      method === "GET"
        ? await fetch(`${API_BASE}?req=${encodeURIComponent(JSON.stringify(payload))}`)
        : await fetch(API_BASE, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => null);
    const health = data?.health || data?.body?.service === "B2B GEO Pipeline API";
    if (data && typeof data.status === "number" && "body" in data && !health) return data;
    if (attempt >= 4 || (data === null && method !== "GET")) {
      throw Object.assign(new Error("The backend did not answer properly — please try again"), { status: 503 });
    }
    await sleep(400 * attempt);
  }
}

async function request(method, path, { query, body } = {}) {
  const q = Object.fromEntries(
    Object.entries(query || {})
      .filter(([, v]) => v != null)
      .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])
  );
  let status, data;
  if (IS_APPS_SCRIPT) {
    ({ status, body: data } = await appsScript(method, {
      method,
      path: path.replace(/^\//, ""),
      query: q,
      body,
      userId: session.userId(),
      demoAs: storage.get(DEMO_KEY),
    }));
  } else {
    const url = new URL(`${API_BASE}${path}`, window.location.origin);
    Object.entries(q).forEach(([k, v]) => url.searchParams.set(k, v));
    const headers = { "Content-Type": "application/json" };
    if (session.userId()) headers["X-User-Id"] = session.userId();
    if (storage.get(DEMO_KEY)) headers["X-Demo-As"] = storage.get(DEMO_KEY);
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    status = res.status;
    data = await res.json().catch(() => ({}));
  }
  if (status >= 400) {
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
  // Several reads in one round trip: [{ path, query }] -> [{ status, body }]
  batch: (requests) => request(IS_APPS_SCRIPT ? "GET" : "POST", "/batch", { body: { requests } }),
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
