# UAT presentation login — Employee ID + Temporary Password (reversible)

**Audience:** authorized UAT owner / credential custodian. **No changes to production auth.**

## Purpose and scope

For a time-boxed, approved **UAT only** presentation, temporarily allow the existing
Employee ID + temporary password to issue an application session directly, without
requiring first-time *Set Personal Password*. The existing personal-password
implementation remains in `apps-script/Main.js`, `server/uatTemporaryPasswordSetup.js`,
`src/pages/SetTemporaryPassword.jsx`, and `src/lib/AuthContext.jsx`. No user IDs,
roles, Pipeline rows, import rows, Pipeline_Events, Snapshots or password values are
modified by this configuration.

**Do not use this mode on production or against real confidential customer data
until IT/security explicitly approves the UAT boundary and access.** Passwords in
`UAT_Credentials` are private. Never paste them into source, PRs, logs or screenshots.

The deployed Apps Script **already implements both switchable behaviors**:
- `GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED=true`: pending credentials receive a
  purpose-limited setup ticket instead of an app session.
- `GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED=false` (or property absent): a valid
  UAT temporary credential can receive a signed app session **only if**
  `geoUatTemporaryPasswordWindowOpen_()` allows it, and Role/Region scoping
  remains enforced on every API request.

The feature flag controls whether password setup is *required now*. It does not
delete the feature, clear password hashes or replace the actual credential check.

## Before touching Script Properties

1. Confirm the website and the **existing** Apps Script `/exec` are the intended
   UAT release. The frontend must have the correct `VITE_GEO_API_URL`, and
   `session/me` must pass the API contract handshake.
2. Back up the restricted credential workbook and verify the source bindings
   with `debugB2bSheetBindings()`. Avoid touching Pipeline DB, Users, User_Region
   or Pipeline Config.
3. Run `debugUatLoginReadiness()` in the Apps Script editor. Privately resolve
   missing/duplicate Employee IDs, missing credential records and any mismatch
   between `Users.user_id`, `Users.employee_id` and the credential workbook.
4. **STOP** if `GEO_UAT_REQUIRE_HASHED_PASSWORDS=true` or if the account has
   already migrated to a personal password. A populated `password_hash`
   always overrides `temporary_password`; never clear a hash or rotate the
   existing pepper to force temporary-password login. Those accounts must use
   their already-activated password or an approved credential recovery.

## Activate only in authorized UAT

In **Apps Script → Project Settings → Script Properties**, use these values:

| Property | UAT presentation value | Why |
| --- | --- | --- |
| `GEO_ENVIRONMENT` | `UAT` | Required, prevents Production login |
| `GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED` | `false` | Pauses the personal-password step |
| `GEO_UAT_EMAIL_LOGIN_ENABLED` | `false` | Keeps login to Employee ID |
| `GEO_UAT_EMAIL_ACTIVATION_ENABLED` | `false` | Pauses email activation |
| `GEO_UAT_TEMP_LOGIN_APPROVED` | `YES` | One-time explicit recovery approval |
| `GEO_UAT_REQUIRE_HASHED_PASSWORDS` | **Must not be `true`** | Never downgrade if already sealed |

Do not manually edit the plaintext window/expiry to bypass the approved helper.
**From the Apps Script editor** run
`enableUatTemporaryLoginFor14Days()` (already in `apps-script/Main.js`).
It checks the approval/readiness, sets `GEO_UAT_ALLOW_PLAINTEXT_PASSWORDS=true`,
sets `GEO_UAT_TEMP_PASSWORD_EXPIRES_AT` (automatic 14-day limit), and removes the
one-time approval flag. This function makes **no changes to stored passwords**.

If the **current deployed Apps Script version** already includes these helpers,
changing Script Properties takes effect without rebuilding Code.gs.
If it does not, deploy a matching reviewed backend version to the **existing**
Web App deployment before following this procedure. Do not publish an unreviewed
Code.gs or change the `/exec` URL during presentation preparation.

## Expected sign-in flow

```
Employee ID + issued UAT Temporary Password
             ↓
Credential matching, UAT/expiry checks, role verification
             ↓
Signed session (4 hours) — Dashboard / Pipeline
```

**No Set New Password screen** while the backend setup flag is false.
The React screens and backend password-setup endpoints remain in source for
later re-enabling. The UI must not manufacture a session if the API rejects it.

## UAT smoke tests (do not use live customer data)

- AE, SM, Management, Admin: one approved test identity for each role logs in
  with the correct UAT password and sees only authorized records/menus.
- Wrong/blank password: no session; 401. Inactive user/duplicate Employee ID:
  no session. AE cannot read another AE's out-of-scope Pipeline.
- Expired plaintext window: login fails closed. Environment `PRODUCTION`:
  UAT password login disabled. Hashed credential: plaintext is never fallback.
- Existing Dashboard/Import/Edit access must still obey Backend role scope,
  `expected_updated_at` and audit controls.
- No credential change, data migration, DB clear, user recreation or Pipeline
  backfill is part of this presentation switch.

## After the presentation / re-enable first-time password setup

1. Communicate the sign-in transition to UAT testers, preserve existing
   `user_id` mappings, and save any drafts before switching.
2. Set `GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED=true`. Check the existing
   pepper and activation signing secret using the approved readiness tools.
   An unactivated temporary-credential user then receives the existing setup
   ticket, sets a unique personal password and signs in again. Already
   activated users keep using their existing personal password.
3. Finish migration and test AE/SM/Management/Admin roles. Then run
   `disableUatTemporaryLogin()` to revoke the plaintext recovery window.
   Do **not** shut down the temporary-password verification pathway before
   all pending users have an approved enrollment/recovery route.
4. Restart the website session and reauthenticate if prompted. This does not
   erase stored Pipelines, Pipeline_Events or Snapshots, but **unsaved local
   form drafts may be lost during forced reauthentication**.
5. For actual Production, use approved corporate identity / SSO and a privacy
   review. **Do not reuse UAT passwords or their HMAC scheme as production auth.**

## Rollback and troubleshooting

- To remove temporary direct login immediately, run
  `disableUatTemporaryLogin()` in the script editor (existing active
  hashed-password logins can continue; direct temporary logins stop).
- To restore the **setup flow** for pending users, set
  `GEO_UAT_LEGACY_PASSWORD_SETUP_ENABLED=true`; verify first-login
  secrets and a valid onboarding path before inviting them to sign in.
- A 401 may indicate a bad/missing credential, duplicate identity, expired
  UAT window, or disabled user; a 503 may mean environment/config/binding
  mismatch. Confirm actual deployed `/exec` and `VITE_GEO_API_URL` when
  backend-version mismatch is shown. Do not fix a 401 by deleting hashes.
- Google Sheets contents are not altered by changing these flags. A scheduled
  deployment/credential migration is a separate authorized operation.
