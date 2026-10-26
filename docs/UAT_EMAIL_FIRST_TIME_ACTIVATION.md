# Corporate Email First-Time Activation — UAT-only staged migration

## Login identifier policy (updated 27 October 2026)

**The login field accepts Employee ID OR Corporate Email**, not email-only. This avoids blocking AE/SM/Management staff while the corporate email roster is incomplete.

- Employee ID: continues using the existing UAT credential lookup and password rules, even if `GEO_UAT_EMAIL_LOGIN_ENABLED=true`. It does not require a User Master email.
- Email: supported only for users whose verified User Master email is present, unique, on the approved corporate domain, and whose UAT credential is `active` with a password set through activation.
- The backend distinguishes the identifiers by `@`; invalid or unknown emails fail closed. Email matching is case-insensitive; Employee ID is kept as text, including leading zeros.
- The frontend shows a single `Employee ID or Corporate Email` text field when the new UI flag is enabled; it never uses `type=email` for that mixed field. Session-expired re-auth uses the same rule.
- For employees without registered emails, keep using their Employee ID. Do not invent emails, bulk-activate accounts, or change existing passwords.
- This does not relax authorization: each successful login still resolves to the same User Master `user_id` and existing Role/Region scopes.

## Status / do not enable by default

This branch prepares the application but **does not** activate new login in Production or UAT.
- Current Staff login using Employee ID continues unchanged while `GEO_UAT_EMAIL_LOGIN_ENABLED` is unset.
- The public activation API fails closed unless `GEO_ENVIRONMENT=UAT` and `GEO_UAT_EMAIL_ACTIVATION_ENABLED=true`.
- The login UI remains Employee ID unless the frontend is built with `VITE_GEO_EMAIL_AUTH_ENABLED=true`; then it accepts **Employee ID or Corporate Email**.
- The First-Time Activation entry point appears only with `VITE_GEO_EMAIL_ACTIVATION_ENABLED=true`.
- Do not switch the frontend environment variables before updating the matching backend.
- A company email suffix is **not** proof of ownership. The authorized custodian must verify the User Master email and deliver the activation code to that exact mailbox by an approved, private route.

## Google Sheets (schema prepared, no identity/password mutations)

1. `B2B_GEO_User_Org_Master / Users` already has `email`. Keep stable `user_id`, `employee_id`, role, and Region. Verify real corporate email address, verified ownership, uniqueness, active status, and permission to receive UAT activation.
2. `UAT_Credentials / UAT_Credentials` now has columns:
   `user_id | employee_id / username | temporary_password | password_hash | credential_status | activation_code_hash | activation_expires_at | activation_used_at | password_set_at | password_changed_at | password_hash_version`.
   Blank `credential_status` = legacy UAT. **Never** infer that existing `password_hash` means the employee has already set a personal password.
3. Do not fill missing employee email or passwords with fabricated data. Credential `user_id` must be correct and unique.
4. Do not share the Credentials workbook, its backup, activation codes, hashes, or Script Properties in GitHub, tickets or email threads.

## Backend scripts / administrator-controlled rollout

Use the **existing Apps Script project and existing deployment**. Keep the previous deployment version and approved private backup. Build from the exact same Git commit as the web application: `npm ci && npm run gas:build && node scripts/gas-singlefile.mjs`.

