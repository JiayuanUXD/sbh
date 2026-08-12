# City Partner Applications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, independent, two-stage city-partner application flow with city-scoped operations, notifications, analytics, and no automatic conversion into formal business objects.

**Architecture:** A dedicated `city-partner-applications` Collection stores append-only applicant facts separately from mutable workflow fields. Hardened public APIs create stage one and complete stage two; Payload access, permission codes, city scope, field masking, retryable notifications, and a dedicated global page handle operations and presentation.

**Tech Stack:** Payload CMS, Next.js route handlers and App Router, React, PostgreSQL, Vitest, Playwright, pnpm on Node.js 22.

## Global Constraints

- Plan 1 Gate A must pass before this plan starts.
- Read `AGENTS.md`, `.agent/core.md`, `.agent/backend.md`, `.agent/frontend.md`, `.agent/permissions.md`, `.agent/migrations.md`, and `.agent/testing.md`.
- Do not reuse Leads, Supply Submissions, Form Builder submissions, Merchant, Team, User, or Broker records.
- Stage-one and stage-two applicant facts become immutable after their allowed write; workflow fields are admin-only and audited.
- Full phone requires `phone:full`; otherwise return the existing masked form.
- Public APIs are the only create/complete boundary; Payload Collection public create/update/delete remain closed.

---

### Task 1: Partner application domain, Collection, permissions, and migration

**Files:**
- Create: `payload-office-platform/src/domain/city-partner-application/schema.ts`
- Create: `payload-office-platform/src/domain/city-partner-application/application-protect.ts`
- Create: `payload-office-platform/src/domain/city-partner-application/access.ts`
- Create: `payload-office-platform/src/collections/CityPartnerApplications.ts`
- Modify: `payload-office-platform/src/domain/auth/permission-codes.ts`
- Modify: `payload-office-platform/src/domain/auth/field-mask.ts`
- Modify: `payload-office-platform/src/domain/admin-navigation/navigation-types.ts`
- Modify: `payload-office-platform/src/domain/admin-navigation/navigation-config.ts`
- Modify: `payload-office-platform/src/domain/admin-navigation/navigation-badges.ts`
- Modify: `payload-office-platform/src/domain/admin-navigation/navigation-badge-request.ts`
- Modify: `payload-office-platform/src/test/factory/roles.ts`
- Modify: `payload-office-platform/src/payload.config.ts`
- Create (Payload-generated, then renamed): `payload-office-platform/src/migrations/20260813_020000_city_partner_applications.ts`
- Create (Payload-generated snapshot, then renamed): `payload-office-platform/src/migrations/20260813_020000_city_partner_applications.json`
- Create: `payload-office-platform/src/migrations/20260813_021000_city_partner_permissions.ts`
- Modify: `payload-office-platform/src/migrations/index.ts`
- Modify (generated): `payload-office-platform/src/payload-types.ts`
- Create: `payload-office-platform/tests/city-partner-domain.test.ts`
- Create: `payload-office-platform/tests/city-partner-access.test.ts`
- Create: `payload-office-platform/tests/city-partner-migration.test.ts`
- Modify: `payload-office-platform/tests/permission-codes.test.ts`
- Modify: `payload-office-platform/tests/permission-matrix.test.ts`
- Modify: `payload-office-platform/tests/admin-navigation-config.test.ts`
- Modify: `payload-office-platform/tests/admin-navigation-badges.test.ts`

**Interfaces:**
- Produces: closed identity/resource/status enums, `protectCityPartnerApplication`, Collection slug `city-partner-applications`, permission codes `city_partner_application:read/manage`.

- [ ] **Step 1: Write failing domain/access/permission tests**

```ts
expect(CITY_PARTNER_STATUSES).toEqual([
  'pending', 'contacted', 'evaluating', 'qualified', 'not-fit', 'withdrawn',
])
expect(canTransitionCityPartner('pending', 'contacted')).toBe(true)
expect(canTransitionCityPartner('pending', 'qualified')).toBe(false)
expect(canTransitionCityPartner('qualified', 'evaluating')).toBe(false)
expect(await readAccess(opsHangzhou)).toEqual({ city: { in: [hangzhouId] } })
expect(await readAccess(adm)).toBe(true)
expect(maskForUser(withoutPhoneFull).contactPhone).toBe('138****1111')
```

