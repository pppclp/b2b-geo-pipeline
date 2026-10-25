// Centralized Pipeline input rules. Existing historical rows remain readable.
// The supported identifier for new records is currently the 13-digit Thai juristic/tax ID.
// Other identifier types require an explicit field and business approval, not guesswork.
export const CUSTOMER_TYPES = Object.freeze(["Government", "Enterprise", "Industrial", "SME", "Education", "Telco", "Other"]);

export function normalizeCustomerType(value) {
  const input = String(value ?? "").trim();
  return CUSTOMER_TYPES.find((type) => type.toLowerCase() === input.toLowerCase()) || "";
}

export function businessIdError(value) {
  const id = String(value ?? "").trim();
  if (!id) return "Business ID is required";
  if (!/^\d+$/.test(id)) return "Business ID must contain digits only";
  if (id.length !== 13) return "Business ID must be 13 digits. Restore the original ID from source data; do not guess leading zeroes";
  return "";
}

export function netRcReconciliation({ expected, calculated }) {
  if (expected === "" || expected == null) return { checked: false, matches: null };
  const source = Number(String(expected).replace(/,/g, ""));
  const actual = Number(calculated);
  if (!Number.isFinite(source) || source < 0) return { checked: true, matches: false, error: "Reference Net RC must be a non-negative number" };
  if (!Number.isFinite(actual)) return { checked: true, matches: false, error: "Cannot calculate Net RC from imported pricing" };
  const difference = Math.round((actual - source) * 100) / 100;
  return { checked: true, matches: Math.abs(difference) < 0.01, source, calculated: actual, difference,
    error: Math.abs(difference) >= 0.01 ? "Net RC differs from the source reference. Verify Quantity, Unit Price, OC and the approved business formula" : "" };
}
