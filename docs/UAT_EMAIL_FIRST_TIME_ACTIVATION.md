# Corporate Email First-Time Activation — UAT-only staged migration

## Status / do not enable by default

This branch prepares the application but **does not** activate new login in Production or UAT.
- Current Staff login using Employee ID continues unchanged while `GEO_UAT_EMAIL_LOGIN_ENABLED` is unset.
- The public activation API fails closed unless `GEO_ENVIRONMENT=UAT` and `GEO_UAT_EMAIL_ACTIVATION_ENABLED=true`.
- The login UI remains Employee ID unless the frontend is built with `VITE_GEO_EMAIL_AUTH_ENABLED=true`.
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
9. Only after verifying all user email mappings, activation, hashed passwords and role scopes, enable `GEO_UAT_EMAIL_LOGIN_ENABLED=true` AND deploy the frontend with `VITE_GEO_EMAIL_AUTH_ENABLED=true`. Prior to this cutover, existing employee-ID login remains the default.
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

Do not attempt live email activation with the roster blank or launch `GEO_UAT_EMAIL_LOGIN_ENABLED` until approved identity data are present.
