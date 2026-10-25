# Financial field definition & reconciliation — BUSINESS SIGN-OFF REQUIRED

**Status: NOT APPROVED. DO NOT USE THIS FILE AS PROOF OF SIGN-OFF.**

## Current implementation (for review, NOT necessarily the approved business formula)
- UI and API calculate `pipeline_value` = `quantity × price_per_sub + oc / 12`.
- `OC` is currently amortized over 12 months even when `contract_period_months` differs.
- `contract_value` in Snapshots = `pipeline_value × contract_period_months` if available.
- There are legacy records whose stored RC/value has not been repriced automatically.

## Questions for Business Owner
| Field | Required business decision | Signed-off definition |
|---|---|---|
| Recurring Charge (RC) | Monthly recurring service revenue before/after discount? | PENDING |
| Net RC | Recurring only or includes OC amortization? If includes OC, why 12 months? | PENDING |
| OC | One-time Charge, recognition and contract allocation | PENDING |
| Monthly Sale Plan | Target/forecast/revenue vs realized sales? Scope and period? | PENDING |
| Pipeline Value | Net RC / weighted net RC / contract value? | PENDING |
| Customer Type Industrial | Independent customer type or subset of Enterprise? | PENDING |
| Business ID | Confirm 13-digit Thai juristic/tax ID policy; are non-tax refs allowed? | PENDING |
| Working With AE | Metadata vs explicit personal read-only access and export scope | PENDING |

## Evidence required
1. Provide a restricted, de-identified source report with sample cases (including discrepancy **300 vs 600**, zero-OC, non-12-month contract, unit-price, multi-sub, and discounts).
2. For each row compare source `RC`, `Net RC`, `OC`, `Monthly Sale Plan` with the API-calculated values. Import Preview optionally accepts **Reference Net RC** for row-by-row mismatch blocking. Do NOT map `Monthly Sale Plan` automatically as Reference Net RC.
3. Confirm aggregate totals by Region, AE Owner, Expected Close Month, Status and Product Category. Resolve every difference or sign a documented exclusion.
4. Record approval by Business Owner in an authorized private release record (no real names/IDs/customer data in this public repository).
5. Only after signed approval: change `src/lib/netRc.js`, Backend and tests together under a versioned contract. Until then do not silently modify the financial formula.

**GO/NO-GO: BLOCKED until financial definitions and reconciliation evidence are approved.**
