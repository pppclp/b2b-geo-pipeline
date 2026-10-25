# UAT Login Recovery & Production Auth Handoff

## Goal / safety boundary

Restore **individual** UAT logins for all currently provisioned AE, SM, Management
and Admin users using their existing Employee ID and UAT temporary password.
**Do not bypass authentication, grant every user Admin, or allow AE to see other AE pipelines.**
This is limited to an approved UAT environment containing synthetic / permitted test data.
The GitHub repository is public: NEVER commit passwords, credential rows, secrets,
Script Properties, personal data or spreadsheet IDs.

Production MUST use approved corporate SSO / managed identity and a security/privacy
review. The UAT plaintext window is NOT a production authentication solution.

## What changed

- `debugUatLoginReadiness()`: a **manual editor-only** diagnostic that prints role-level
  aggregate counts and never prints credentials or employee identifiers.
- `enableUatTemporaryLoginFor14Days()`: an **opt-in manual** way to open a
  **14-day** temporary-password window after validating the runtime workbooks.
  It requires `GEO_ENVIRONMENT=UAT` and a one-time
  `GEO_UAT_TEMP_LOGIN_APPROVED=YES` Script Property.
- `disableUatTemporaryLogin()`: manual immediate shutdown.
- Runtime password verification rejects temporary passwords when the window
  expires or `GEO_ENVIRONMENT` is `PRODUCTION` / `PROD`. A populated
  `password_hash` always wins over `temporary_password`.
- No frontend redesign, no role/scope policy change and no credential sheet
  mutation are part of this patch.

## Deployment: KEEP the existing Apps Script URL

1. Review and merge this change, run `npm ci`,
   `npm run lint`, `node --test tests/*.test.mjs` and `npm run build`.
2. Run `npm run gas:build` then `npm run gas:push` using an authorized
   owner/editor of the **existing** Apps Script project. Do not edit generated
   Contract or GeoCore by hand. Alternatively download the generated Code.gs
   artifact from the PR workflow if using one-file manual deployment.
3. In the Apps Script editor, verify **Script Properties**
   `GEO_SHEET_ID_B2B_GEO_User_Org_Master` and
   `GEO_SHEET_ID_B2B_GEO_UAT_Credentials_Distribution` point to the approved
   UAT sheets; also verify Pipeline DB and Config with
   `debugB2bSheetBindings()`. Do not run `setup()` on an existing DB.
4. Confirm UAT is isolated / uses permitted test data. In Script Properties set:
   - `GEO_ENVIRONMENT` = `UAT`
   - `GEO_UAT_TEMP_LOGIN_APPROVED` = `YES` (one-time)
   - `GEO_UAT_REQUIRE_HASHED_PASSWORDS` must be **unset or false**.
     If already true, STOP: do not downgrade migrated credentials.
5. Run **`debugUatLoginReadiness()`** manually from the Apps Script editor.
   Resolve any missing Employee IDs, missing private credential rows, missing
   passwords, and duplicate IDs. Diagnostics report only totals, not identities;
   an authorized credential custodian must review individual records privately.
6. Run **`enableUatTemporaryLoginFor14Days()`** manually. The function sets
   `GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS=true`, sets an expiration timestamp,
   and removes one-time approval. It does NOT create passwords or accounts.
7. Deploy → Manage deployments → Edit **existing** web app → New version.
   Do not create a separate /exec URL, and do not assume a GitHub Pages deploy
   updates Apps Script. Redeploying is necessary for the new 14-day guard/helper.
   If an urgent restoration is needed **before** rolling out this code, the
   already-deployed login verifier supports
   `GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS=true` in Script Properties;
   use this only as a tightly controlled short-term exception and remove it.
8. From a fresh private/incognito window test one real UAT credential each for
   AE, SM, Management, Admin: correct password -> signed session -> dashboard;
   wrong password -> generic 401; expired token -> re-login; AE out-of-scope
   pipeline -> denied. No password values should enter logs or screenshots.
   Rate limits can temporarily block repeated failed attempts (10 minutes).
9. Run `disableUatTemporaryLogin()` when the temporary UAT period ends.
   The 14-day expiration is defense-in-depth, not an excuse to leave
   plaintext enabled indefinitely.

## Data reconciliation (separate, approved change)

During the 2026-10-25 read-only review, 37 active User Master records were
observed, with 36 configured credential Employee IDs and 1 AE record missing
an Employee ID. The missing Employee ID needs a **real, verified** assignment
from an authorized custodian. Never invent an employee number, use another
person's ID, or place a temporary password in this public repository.

Requested user structure (human names and real IDs to be supplied/verified):

| Role | Actual user target | Separate UAT test account |
|---|---:|---:|
| AE | Real roster | 1 |
| SM | Real roster | 1 |
| Management | 3 | 1 |
| Admin | 2 | 1 |

The 2026-10-25 connected User Master had **one** Management and **one**
Admin; only a verified roster can identify the additional 2 Management and
1 Admin users. User Master and private Credentials must be provisioned together,
and User_Region mappings for Management/SM/AE must be checked. Create separate
synthetic test accounts that cannot access real customer data.

## Production first-login design — NOT IMPLEMENTED HERE

1. Switch the deployment to approved corporate identity provider/SSO
   (preferred) or managed authentication service with verified email activation,
   MFA, reset and lockout policy. If SSO is used, employees normally set/reset
   passwords within the corporate identity provider; the app should not store
   password hashes.
2. If local password setup is expressly approved instead, use a one-time
   short-lived activation token sent to an independently verified corporate
   channel, password storage through a standard password KDF and secure
   provider, reset/recovery and audit workflows. Do **not** reuse UAT hashes,
   UAT passwords, or the UAT HMAC scheme as production credentials.
3. Import verified Employee ID-to-identity mappings and the approved
   4-role/Region authorization matrix.
4. Revoke all UAT sessions, disable `GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS`,
   delete UAT credentials from the Production runtime, and verify that all
   UAT login paths fail closed in Production.
5. Do not turn on Production until security/privacy approval, integration,
   recovery, role authorization and concurrency tests pass.
