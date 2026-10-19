# UAT authentication Phase 1 migration — 2026-10-19

**Do not use real customer data yet.** The current Apps Script Web App is accessible to the public internet if deployed as Anyone and executes with the publisher's privileges. The short-lived signed sessions and role-scoped API remain in effect, but are not a substitute for corporate SSO.

## Included

- Preserve existing username-specific 5 failures/10 min throttle.
- Add script-global 50 failed login attempts/10 min throttle to slow spraying across many employee IDs. Global limits can be used for denial of service; use corporate SSO/API gateway for production.
- Add optional `password_hash` column with random per-user salt and a separate random pepper stored in Script Properties. Format `hmac-sha256-v1$<salt>$<digest>`.
- Hash entries take priority; a hash mismatch never falls back to a stored plaintext password.
- Support legacy plaintext only until the explicit migration. The migration is **not** triggered by web requests or deployment.

## Safe staging procedure (manual, authorized)

1. Keep a private backup of the **UAT_Credentials** spreadsheet with restricted permissions. Check the current `GEO_SHEET_ID_B2B_GEO_UAT_Credentials_Distribution` binding.
2. Replace the existing deployed Apps Script code with a current **merged Code.gs** that retains V4 binding checks and diagnostics. Save; Deploy > Manage deployments > Edit existing > New version. Verify ordinary legacy login first. Do not publish the raw Main.js separately: it depends on generated contract/core.
3. Set Script Property `GEO_UAT_HASH_MIGRATION_APPROVED` exactly to `YES`.
4. In the Apps Script **editor**, run `migrateUatCredentialsToSaltedHashes()` once. It checks workbook identity, usernames, existing hashes, creates salt/hash values, verifies the saved hash, then erases each original plaintext password. The process is resumable. No passwords are printed.
5. Verify result `ok:true`, `remainingPlaintext:0`, `hashedRequired:true`. Test at least an AE, an SM and Admin login with *their existing* passwords; confirm a wrong password fails and role scope remains unchanged.
6. Lock down/delete the **old plaintext backups** after validating migration, subject to organization retention policy; rotate UAT passwords if those workbooks were broadly shared. Remove the `GEO_UAT_HASH_MIGRATION_APPROVED` property after migration.

## Limitations

This is a **salted keyed HMAC-SHA256 hash**, not Argon2id/scrypt/PBKDF2. The pepper mitigates a Credential Sheet-only leak; it cannot protect if both Apps Script Properties and the sheet are exposed. Corporate SSO with MFA, least privilege and appropriate authentication gateway remains required before live PDPA customer data. A `must_change_password` flag is not yet enforced: do not claim users are forced to reset passwords. Retained older password sheet backups still pose risks.