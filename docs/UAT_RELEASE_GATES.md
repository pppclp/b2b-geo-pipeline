# B2B GEO Pipeline — UAT Release Gates (25 October 2026)

This repository is a **UAT-only** workflow with a publicly reachable Apps Script deployment if configured as Anyone. Do not use real customer data until authorized IT/security/privacy review approves identity, hosting and data protection controls.

## Scope of the proposed changes
- Fail closed when a required Google Sheet is absent, lacks headers or has missing/duplicate required headers. Backend response includes `REQUIRED_SHEET_MISSING` or `SCHEMA_MISMATCH` plus a support error ID; internal workbook details remain server-side.
- A failing optional master read is an error (except an authorized 403), never silently returned as zero records.
- New Support Requests remain **Open / Unassigned** until Management/Admin claims them. In Progress and Resolved require a responsible owner; stale support saves return 409.
- Pipeline Quick Views are scoped Open counts with one-click links, preserving Search, Month, Region, Stage, Status, List/Board and export. Quick View counts are before user-applied filters.
- The sidebar identifies the app as UAT/test-data only. This is communication, **not** a replacement for SSO.

## Release procedure (requires approval)
1. Confirm existing Apps Script project, deployment version, and Script Properties. Preserve the current `/exec` URL.
2. Privately back up test workbooks. Read-only verify exact headers in Pipeline DB, Pipeline Config, User Master, and UAT Credentials. Do **not** run `setup()`.
3. Build `npm run gas:build` and push the approved **combined** Apps Script code to the existing project; deploy a new version only in a coordinated maintenance window.
4. Deploy the matching frontend only after backend is verified. Never merge frontend first without confirming a compatible backend revision.
5. Verify AE/SM/Management/Admin role scopes with distinct test accounts; confirm no missing schema is represented as zero.
6. Test Support Request claim, In Progress, resolve, two-user stale edit, and error/refresh behavior.
7. Load test simultaneous users against synthetic data; confirm script locks, write recovery and rollback.

## Risks & compatibility
- **Breaking change**: Support Request PATCH now requires `expected_updated_at`. Deploy frontend and Apps Script together; old clients receive 428 until updated.
- A sheet missing a required header returns 503 by design. Review migration requirements; do not auto-create or overwrite a sheet.
- Signed UAT sessions and temporary-password authentication are not production security approval. Production requires corporate SSO/MFA, access controls, monitoring, key management, backup policy and review.
- GitHub CI passing does **not** certify Apps Script runtime, Sheets persistence or permission isolation. Do not merge or deploy this PR without approval.