Assert stage-one fact mutation, second-stage second mutation, terminal rollback, physical delete, and unauthenticated Collection create/update are rejected. Assert OPS/MGR scope cannot read another city and direct API returns false/403.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/city-partner-domain.test.ts tests/city-partner-access.test.ts tests/permission-codes.test.ts tests/permission-matrix.test.ts tests/admin-navigation-config.test.ts`

Expected: FAIL because the domain and permission codes do not exist.

- [ ] **Step 3: Implement closed domain types and transition rules**

```ts
export const CITY_PARTNER_IDENTITIES = [
  'owner-property', 'broker-channel', 'enterprise-service', 'local-operations', 'other',
] as const
export const CITY_PARTNER_RESOURCE_TYPES = [
  'building-owner', 'tenant-demand', 'broker-network', 'local-team', 'government-association', 'other',
] as const
export const CITY_PARTNER_STATUSES = [
  'pending', 'contacted', 'evaluating', 'qualified', 'not-fit', 'withdrawn',
] as const
```

Implement a transition map: pending→contacted/withdrawn; contacted→evaluating/not-fit/withdrawn; evaluating→qualified/not-fit/withdrawn; terminal statuses have no outgoing transitions.

- [ ] **Step 4: Implement Collection field groups and access**

Create exact field groups from spec §11.5. Add server-owned `detailsFingerprint` beside `detailsCompletedAt`; it stores the canonical second-stage content hash used for exact-retry detection and is never exposed publicly. Use a custom read/update access function that first requires the operation code, then returns `true` for unrestricted ADM or `{ city: { in: ctx.cityIds } }` for city-scoped OPS/MGR. `create` and `delete` return false at the Collection boundary.

`beforeChange` distinguishes trusted public stage writes from admin workflow writes using a server-owned context flag, never a body field. Reject changes to applicant facts outside their single allowed stage. Add masking hooks and admin default columns `city, applicantName, contactPhone, applicantIdentity, status, assignee, createdAt`.

- [ ] **Step 5: Register permissions, roles, navigation, and badge**

Add menu `city-partner-applications`; add read/manage operation codes. Grant ADM globally; grant OPS/MGR read/manage constrained by existing `cityScope`; do not grant BRK/CSR by default. Add “城市合伙人申请” under “商户合作” and a pending-count badge filtered through the same access boundary.

- [ ] **Step 6: Generate schema migration and add permission migration**

Run: `pnpm exec payload migrate:create --name city_partner_applications`, then rename generated files to the exact Task 1 names without editing the generated body. Add an idempotent permission migration that updates built-in role records by immutable role code and verifies no sixth built-in role is created.

Run: `pnpm exec payload generate:types`.

- [ ] **Step 7: Dry-run/apply locally and verify database invariants**

Run:

```bash
pnpm migrate:dry-run
pnpm exec payload migrate
pnpm migrate:status
pnpm migrate:verify
```

Expected: pending 0, migration verification failures 0. Query evidence: table exists; unique `idempotency_key`; city/status/created indexes exist; no application rows inserted by schema migration; role count unchanged; ADM/OPS/MGR permissions match the matrix.

- [ ] **Step 8: Run tests and commit Task 1**

Run: `pnpm exec vitest run tests/city-partner-domain.test.ts tests/city-partner-access.test.ts tests/city-partner-migration.test.ts tests/permission-codes.test.ts tests/permission-matrix.test.ts tests/admin-navigation-config.test.ts tests/admin-navigation-badges.test.ts`

Expected: PASS.

```bash
git add payload-office-platform/src/domain/city-partner-application payload-office-platform/src/collections/CityPartnerApplications.ts payload-office-platform/src/domain/auth/permission-codes.ts payload-office-platform/src/domain/auth/field-mask.ts payload-office-platform/src/domain/admin-navigation payload-office-platform/src/test/factory/roles.ts payload-office-platform/src/payload.config.ts payload-office-platform/src/migrations/20260813_020000_city_partner_applications.ts payload-office-platform/src/migrations/20260813_020000_city_partner_applications.json payload-office-platform/src/migrations/20260813_021000_city_partner_permissions.ts payload-office-platform/src/migrations/index.ts payload-office-platform/src/payload-types.ts payload-office-platform/tests/city-partner-domain.test.ts payload-office-platform/tests/city-partner-access.test.ts payload-office-platform/tests/city-partner-migration.test.ts payload-office-platform/tests/permission-codes.test.ts payload-office-platform/tests/permission-matrix.test.ts payload-office-platform/tests/admin-navigation-config.test.ts payload-office-platform/tests/admin-navigation-badges.test.ts
git commit -m "feat: add city partner application pool"
```

### Task 2: Hardened stage-one and stage-two public APIs

**Files:**
- Create: `payload-office-platform/src/domain/city-partner-application/idempotency.ts`
- Create: `payload-office-platform/src/domain/city-partner-application/public-service.ts`
- Create: `payload-office-platform/src/app/api/city-partner-applications/request-guards.ts`
- Create: `payload-office-platform/src/app/api/city-partner-applications/rate-limit-state.ts`
- Create: `payload-office-platform/src/app/api/city-partner-applications/route.ts`
- Create: `payload-office-platform/src/app/api/city-partner-applications/details/route.ts`
- Create: `payload-office-platform/tests/city-partner-api-guards.test.ts`
- Create: `payload-office-platform/tests/city-partner-api-route.test.ts`
- Create: `payload-office-platform/tests/city-partner-details-route.test.ts`

**Interfaces:**
- Produces stage-one request/response and stage-two completion contracts.

- [ ] **Step 1: Write failing request guard tests**

Stage one contract:

```ts
type CityPartnerCreateBody = Readonly<{
  requestId: string
  city: string
  applicantName: string
  contactPhone: string
  applicantIdentity: CityPartnerIdentity
  otherIdentity?: string
  consent: Readonly<{ accepted: true; policyVersion: string }>
  source: Readonly<{ path: '/city-partner' }>
}>
```

Stage two contract:

```ts
type CityPartnerDetailsBody = Readonly<{
  requestId: string
  contactPhone: string
  organizationName?: string
  resourceTypes?: readonly CityPartnerResourceType[]
  otherResource?: string
  experienceSummary?: string
  cooperationPlan?: string
}>
```

Assert strict Content-Type, same origin, valid request ID, canonical active city, phone/name lengths, enum closure, “other” dependency, consent version, text limits, and unknown-key rejection.

- [ ] **Step 2: Write failing idempotency and two-stage behavior tests**

```ts
expect(await postCreate(body)).toMatchObject({ status: 201, body: { ok: true, idempotent: false } })
expect(await postCreate(body)).toMatchObject({ status: 200, body: { ok: true, idempotent: true } })
expect(await postDetails(details)).toMatchObject({ status: 200, body: { ok: true } })
expect(await postDetails(changedDetailsAgain)).toMatchObject({ status: 409 })
```

Also assert explicit invalid city returns 422, rate limit returns 429, second-stage wrong requestId/phone returns 404, responses contain no internal ID/status/assignee, and logs contain no PII.

- [ ] **Step 3: Run API tests and verify RED**

Run: `pnpm exec vitest run tests/city-partner-api-guards.test.ts tests/city-partner-api-route.test.ts tests/city-partner-details-route.test.ts`

Expected: FAIL because routes do not exist.

- [ ] **Step 4: Implement stage-one service and route**

Resolve city through Plan 1's validated profile/canonical city path. Compute `sha256(requestId | phoneNormalized | cityId)`. Check existing record, then create with `overrideAccess:true` only after all guards and rate limiting pass; set a server-owned request context flag so the Collection hook permits stage one.

Return only `{ ok:true, idempotent:boolean }`. On unique race, re-read by idempotency key and return idempotent success.

- [ ] **Step 5: Implement stage-two one-time completion**

Find by `requestId + phoneNormalized` with `overrideAccess:true`; compute a canonical hash of normalized detail fields; require `detailsCompletedAt=null`; update optional detail fields, `detailsFingerprint`, and timestamp in one transaction/context. An exact retry whose hash equals the stored fingerprint returns idempotent success; different content returns 409 `details_already_completed`.

- [ ] **Step 6: Run API tests and commit Task 2**

Run: `pnpm exec vitest run tests/city-partner-api-guards.test.ts tests/city-partner-api-route.test.ts tests/city-partner-details-route.test.ts`

Expected: PASS.

```bash
git add payload-office-platform/src/domain/city-partner-application/idempotency.ts payload-office-platform/src/domain/city-partner-application/public-service.ts payload-office-platform/src/app/api/city-partner-applications payload-office-platform/tests/city-partner-api-guards.test.ts payload-office-platform/tests/city-partner-api-route.test.ts payload-office-platform/tests/city-partner-details-route.test.ts
git commit -m "feat: add city partner public application api"
```

### Task 3: Retryable city-scoped notifications

**Files:**
- Create: `payload-office-platform/src/domain/city-partner-application/application-notify.ts`
- Modify: `payload-office-platform/src/collections/CityPartnerApplications.ts`
- Modify: `payload-office-platform/src/domain/workflow/notification-types.ts`
- Modify: `payload-office-platform/src/payload.config.ts`
- Create: `payload-office-platform/src/migrations/20260813_022000_city_partner_notification_jobs.ts`
- Modify: `payload-office-platform/src/migrations/index.ts`
- Create: `payload-office-platform/tests/city-partner-notify.test.ts`

**Interfaces:**
- Produces retryable job `notify-city-partner-application-created`, notification source type `city-partner-application`.

- [ ] **Step 1: Write failing recipient/fallback/retry tests**

```ts
expect(await resolveRecipients(hangzhouApplication)).toEqual(hangzhouOpsIds)
expect(await resolveRecipients(cityWithoutOps)).toEqual(admIds)
await expect(deliverWithTransientFailure(job)).rejects.toThrow('city_partner_notification_delivery_failed')
expect(await loadApplication(applicationId)).toBeTruthy()
expect(jobState).toMatchObject({ hasError: true, retries: expect.any(Number) })
```

Assert notification title/body contain city and application ID only, never name/phone/company/free text.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm exec vitest run tests/city-partner-notify.test.ts`

