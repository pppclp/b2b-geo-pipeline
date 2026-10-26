// Centralized Pipeline input rules. Existing historical rows remain readable.
// Business ID is optional for both new and historical records. Preserve digit strings
// including leading zeros; never infer a full ID from rounded scientific notation.
export const CUSTOMER_TYPES = Object.freeze(["Government", "Enterprise", "Industrial", "SME", "Education", "Telco", "Other"]);

export function normalizeCustomerType(value) {
  const input = String(value ?? "").trim();
  return CUSTOMER_TYPES.find((type) => type.toLowerCase() === input.toLowerCase()) || "";
}

export function businessIdError(value) {
  const id = String(value ?? "").trim();
  if (!id) return "";
  if (!/^\d+$/.test(id)) return "Business ID must contain digits only";
  if (id.length > 40) return "Business ID must contain no more than 40 digits";
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
