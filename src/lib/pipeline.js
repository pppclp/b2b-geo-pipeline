// Formatting and calculation helpers for B2B GEO Pipeline

export const SUPPORT_TYPES = [
  "Pricing",
  "Product",
  "Internal Coordination",
  "Customer Issue",
  "Other",
];

export const CUSTOMER_TYPES = ["Government", "Enterprise", "SME", "Education", "Telco", "Other"];

export const STATUS_LABELS = {
  open: "Open",
  won: "Won",
  lost: "Lost",
  archived: "Archived",
};

export const ROLE_LABELS = {
  ae: "AE",
  sm: "SM",
  management: "Management",
  admin: "Admin",
};

// Currency: Thai Baht, compact (e.g. ฿1.2M)
export function formatTHB(n) {
  if (n == null || isNaN(n)) return "฿0";
  return `฿${Number(n).toLocaleString("en-US")}`;
}

export function formatTHBFull(n) {
  if (n == null || isNaN(n)) return "฿0";
  return `฿${Number(n).toLocaleString()}`;
}

// Compact currency for charts (e.g. ฿11.45M, ฿320K)
export function formatTHBCompact(n) {
  if (n == null || isNaN(n)) return "฿0";
  const num = Number(n);
  if (Math.abs(num) >= 1e6) return `฿${(num / 1e6).toFixed(2)}M`;
  if (Math.abs(num) >= 1e3) return `฿${(num / 1e3).toFixed(1)}K`;
  return `฿${num.toLocaleString()}`;
}

// Month stored as "YYYY-MM". Display as "Oct 2026".
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonth(ym) {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function currentMonthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function monthKeyFromDate(date = new Date()) {
  return currentMonthKey(date);
}

export function parseMonthKey(ym) {
  if (!ym) return null;
  const [y, m] = ym.split("-").map(Number);
  return { y, m };
}

// Aging in days from an ISO timestamp to now (or given date). Returns integer >= 0.
export function agingDays(iso, now = new Date()) {
  if (!iso) return 0;
  const then = new Date(iso);
  if (isNaN(then.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86400000));
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysAgoLabel(days) {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

// Weighted value for an opportunity given a stage weight map (stageId -> 0..1)
export function weightedValue(op, stageWeightMap) {
  if (op.status === "won") return op.pipeline_value || 0;
  if (op.status === "lost" || op.status === "archived") return 0;
  const w = stageWeightMap?.[op.stage_id] ?? 0;
  return (op.pipeline_value || 0) * w;
}

export function sum(arr, fn) {
  return arr.reduce((a, b) => a + (Number(fn(b)) || 0), 0);
}