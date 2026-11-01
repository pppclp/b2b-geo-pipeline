// Canonical Sales Channels. Retain historical names only as import/API aliases.
export const SALES_CHANNELS = Object.freeze(["AE Self", "Premium Partner", "Dealer"]);

const ALIASES = Object.freeze({
  "ae self": "AE Self",
  "ae b2b geo": "AE Self",
  "b2b premium partner": "Premium Partner",
  "premium partner": "Premium Partner",
  "dealer": "Dealer",
  "rp": "Dealer",
  "ta dealer": "Dealer",
});

// Unknown or empty source labels are not guessed into any sales channel.
export function normalizeSalesChannel(value) {
  const source = String(value ?? "").trim().toLowerCase();
  return ALIASES[source] || null;
}

// UI-only: show canonical names for known historical aliases without changing
// any stored record. Unknown historical values remain visible for manual review.
export function salesChannelDisplay(value) {
  const canonical = normalizeSalesChannel(value);
  if (canonical) return canonical;
  const raw = String(value ?? "").trim();
  return raw ? `${raw} (รอตรวจสอบ)` : "—";
}