1. In Script Properties, set `GEO_ENVIRONMENT=UAT`. Leave `GEO_UAT_EMAIL_LOGIN_ENABLED` and `GEO_UAT_EMAIL_ACTIVATION_ENABLED` **unset/false** until all checks are complete.
2. Confirm existing `GEO_SHEET_ID_B2B_GEO_UAT_Credentials_Distribution`, `GEO_SHEET_ID_B2B_GEO_User_Org_Master`, Pipeline DB and Config bind the intended live UAT sheets. Do not run setup or copy sheets over the canonical DB.
3. Deploy matching GAS into **existing** Web App, retaining the existing `/exec` URL, then verify old Employee ID login and Role scope are unchanged.
4. Run `debugUatLoginReadiness()` (read-only) and verify Email roster separately. In Apps Script editor, run `prepareUatEmailActivation()` to initialize activation-signing secret and password pepper only if safe. It explicitly refuses to overwrite a missing pepper when existing password hashes are present.
5. Configure `GEO_UAT_ALLOWED_EMAIL_DOMAINS` to the **approved exact comma-separated domains**, e.g. a verified domain from company IT. Do NOT guess it is `truecorp.com` or `truecorp.co.th` from the display label `@truecorp`.
6. When the security owner approves a small pilot, set `GEO_UAT_EMAIL_ACTIVATION_ENABLED=true` in Script Properties.
7. For an approved single test user only: verify the account's corporate mailbox; set `GEO_UAT_ACTIVATION_ISSUANCE_APPROVED=YES` and `GEO_UAT_ACTIVATION_TARGET_EMAIL` to their verified email; run editor-only `issueUatActivationForApprovedTarget()`. The one-time 64-character code must be handled confidentially and delivered by your approved corporate channel. Do not log it. The helper clears the approval and target after one issuance. Code expires after 24 hours.
8. From an approved test browser with the activation UI enabled, verify code; use 10-minute activation ticket to set a new personal UAT password; the code is invalidated and the password hash saved, with `credential_status=active` and `password_set_at`. Activation **does not issue a normal app session**.
9. After verifying the email-enabled pilot accounts, activation, hashed passwords and role scopes, enable `GEO_UAT_EMAIL_LOGIN_ENABLED=true` AND deploy the frontend with `VITE_GEO_EMAIL_AUTH_ENABLED=true`. Prior to this cutover, existing employee-ID login remains the default.
10. Do not deploy the email-login UI switch ahead of Backend: it would lock users out. Revert the front-end flag and Script Property to return to legacy UAT login only under an approved recovery plan.

## Security and architecture

- Passwords are checked server side and never recorded directly in Google Sheets after successful first-time activation. Existing UAT HMAC-SHA256 + random salt + secret pepper is retained **only** to support migration. It is **not** Argon2id or an approved Production password provider.
- Activation code is HMAC-hashed, 24-hour expiry, max five failed checks per normalized email over ten minutes in GAS, single use, and only for exactly one active verified User Master account.
- A signed 10-minute `uat_activate` ticket is purpose-limited; it does not grant access to Dashboard/Tasks/API. Completion checks the current hashed code and status again under Apps Script's script lock.
- Successful activation removes this row's legacy plaintext temporary password, sets password hash + timestamps and consumes the one-time code. A separate normal Login is required.
- Full corporate SSO/MFA, account recovery, automated corporate email sending, standards-grade password KDF, and real-data security approval are **not** provided by this UAT change.
- A UAT credential store in Google Sheets is not suitable as Production auth. Plan migration to the company-approved identity provider; preserve existing User Master mapping and role/region API authorization.

## Verification and release gates

Run `npm run lint`, `npm run build`, `node --test tests/*.test.mjs`, `npm run gas:build` and `node scripts/gas-singlefile.mjs`. Test synthetic AE/SM/Management/Admin, existing login unchanged, invalid/expired/used code, mismatched user IDs, duplicate emails, wrong domain, inactive account, wrong password, session expiry, and forbidden Region access.

Do not attempt live email activation for any employee without a verified email. Employee-ID login remains available to all existing authorized UAT users.

## Optional interim onboarding: new or untouched blank UAT credentials (no email needed)

For an individually approved **Active** User Master employee with a unique Employee ID and user_id, use editor-only `provisionOneNewUatEmployeePassword()`. It now supports (a) no existing Credentials row, or (b) one correctly mapped existing Credentials row with **both temporary_password and password_hash blank**, empty credential status, and no activation state. It **never** resets an existing password, changes an Active/Inactive user, or enables a Disabled credential.

Each approved invocation generates an independent random `XXXX-XXXX-XXXX` temporary password, persists **only** a salted and peppered hash into Credentials, calls `store.flush()`, and returns the password only once to the authorized Apps Script editor. The `temporary_password` Sheet cell remains blank on purpose. **Do not write the returned password into Sheets, GitHub, logs, or a shared chat.** Use an approved private delivery mechanism.

