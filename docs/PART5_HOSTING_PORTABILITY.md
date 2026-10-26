# Part 5 — Hosting Portability Checklist & Rollback

**Scope:** frontend build / release safety only. No React UI, typography, API contract, business logic, Apps Script, Google Sheets, authentication, DNS, or production deployment is changed.

## Verified source state

- Baseline `main`: `fb862e9e55cb16e4989e6684aa15008660a8ca06`.
- Last confirmed successful **GitHub Pages deploy job**: workflow `Restore Original Font to GitHub Pages`, run `40252003479`. Its pinned checkout is `b8c272da7c878db46b4a12745a04678da96c705d`; the workflow trigger commit is **not** necessarily the published source.
- The later GitHub Pages workflow for `fb862e9` succeeded at preflight but skipped build/deploy.
- Generated Apps Script builds are available separately from draft PRs #83/#84; the deployed Apps Script version remains **unverified**.

## Confirmed issues and fixes

1. Prior `npm run build` **always** generated `dist/404.html`. This GitHub Pages-specific behavior may suppress Cloudflare Pages default SPA fallback on root-based hosts. Now a project base (`/b2b-geo-pipeline/`) generates the identical `404.html`, while a root (`/`) build generates `_redirects` with `/* /index.html 200` and leaves no `404.html`.
2. The existing Pages release gate treated a successful **workflow** as a published source revision, even when the `deploy` job was skipped. It now checks actual successful `deploy` jobs across the normal and pinned recovery workflows. A last-published pinned recovery checkout is **not equated to the run's trigger SHA**: the gate blocks unattended auto-publish until a manually verified release establishes an unambiguous baseline.
3. The existing Vite `base`, React Router `basename={import.meta.env.BASE_URL...}` and `%BASE_URL%` favicon paths already support configurable base paths. No UI/router changes.
4. Existing `src/api/client.js` sends signed GAS requests using `POST`, `text/plain`, JSON envelopes and no tokens in query strings. Existing `validateApiContract` fails closed on wrong API version/capabilities. No proxy or endpoint change warranted.

## Build matrix

| Provider | `VITE_BASE_PATH` | Backend | Build | SPA fallback |
|---|---|---|---|---|
| GitHub project Pages | `/b2b-geo-pipeline/` | Existing approved GAS `/exec` | `npm ci && npm run build`, publish `dist` | Generated `404.html` |
| Cloudflare Pages | `/` | Same approved GAS `/exec` | `npm ci && npm run build`, publish `dist` | Generated `_redirects` (200), no `404.html` |
| Netlify | `/` | Same GAS | Same | Generated `_redirects` |
| Vercel static site | `/` | Same GAS | Same | Configure provider-level SPA rewrite to `/index.html`; verify existing assets still load |

Do **not** put credentials, session tokens, Script Properties, customer records or private Sheet IDs into `VITE_*` variables. The existing **approved** GAS `/exec` URL is a browser-visible endpoint, not a private authentication secret. Its correctness and deployed version still require authorization and verification.

### Reproducible local / CI smoke tests

```sh
npm ci
npm run lint
node --test tests/*.test.mjs

VITE_BASE_PATH=/b2b-geo-pipeline/ VITE_GEO_API_URL=https://script.google.com/macros/s/CI_PLACEHOLDER_NOT_DEPLOYED/exec npm run build
node scripts/check-static-build.mjs --base /b2b-geo-pipeline/

VITE_BASE_PATH=/ VITE_GEO_API_URL=https://script.google.com/macros/s/CI_PLACEHOLDER_NOT_DEPLOYED/exec npm run build
node scripts/check-static-build.mjs --base /
```

The placeholder GAS URL must **never** be deployed. The test uses a local static HTTP server with the expected provider fallback and checks JS/CSS/icon assets, `/login`, `/pipeline`, `/opportunity/SYNTHETIC`, refresh and fallback HTTP status. It makes **no real API calls**. CI runs both builds without deploying either. Local development still uses `vite` with its existing `/api` plugin.

### Optional, read-only approved GAS endpoint check

```sh
GEO_API_URL="<approved HTTPS script.google.com /exec URL>" node scripts/smoke-api-readonly.mjs
```

Without a session this checks **public GET health only**. An explicitly authorized operator can separately inject an isolated short-lived `GEO_TEST_SESSION_TOKEN` to check `POST session/me` and validate contract version/capabilities. Do **not** put the test token in command history, CI, repo or screenshots. It never requests Pipeline/customer records. A Node probe does **not** verify real browser cross-origin/CORS behavior.

### Hosting migration readiness checklist

- [ ] Verify matching frontend candidate and actually deployed Apps Script bundle; check signed `session/me` API contract
- [ ] Verify base path and JS/CSS/font/icon asset URLs for each hosting origin
- [ ] Verify direct visits and browser refresh for `/login`, `/pipeline` and `/opportunity/:id`
- [ ] Verify Pages 404 SPA fallback vs root 200 SPA rewrites (including a Vercel rewrite if used)
- [ ] Verify browser cross-origin POST to Apps Script works with redirects, session expiry and clear 401/403/409 errors
- [ ] Verify incompatible API version displays the existing explicit error rather than an empty Dashboard
- [ ] Verify each role and Region in a permitted isolated UAT account; no live write-heavy tests
- [ ] Record last approved static artifact, matching backend deployment version, release owner and rollback evidence
- [ ] Do not switch DNS/custom domain or move hosting without a separate approved cutover

### Existing workflow safety

`deploy-pages.yml` still uses the existing guarded UI-only automatic publish path and manual `backend_verified` dispatch. Because the most recent confirmed Pages publish used a pinned checkout, the tightened gate conservatively refuses unattended updates from the unverified `main`. The pinned recovery workflow is **kept intact**, not duplicated or deleted. First complete a matching backend/Pages verification and manually approved release before regular UI-only publishing can resume.

### Rollback plan

1. **Unmerged PR:** close it; hosted site and GAS stay untouched.
2. **Merged but not deployed:** revert the focused PR. Do not equate merge or a green preflight workflow with a live deploy.
3. **Future preview-host issue:** discard preview; continue using the current GitHub Pages artifact and existing Apps Script `/exec`. Never alter canonical Sheets or credentials to solve a hosting issue.
4. **Future approved hosting cutover issue:** restore the last approved frontend artifact and route/DNS through the release owner. Browser `sessionStorage` is origin-scoped, so users may need to sign in again on a new origin. Keep the original GAS deployment and data unchanged.
5. **Never** run `setup()`, disable transaction recovery or revision gates, clear backup sheets or reset passwords for a frontend hosting rollback.

## Remaining verification limits

No real Cloudflare/Netlify/Vercel browser deployment, DNS test, cross-origin browser CORS test, real GAS session check or customer data mutation was performed. Only local simulated hosting and synthetic tests can be claimed.