Expected: FAIL because notification task is absent.

- [ ] **Step 3: Implement afterChange enqueue and job handler**

Enqueue only on initial create. Resolve active users whose roles include `city_partner_application:read` and whose trusted `cityScope` includes the application city. If none, resolve active ADM users. Create notifications idempotently using event/application/recipient composite identity. Let job retries handle delivery failure; never throw back into the already-committed public application response.

- [ ] **Step 4: Add explicit migration/config and run tests**

Register the job/task in Payload config and add migration metadata required by the project's job schema convention. Run: `pnpm exec vitest run tests/city-partner-notify.test.ts tests/supply-submission-notify.test.ts`.

Expected: PASS and no regression to supply notifications.

- [ ] **Step 5: Commit Task 3**

```bash
git add payload-office-platform/src/domain/city-partner-application/application-notify.ts payload-office-platform/src/collections/CityPartnerApplications.ts payload-office-platform/src/domain/workflow/notification-types.ts payload-office-platform/src/payload.config.ts payload-office-platform/src/migrations/20260813_022000_city_partner_notification_jobs.ts payload-office-platform/src/migrations/index.ts payload-office-platform/tests/city-partner-notify.test.ts
git commit -m "feat: notify city partner applications"
```

### Task 4: Global recruitment page, two-stage form, SEO, and analytics

