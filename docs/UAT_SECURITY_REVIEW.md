# B2B GEO Pipeline — UAT Authentication Hardening

## Scope of this change

This patch removes the ability to impersonate another AE / SM / Admin merely by changing
`geo_user_id` or `X-User-Id` in the browser. The backend now **issues and verifies** a
short-lived, HMAC-signed UAT session (4 hours). A session carries an immutable subject ID
and expiry; **roles and Region access are always re-read from User Master** for each call.

- Browser stores the signed token in **sessionStorage** (not a permanent user-ID login).
- Google Apps Script validates `sessionToken` from the POST body on **every data request**.
- All Apps Script reads now use POST, so tokens are not included in URL query strings.
- Local Node dev server accepts signed `Authorization: Bearer <token>` only.
- The backend normalizes case differences (`AE` vs `ae`) when checking permission rules.
- Existing Admin **Demo As** remains available only to authenticated Admin identities.
- Apps Script throttles repeated invalid UAT sign-ins (5 failures per employee ID / 10 min).
- Deactivating a user in User Master blocks use of their unexpired session at the next request.
- The Script Property `GEO_UAT_SESSION_SECRET` is auto-generated on the first successful login.
  It is not stored in a workbook and must **never be committed**.

## Deployment: coordinate frontend and Apps Script

**WARNING:** Old frontend login tokens and new API sessions are incompatible. Use a short
maintenance window; do not deploy either half alone and leave the app in that state.

1. Verify the PR tests and review its changes. Do not write real customer data in UAT until security is verified.
2. On the machine with the **existing** Apps Script project linked using clasp, run
   `npm run gas:push`. Do not create an unrelated new Apps Script project.
3. In that existing Apps Script project: Deploy > Manage deployments > Edit > New version.
   Keep the existing `/exec` URL and confirm the correct Spreadsheet ID Script Properties.
4. Merge the frontend PR to `main` to trigger GitHub Pages deployment.
5. Sign in with an active User Master account. Verify: /session/me, AE-owned Pipeline,
   region-scoped SM view, Admin-only Demo As, Won/Lost, CSV export, and logout.
6. Confirm that a request with only `userId` or `X-User-Id` returns 401;
   tampering with a signed token must also fail.
7. Check permission isolation with a second user account: AE must never see another AE's
   out-of-scope Pipeline. Check the Apps Script deployment error logs.

**Emergency revocation:** run `revokeAllUatSessions()` in the existing Apps Script project
to rotate the signing secret and force all users to sign in again.

## Sheets and identities

The current `B2B_GEO_User_Org_Master.xlsx` has six tabs. Four are operational:

- `Users` — source for identity, role, active/inactive status
- `User_Region` — source for the permitted Region scope
- `Regions`, `Territories` — geographic master data

`README` and `Data_Dictionary` are documentation only, explicitly excluded from runtime
reads in the YAML. **They do not need to be deleted**; deleting them provides negligible
performance improvement. A future move to a database can omit them.

`UAT_Credentials.xlsx` currently contains `UAT_Credentials` plus a `Setup_Guide`.
The backend uses only `employee_id / username` and `temporary_password` for password
validation. Repeated Role and Region fields **must not** be treated as permissions: the
User Master is authoritative.

### Data reconciliation to review

At the time of the supplied files:
- User Master: 35 active users (28 AE, 7 SM).
- UAT Credentials: 36 rows, including one Admin identity not present in User Master.
- The extra Admin credential does **not** grant Admin access; the account must be explicitly
  provisioned and approved in User Master before it can log in.
- `must_change_password` is present in UAT credentials but password rotation is not
  implemented in the current app.

**Do not auto-add a privileged Admin from credentials.** Privileged accounts require explicit
owner verification and approval.

### Long-term recommendation

For production, replace the temporary-password credential workbook and Apps Script public
endpoint with **corporate SSO** (e.g. Microsoft Entra ID / OIDC if supported by company IT)
and a backend that verifies identity tokens and enforces RBAC/region scope server-side.
A proper database is preferable as usage and history volume grow, but migration is a
separate scoped project and must preserve the Pipeline, User, and Audit records.
Never store production plaintext passwords in Google Sheets.

### Remaining limitations

This is **UAT hardening, not a production security certification**.
Signed bearer tokens in sessionStorage still need XSS protection and a deployment-specific
content security policy. Apps Script is run with the deployer's privileges; API endpoints
are internet-reachable when configured as Anyone. Current password sheet still contains
temporary credentials in plaintext, and there is no per-user token revocation except
deactivating that user or globally rotating the secret.

Before production, decide corporate identity provider, secure hosting/API gateway,
password/credential retirement, monitoring, key rotation, backups, compliance and pen testing.
