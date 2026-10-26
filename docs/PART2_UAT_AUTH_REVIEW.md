# Part 2 — UAT Authentication Identity-Binding Review

## Source baseline and scope
- Reviewed the latest `main` after PR #82: `fb862e9e55cb16e4989e6684aa15008660a8ca06`.
- Backend source: `apps-script/Main.js` and shared `server/core.js`.
- Existing GAS session signing, expiry, `Demo As` authorization, and AE / SM / Management / Admin Region scoping are retained.
- No UI redesign, credential migration, database or Script Properties change, live test call, or deployment is part of this PR.

## Confirmed code-level identity-binding issue
Before this PR, UAT login used `.find()` to select the first `Users` and `UAT_Credentials` row matching the supplied Employee ID, and it did not check a populated credential `user_id` against the selected user. A duplicate Employee ID or incorrectly mapped credential could select the wrong identity/role.

Now login requires exactly one matching `Users` row and one matching `UAT_Credentials` row. Where the credential `user_id` is populated, it must match `Users.user_id`. Legacy credential rows with a blank `user_id` remain supported; the existing password-hash precedence, opt-in temporary-password recovery, and per-username throttling are unchanged.

Invalid or ambiguous account mappings are denied with the existing generic login failure; no account names or identifiers are returned.

The editor-only `debugUatLoginReadiness()` adds aggregate counts:
- `duplicate_user_employee_ids`
- `credential_user_id_mismatch`

These totals help the authorized operator identify a source-data repair need **without logging names, Employee IDs, passwords, salts, hashes or workbook IDs**. The diagnostic does not change any records.

## Verification coverage
- Existing local signed session and shared backend role/region security tests.
- New tests exercise GAS session issuance, signature tampering, expiry, missing signing secret and all-session revocation.
- GAS entrypoint tests exercise forged browser `userId`, unauthenticated requests and login-only bypass.
- Identity-binding tests exercise a normal account, duplicate users, duplicate credentials, incorrect credential user binding, inactive users and aggregate diagnostics.
- CI must pass `npm run lint`, `node --test tests/*.test.mjs`, `npm run build` and generated Apps Script bundle build.

Synthetic test identities only; no live Apps Script calls are made.

## Operational verification (read-only, authorized UAT owner only)
1. Record the **currently deployed Apps Script version** and verify the current GitHub Pages source/release state. Do not assume that merged GitHub code is running in Apps Script.
2. Using the Apps Script editor of the **existing approved UAT project**, confirm `GEO_ENVIRONMENT` and the existing bound User Master / restricted Credentials workbook **privately**; do not publish IDs or secret values.
3. If the runtime version contains the current diagnostics, run the editor-only read-only `debugUatLoginReadiness()`. Collect only aggregate counts. Check existing `duplicate_credential_ids`, newly added duplicate-user and credential-user mismatch counts **only after deploying this exact generated backend bundle in a coordinated UAT release**.
4. Resolve any duplicates or incorrect `user_id` bindings privately under change control **before enabling the new backend code**. Do not use public issues/logs to share affected identities.
5. Confirm UAT hashed-password migration using documented aggregate results, not guesses. Do not set `GEO_UAT_REQUIRE_HASHED_PASSWORDS=true` until an authorized operator has confirmed all necessary credentials migrated and valid AE, SM, Management and Admin logins.
6. Do not enable the temporary plaintext recovery window except under a separate, explicitly approved UAT recovery procedure; do not broaden its expiry or disable per-account throttling.
7. After a coordinated Apps Script release, verify known authorized synthetic test accounts (AE, SM, Management, Admin), negative login, session expiry, cross-Region isolation and admin-only operations. Keep the existing `/exec` deployment URL.

**Important:** The code currently permits a legacy UAT temporary-plaintext configuration without an expiration property. This PR does not change that runtime behavior to avoid unexpectedly disabling existing UAT login. An authorized operator must verify whether this legacy configuration remains enabled and close it after a confirmed credential migration. This remains a UAT security risk until resolved. The HMAC-SHA256 keyed hash is not a production password KDF or approved corporate SSO.

## Release and rollback
- **Do not deploy Apps Script as part of this PR.**
- The normal GitHub Pages auto-release safety gate will not permit unverified backend code.
- If review finds this patch unsuitable, close the PR; running app is unchanged.
- Before any future coordinated UAT backend release, retain the previous approved generated `Code.gs` bundle and current Apps Script deployment version; if regression occurs, restore that existing deployment version and validate role-specific login, without changing or rolling back customer data.
- Do not invoke `setup()`, overwrite existing databases, or run obsolete migration or binding helpers.

## Remaining limitations
- Current live Script Properties, credential distribution/migration and deployed GAS source revision were not accessible from the repository. No runtime compliance or security approval is claimed.
- Individual user session revocation is not implemented; existing global session-secret rotation invalidates all sessions. No new persistent session store is introduced.
- Corporate SSO/MFA, private hosting/security review, and authorized real-data use are separate Production decisions tracked by Issue #69.