**Files:**
- Create: `payload-office-platform/src/app/(frontend)/city-partner/page.tsx`
- Create: `payload-office-platform/src/components/frontend/city-partner/CityPartnerApplicationForm.tsx`
- Create: `payload-office-platform/src/lib/frontend/city-partner-config.ts`
- Modify: `payload-office-platform/src/app/(frontend)/styles.css`
- Modify: `payload-office-platform/src/lib/frontend/analytics/landing.ts`
- Create: `payload-office-platform/tests/city-partner-form.test.ts`
- Create: `payload-office-platform/tests/city-partner-page-seo.test.ts`
- Test: `payload-office-platform/tests/landing-analytics.test.ts`
- Create: `payload-office-platform/tests/e2e/city-partner-flow.spec.ts`

**Interfaces:**
- Consumes: validated public city list/resolver and Task 2 APIs.
- Produces: `/city-partner?city={citySlug}` with canonical `/city-partner` and two-stage accessible form.

- [ ] **Step 1: Write failing form coordinator tests**

```ts
expect(getStageOneErrors(validValues)).toEqual({})
expect(buildStageOneBody(values, requestId)).toMatchObject({ city: 'hangzhou', source: { path: '/city-partner' } })
expect(await coordinator.submitStageOne(values)).toMatchObject({ status: 'stage-two' })
expect(await coordinator.submitStageTwo(details)).toMatchObject({ status: 'complete' })
expect(requester).toHaveBeenCalledTimes(2)
```