Required Script Properties: `GEO_ENVIRONMENT=UAT`, `GEO_UAT_NEW_CREDENTIAL_APPROVED=YES`, `GEO_UAT_NEW_EMPLOYEE_ID` = the exact verified target Employee ID. Review and approve each individual account before provisioning. The helper deletes the approval and target on success. It rejects ambiguous/mismatched identities, nonblank passwords or hashes, any nonblank credential status, and pending activation. Existing Admin credentials and other users remain unchanged.

Do not enable `GEO_UAT_EMAIL_LOGIN_ENABLED` for this flow. Continue Employee ID login. This temporary-password onboarding is UAT-only; it does **not** substitute for first-time corporate email verification or the separate email-activation flow. Permanent corporate SSO/MFA is still recommended.

## First sign-in with an existing UAT Temporary Password (separate from email activation)

**What users see after coordinated deployment:** Sign in with Employee ID and their current temporary password. When `GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED=true`, the server validates the account and password. An **Active** User Master account with a correctly mapped, not-yet-personal credential (plain temporary value or previously issued UAT hash with empty `password_set_at`) gets a signed, purpose-limited **10-minute password-setup ticket**, never a Pipeline session. The frontend navigates to `/setup-password` where the user enters New Password and Confirm Password. On successful save, the server clears `temporary_password`, writes a salted/peppered UAT `password_hash`, `password_hash_version`, `password_set_at`, `password_changed_at`, sets `credential_status=active`, and commits Sheets **before** reporting success. The ticket is invalid for subsequent attempts; the user signs in again with Employee ID and their personal password.

This also applies to employees who previously logged in with a temporary password but have never set a personal one; historical login tracking is **not required or assumed**. Users already holding an unexpired old app session are denied Pipeline requests until personal setup completes once the migration flag is enabled.

**Inactive User Master or disabled Credentials are never enabled by this feature**. Reactivation requires a separately approved access review. Existing personal-password users continue normal sign-in; no forced reset.

**Rollout:**
1. Review the GitHub PR and required automated tests. Do not enable the migration flag yet. Confirm the authorized UAT Apps Script deployment is using the correct User Master, Credentials, Script Properties, existing API URL and backed-up data.
2. Deploy the matching `Code.gs` to the existing Apps Script `/exec` Web App **with the new migration flag still OFF**; verify the existing Backend/API and Pipeline remain healthy. Configure `GEO_ENVIRONMENT=UAT`, `GEO_UAT_PASSWORD_PEPPER` and `GEO_UAT_ACTIVATION_SECRET` (never log or share their values). Use editor-only `prepareUatEmailActivation()` when appropriate to provision missing secrets without overwriting an existing pepper.
3. Publish the new frontend **before enabling the migration flag**. The UI understands `password_setup_required` but remains compatible with the old login response. GitHub Pages `deploy-pages.yml` intentionally blocks automatic auth-related releases: after verifying the backend deployment, use an explicitly authorized manual UAT dispatch with `backend_verified=true`. Confirm the new frontend version is actually live.
4. When frontend and backend are confirmed matching in controlled UAT, set `GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED=true` (default **false**). This flag is distinct from `GEO_UAT_EMAIL_ACTIVATION_ENABLED` and `GEO_UAT_EMAIL_LOGIN_ENABLED`; keep corporate email flags off until email mapping is approved.
5. Test with an approved **Active** account: valid Temporary Password → set new password → Sheets committed → temporary password rejected → new password accepted. Also test wrong password, expired/forged/replayed ticket, Inactive/Disabled, old session and access scopes. Do not share the temporary password or hashes in logs or chats.
6. After migration, close the legacy plaintext login recovery window (`GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS=false`) if no approved older flows still need it, and plan company SSO/MFA before Production.

**Caution:** The UAT password hash uses salted/peppered HMAC-SHA256 for backward compatibility, not Argon2id or an enterprise identity provider. This is not approved for Production authentication. The initial temporary password's ownership is only as trustworthy as its private distribution: do not email/show it publicly or grant access to inactive identities.
