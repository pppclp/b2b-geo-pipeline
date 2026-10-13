/** Net RC (THB/month), shared by the UI and the local/Apps Script backend. */
export function calculateNetRc({ quantity, pricePerSub, oc = 0 }) {
  if (quantity === "" || quantity == null) throw new RangeError("Number of Subs is required");
  if (pricePerSub === "" || pricePerSub == null) throw new RangeError("Price per Sub is required");
  const subs = Number(quantity);
  const price = Number(pricePerSub);
  const oneTimeCharge = oc === "" || oc == null ? 0 : Number(oc);
  if (!Number.isSafeInteger(subs) || subs <= 0) throw new RangeError("Number of Subs must be a positive whole number");
  if (!Number.isFinite(price) || price < 0) throw new RangeError("Price per Sub must be non-negative");
  if (!Number.isFinite(oneTimeCharge) || oneTimeCharge < 0) throw new RangeError("OC must be non-negative");
  const amount = subs * price + oneTimeCharge / 12;
  if (!Number.isFinite(amount)) throw new RangeError("Net RC is out of range");
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
export function formatNetRc(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return "฿" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
