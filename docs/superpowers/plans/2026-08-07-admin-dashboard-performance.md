# Admin Dashboard Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Dashboard effective-supply N+1 and prevent statistics from blocking the authenticated admin shell.

**Architecture:** Extract shared batch relation resolution into the effective-supply domain module. Serve dashboard statistics from an authenticated endpoint and load them from a client widget with loading/error states.

**Tech Stack:** TypeScript 5.9, Payload CMS 3.86, Next.js 16 App Router, React 19, Vitest 4.

## Global Constraints

- Use pnpm 8.6.1 and Node 22.x as declared by the project.
- Preserve unified effective-supply semantics and server-side authorization.
- Do not add dependencies, migrations, caching, or type escapes.
- Do not commit, push, or create a PR without user confirmation.

---

### Task 1: Shared batch effective-supply resolution

**Files:**
- Modify: `payload-office-platform/src/domain/review/effective-supply-snapshot.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/supply-adapter.ts`
- Test: `payload-office-platform/tests/effective-supply-snapshot.test.ts`

**Interfaces:**
- Produces: `loadEffectiveRelations(payload, listings, asOf, req?)` and `resolveEffectiveSupplies(payload, listings, asOf, req?)`.
- Preserves: exact-one-active-relation fail-closed semantics.

- [ ] Add a failing test proving two listings use one relation query and overlapping relations fail closed.
- [ ] Run `pnpm test tests/effective-supply-snapshot.test.ts` and confirm the new exports are missing.
- [ ] Implement the batch loader with `listing in [...]`, active half-open period filters, `depth: 1`, and grouping by normalized listing ID.
- [ ] Replace the public catalog's private duplicate batch loader with the shared function.
- [ ] Re-run focused effective-supply and public-catalog adapter tests.

### Task 2: Dashboard statistics service and authenticated endpoint

**Files:**
- Create: `payload-office-platform/src/domain/analytics/dashboard-stats.ts`
- Create: `payload-office-platform/src/endpoints/dashboard-stats-endpoint.ts`
- Modify: `payload-office-platform/src/payload.config.ts`
- Create: `payload-office-platform/tests/dashboard-stats.test.ts`
- Create: `payload-office-platform/tests/dashboard-stats-endpoint.test.ts`

**Interfaces:**
- Produces: `DashboardStats`, `resolveDashboardStats(payload, req)`, and `createDashboardStatsEndpoint()`.
- Consumes: shared batch effective-supply resolution from Task 1.

- [ ] Add failing service tests proving correct counts and a single relation query.
- [ ] Add failing endpoint tests proving 401 for anonymous requests and JSON success for authenticated requests.
- [ ] Implement the service and endpoint with server-side request/access propagation.
- [ ] Register the endpoint in Payload config.
- [ ] Run focused service and endpoint tests.

### Task 3: Non-blocking Dashboard widget

**Files:**
- Modify: `payload-office-platform/src/components/admin/StatsWidget.tsx`
- Create: `payload-office-platform/src/components/admin/StatsWidgetClient.tsx`
- Modify: `payload-office-platform/src/components/admin/DashboardOverview.tsx`
- Modify: `payload-office-platform/src/app/(payload)/custom.scss`
- Create: `payload-office-platform/tests/dashboard-stats-widget-contract.test.ts`

**Interfaces:**
- Consumes: `GET /api/dashboard-stats` and `DashboardStats`.
- Produces: loading skeleton, rendered overview, localized error with retry.

- [ ] Add a failing contract test proving the server widget performs no database work and the client calls the endpoint.
- [ ] Reduce the server widget to a synchronous client-loader render.
- [ ] Implement strict response validation, abort timeout, retry, loading and error states.
- [ ] Add scoped Dashboard styles for loading/error states.
- [ ] Run focused widget contract tests and typecheck.

### Task 4: Verification and evidence

**Files:**
- Create: `artifacts/verification/OPT-022/README.md`
- Modify: `specs/work-items/OPT-022-admin-dashboard-performance.md`

- [ ] Run focused tests, then `pnpm test`, `pnpm typecheck`, and `pnpm build`.
- [ ] Verify `/admin`, `/api/dashboard-stats`, loading/success/error behavior, and browser console.
- [ ] Measure authenticated `/admin` shell and statistics timings against the recorded 23.5s baseline.
- [ ] Record commands, outputs, remaining Node-version risk, and any unverified path in the evidence file.
- [ ] Update the Task Packet only for checks supported by evidence.
