# Task 4 Report: Global City Partner Recruitment Flow

## Status and implementation

Complete. Added the global `/city-partner` page with fixed canonical metadata, validated live/coming-soon city resolution, a stable-intent two-stage coordinator, accessible controls, safe anonymous analytics, and browser-tested retry/skip flows.

- Missing query resolves only the configured default city; resolver failure is visible and disables submission. Explicit uppercase, empty, array, unknown, or otherwise noncanonical city values fail closed. Valid hidden profiles remain selectable for their direct URL.
- Stage one sends the exact Task 2 body and is durably successful before stage two is exposed. Both stages coalesce concurrent clicks; retries retain the same mounted request ID and form values. Stage two can be skipped without a details request or a false completed event.
- Anonymous analytics allow only `city_partner_application_started/submitted/completed` with canonical `city_slug` and closed stage metadata. No query, source path, phone, name, organization, or free text is emitted.
- The page uses the existing typography/color/spacing tokens, one H1, existing field/button primitives, native labelled checkbox groups, status regions, first-invalid focus, keyboard controls, and 44px minimum targets. Copy explicitly avoids revenue, exclusivity, and opening-date promises.
- The sitemap already contained `/city-partner` exactly once, so no sitemap edit was needed.

## TDD evidence

- Initial RED: focused run failed because the form module and route did not exist and the analytics helper was undefined.
- Follow-up REDs caught stage-one failure being indistinguishable from a saved-stage error, noncanonical analytics metadata, city-option membership bypassing the authoritative resolver, and an invalid city consuming the once-only started event.
- Focused Task 4/analytics/sitemap: 5 files, 36/36 passed.
- Relevant frontend/API regression: 11 files, 114/114 passed.
- Full unit suite: 198 files passed, 2 database files skipped; 2872 tests passed, 4 skipped.
- Node 22 TypeScript, targeted ESLint, and `git diff --check`: exit 0.

## Browser and build evidence

- Used previously free port 3721 rather than reusing the existing 3717 process. Verified listener PID 20880 ran Node 22, Next 16.2.10 webpack, and the exact worktree `E:\github\sbh\.worktrees\multi-city-frontend\payload-office-platform`.
- HTTP proof before Chromium: `/city-partner`, valid/invalid city query variants, and `/entrust` returned 200; public API GET returned its expected 405.
- Chromium: 3/3 passed. Verified exact two-stage bodies/order/stable request ID; duplicate-click coalescing; 429 values retained and retried; canonical and one H1; invalid-city visible disabled state and keyboard recovery; optional skip without details request; 375px no horizontal overflow; no unexpected console/page errors.
- Node 22 `next build --webpack`: exit 0 and emitted `/city-partner` as a dynamic route. During page-data collection the existing production guard correctly logged that the deliberately local `NEXT_PUBLIC_SITE_URL=http://localhost:3721` was not HTTPS/non-local; the build continued and finalized. No guard was weakened.
- The local server was stopped and port 3721 had zero listeners after verification.

No database/schema/migration, plan/ledger, deployment, push, or production action was performed.