Test invalid phone/name/identity/city, preserving values on network/rate-limit error, duplicate click coalescing, “other” conditional fields, stage-two skip, and no PII analytics payload.

- [ ] **Step 2: Write failing metadata/page tests**

Assert query city preselects the city, missing city selects default, explicit invalid city renders a visible validation error and disables submission, canonical is `/city-partner`, one H1 exists, and copy contains no guaranteed revenue/exclusivity/opening date claim.

- [ ] **Step 3: Run tests and verify RED**

Run: `pnpm exec vitest run tests/city-partner-form.test.ts tests/city-partner-page-seo.test.ts tests/landing-analytics.test.ts`

Expected: FAIL because page/form do not exist.

- [ ] **Step 4: Implement coordinator and accessible UI**

Follow `EntrustForm`'s coordinator pattern: stable request ID per mounted intent, pending Promise coalescing, stage-one success persisted before stage two, and values preserved after errors. Use existing `Button`, `Field`, `Input`, and `Select`; add checkbox/multiselect with explicit labels. Announce status via `role=status`, focus first invalid field, and keep all touch targets ≥44px.

- [ ] **Step 5: Implement metadata and anonymous events**

Emit only `city_partner_application_started/submitted/completed` with city slug and stage. `city_partner_cta_clicked` is wired in Plan 4 routing integration. Build metadata with canonical `/city-partner`; include the page once in sitemap from Plan 2.

- [ ] **Step 6: Run unit and E2E tests**

Run:

```bash
pnpm exec vitest run tests/city-partner-form.test.ts tests/city-partner-page-seo.test.ts tests/landing-analytics.test.ts
pnpm exec playwright test tests/e2e/city-partner-flow.spec.ts --project=chromium
```

Expected: stage one, stage two, retry, invalid city, skip, keyboard flow, canonical, and console assertions PASS.

- [ ] **Step 7: Commit Task 4 and record Gate C evidence**

```bash
git add payload-office-platform/src/app/\(frontend\)/city-partner/page.tsx payload-office-platform/src/components/frontend/city-partner/CityPartnerApplicationForm.tsx payload-office-platform/src/lib/frontend/city-partner-config.ts payload-office-platform/src/app/\(frontend\)/styles.css payload-office-platform/src/lib/frontend/analytics/landing.ts payload-office-platform/tests/city-partner-form.test.ts payload-office-platform/tests/city-partner-page-seo.test.ts payload-office-platform/tests/landing-analytics.test.ts payload-office-platform/tests/e2e/city-partner-flow.spec.ts
git commit -m "feat: add city partner recruitment flow"
```
