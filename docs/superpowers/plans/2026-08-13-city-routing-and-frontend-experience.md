# City Routing and Frontend Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch reversible city-prefixed frontend routes, a city switcher, live/coming-soon experiences, and correct city attribution for existing Entrust and Publish flows.

**Architecture:** Shared server view modules render both legacy and prefixed paths during the observation window. A server-only runtime flag controls canonical ownership and page-level 307 redirects; route boundaries resolve `CityContext` before calling city-scoped catalog services. The global header receives a cached public city option list and builds deterministic switch links without querying Payload from client components.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, Public Catalog DTOs, existing frontend design system, Vitest, Playwright, webpack build, pnpm on Node.js 22.

## Global Constraints

- Plans 1, 2, and 3 must have passed Gates A–C.
- Read `AGENTS.md`, `.agent/core.md`, `.agent/frontend.md`, `.agent/supply.md`, `.agent/permissions.md`, and `.agent/testing.md`.
- Observation redirects use page-level `redirect()` (307), never `permanentRedirect()` or middleware.
- `MULTI_CITY_ROUTING_ENABLED` is server-only and evaluated at request time.
- With the flag off, old paths remain canonical; city-prefixed paths remain accessible for internal verification but are `noindex`.
- Coming-soon list/building paths return 200 with a coming-soon page variant and `noindex,follow`.
- Unknown/malformed/profile-less cities return 404 and never default to Shanghai.

---

### Task 1: Pure city URL and filter-switching contract

**Files:**
- Create: `payload-office-platform/src/lib/frontend/city-routes.ts`
- Create: `payload-office-platform/tests/city-routes.test.ts`

**Interfaces:**
- Produces: `getCityPageType`, `buildCityPath`, `switchCityUrl`, `legacyCanonicalPath`, `prefixedCanonicalPath`.

- [x] **Step 1: Write failing URL matrix tests**

```ts
expect(buildCityPath('hangzhou', 'home')).toBe('/hangzhou')
expect(buildCityPath('hangzhou', 'listings')).toBe('/hangzhou/listings')
expect(switchCityUrl('/shanghai/listings?areaMin=100&district=pudong&page=3', 'hangzhou'))
  .toBe('/hangzhou/listings?areaMin=100')
expect(switchCityUrl('/shanghai/buildings?district=pudong&grade=A&page=2', 'hangzhou'))
  .toBe('/hangzhou/buildings?grade=A')
expect(switchCityUrl('/shanghai/listings/foo', 'hangzhou')).toBe('/hangzhou/listings')
expect(switchCityUrl('/entrust?city=shanghai', 'hangzhou')).toBe('/entrust?city=hangzhou')
```

Cover home, listing/building list/detail, news/privacy/global pages, Entrust, Publish, City Partner, malformed query values, stable query ordering, and page reset.

- [x] **Step 2: Run test and verify RED**

Run: `pnpm exec vitest run tests/city-routes.test.ts`

Expected: FAIL because helper does not exist.

- [x] **Step 3: Implement allow-list URL transformation**

For listing pages preserve only `q, areaMin, areaMax, rentMin, rentMax, rentUnit, pricePeriod, priceBasis, listingType, availableBefore, sort`; clear `district, businessArea, metro, page`. For building pages preserve only `grade`; clear `district,page`. For detail paths target the destination city list. For global pages target destination city home except Entrust/Publish/City Partner, which replace only `city`.

Never copy unknown query keys or raw source URL fragments.

- [x] **Step 4: Run test and commit Task 1**

Run: `pnpm exec vitest run tests/city-routes.test.ts`

Expected: PASS.

```bash
git add payload-office-platform/src/lib/frontend/city-routes.ts payload-office-platform/tests/city-routes.test.ts
git commit -m "feat: define city frontend url rules"
```

### Task 2: Header city switcher and city-aware global shell

**Files:**
- Create: `payload-office-platform/src/components/frontend/CitySwitcher.tsx`
- Modify: `payload-office-platform/src/components/frontend/SiteHeader.tsx`
- Modify: `payload-office-platform/src/components/frontend/SiteFooter.tsx`
- Modify: `payload-office-platform/src/components/frontend/SiteNav.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/layout.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/styles.css`
- Create: `payload-office-platform/tests/city-switcher.test.ts`
- Modify: `payload-office-platform/tests/detail-components-contract.test.ts`

**Interfaces:**
- Consumes: public city switcher options from Plan 1 and `switchCityUrl` from Task 1.
- Produces: accessible `CitySwitcher` and city-aware header/logo/navigation links.

- [x] **Step 1: Write failing switcher rendering and keyboard tests**

```ts
expect(rendered).toContain('上海')
expect(rendered).toContain('正在开通')
expect(linkFor('杭州')).toBe('/hangzhou/listings?areaMin=100')
expect(logoHref('/hangzhou/buildings')).toBe('/hangzhou')
expect(logoHref('/news')).toBe('/shanghai')
```

Assert `switcherVisible=false` profiles are absent, status is textual not color-only, current city has `aria-current`, Esc closes and returns focus, first/last focus stays within an open mobile drawer, and touch controls have the existing ≥44px class/token.

- [x] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run tests/city-switcher.test.ts tests/detail-components-contract.test.ts`

Expected: FAIL because switcher/props are absent.

- [x] **Step 3: Fetch cached public city options in the server layout**

Add a compact DTO:

```ts
type PublicCityOption = Readonly<{
  slug: string
  name: string
  serviceStatus: 'live' | 'coming-soon'
  sortOrder: number
}>
```

Pass options and `defaultCity` into SiteHeader/Footer. The client derives current city only by matching the first path segment against these trusted options; it does not call Payload or accept arbitrary segments.

- [x] **Step 4: Implement accessible desktop popover and mobile drawer**

Use real Next Links generated by Task 1. Preserve existing header transparent/solid behavior for both `/` (flag off) and `/{city}` home. Keep news/privacy global and make logo/nav/listing/building links city-aware.

- [x] **Step 5: Run tests and commit Task 2**

Run: `pnpm exec vitest run tests/city-switcher.test.ts tests/detail-components-contract.test.ts tests/admin-navigation-context-links.test.ts`

Expected: PASS.

```bash
git add payload-office-platform/src/components/frontend/CitySwitcher.tsx payload-office-platform/src/components/frontend/SiteHeader.tsx payload-office-platform/src/components/frontend/SiteFooter.tsx payload-office-platform/src/components/frontend/SiteNav.tsx payload-office-platform/src/app/\(frontend\)/layout.tsx payload-office-platform/src/app/\(frontend\)/styles.css payload-office-platform/tests/city-switcher.test.ts payload-office-platform/tests/detail-components-contract.test.ts
git commit -m "feat: add frontend city switcher"
```

### Task 3: Shared live/coming-soon views and prefixed routes

**Files:**
- Create: `payload-office-platform/src/components/frontend/city/CityHomeView.tsx`
- Create: `payload-office-platform/src/components/frontend/city/ComingSoonCityView.tsx`
- Create: `payload-office-platform/src/components/frontend/city/CityListingsView.tsx`
- Create: `payload-office-platform/src/components/frontend/city/CityBuildingsView.tsx`
- Create: `payload-office-platform/src/app/(frontend)/[city]/page.tsx`
- Create: `payload-office-platform/src/app/(frontend)/[city]/listings/page.tsx`
- Create: `payload-office-platform/src/app/(frontend)/[city]/listings/[slug]/page.tsx`
- Create: `payload-office-platform/src/app/(frontend)/[city]/buildings/page.tsx`
- Create: `payload-office-platform/src/app/(frontend)/[city]/buildings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/listings/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/listings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/buildings/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/components/frontend/HeroSearch.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/styles.css`
- Create: `payload-office-platform/tests/city-route-pages.test.ts`
- Modify: `payload-office-platform/tests/detail-pages-seo.test.ts`
- Modify: `payload-office-platform/tests/landing-hero-layout.test.ts`

**Interfaces:**
- Consumes: `resolveCityContext`, city-scoped cached queries, route-identity resolvers, runtime flag.
- Produces: all approved canonical/legacy page behaviors and reusable DTO-only views.

- [ ] **Step 1: Write failing server route matrix tests**

```ts
expect(await request('/unknown')).toHaveStatus(404)
expect(await request('/hangzhou')).toHaveStatus(200)
expect(await request('/hangzhou/listings')).toMatchResponse({ status: 200, robots: 'noindex, follow' })
expect(await request('/shanghai/listings')).toHaveStatus(200)
expect(await request('/hangzhou/listings/shanghai-slug')).toRedirect(307, '/shanghai/listings/shanghai-slug')
expect(await request('/listings/shanghai-slug')).toRedirect(307, '/shanghai/listings/shanghai-slug')
```

Run the static/global route collision matrix for `news,pages,entrust,publish,city-partner`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/city-route-pages.test.ts tests/detail-pages-seo.test.ts tests/landing-hero-layout.test.ts`

Expected: FAIL because prefixed pages are absent.

- [ ] **Step 3: Extract DTO-only shared views**

Move presentation from existing root/list/building pages into views whose props contain `CityContext` plus Public Catalog DTOs. Views generate all links with city prefixes. `HeroSearch` submits to `/${city}/listings` and never drops city.

`ComingSoonCityView` renders city name/status, optional Hero/intro, visible `featuredRegions`, and four CTAs: Entrust, Publish, City Partner, and existing “获取选址方案”. It omits inventory counts and empty geographic filters.

- [ ] **Step 4: Implement prefixed route boundaries**

Each page awaits params, calls `resolveCityContext`, and `notFound()` on null. Live pages call city-scoped data functions. Coming-soon home/list/building pages all return the appropriate view with `noindex,follow`; list/building paths keep their URL and status 200.

`[city]/page.tsx` exports `generateStaticParams()` from all valid profiles, `dynamicParams=true`, and `revalidate=300` for ISR. If profile enumeration is unavailable during build, catch the infrastructure error, log only `city_static_params_unavailable`, and return `[]`; runtime resolution remains fail-closed and avoids making database reachability a build prerequisite. City listing/building pages stay `force-dynamic` and never enumerate filter combinations. Detail pages retain the existing rendering strategy.

Detail routes compare DTO `citySlug` with route city. Mismatch uses `redirect(actualPath)` (307). Missing/ineffective detail returns 404 without revealing other fields.

- [ ] **Step 5: Implement reversible legacy pages**

With `MULTI_CITY_ROUTING_ENABLED=true`, `/`, `/listings`, and `/buildings` use page-level `redirect()` to default-city prefixed paths. Legacy detail routes use route-identity services and 307. With flag false, legacy pages render default-city shared views and own canonical; prefixed routes remain 200 but metadata is `noindex`.

- [ ] **Step 6: Run route tests and commit Task 3**

Run: `pnpm exec vitest run tests/city-route-pages.test.ts tests/detail-pages-seo.test.ts tests/landing-hero-layout.test.ts tests/public-catalog-city-parity.test.ts`

Expected: PASS.

```bash
git add payload-office-platform/src/components/frontend/city payload-office-platform/src/app/\(frontend\)/\[city\] payload-office-platform/src/app/\(frontend\)/page.tsx payload-office-platform/src/app/\(frontend\)/listings payload-office-platform/src/app/\(frontend\)/buildings payload-office-platform/src/components/frontend/HeroSearch.tsx payload-office-platform/src/app/\(frontend\)/styles.css payload-office-platform/tests/city-route-pages.test.ts payload-office-platform/tests/detail-pages-seo.test.ts payload-office-platform/tests/landing-hero-layout.test.ts
git commit -m "feat: add reversible city frontend routes"
```

### Task 4: City attribution for Entrust and Publish

**Files:**
- Modify: `payload-office-platform/src/app/(frontend)/entrust/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/publish/page.tsx`
- Modify: `payload-office-platform/src/components/frontend/landing/EntrustForm.tsx`
- Modify: `payload-office-platform/src/components/frontend/landing/SupplySubmissionForm.tsx`
- Modify: `payload-office-platform/src/domain/inquiry/schema.ts`
- Modify: `payload-office-platform/src/domain/supply-submission/schema.ts`
- Modify: `payload-office-platform/src/app/api/inquiries/route.ts`
- Modify: `payload-office-platform/src/app/api/inquiries/demand/route.ts`
- Modify: `payload-office-platform/src/app/api/supply-submissions/request-guards.ts`
- Modify: `payload-office-platform/src/app/api/supply-submissions/route.ts`
- Modify: `payload-office-platform/tests/inquiry-domain.test.ts`
- Modify: `payload-office-platform/tests/inquiry-api-route.test.ts`
- Modify: `payload-office-platform/tests/inquiry-demand-update.test.ts`
- Modify: `payload-office-platform/tests/supply-submission-domain.test.ts`
- Modify: `payload-office-platform/tests/supply-submission-api-route.test.ts`
- Modify: `payload-office-platform/tests/e2e/landing-pages.spec.ts`

**Interfaces:**
- Consumes: validated city resolver.
- Produces: required city slug in both public request bodies and server-persisted city relationship.

- [ ] **Step 1: Write failing request/body and persistence tests**

```ts
expect(buildEntrustInquiryBody(phone, requestId, 'hangzhou')).toMatchObject({ city: 'hangzhou' })
expect(buildSupplySubmissionBody(values, requestId, 'hangzhou')).toMatchObject({ city: 'hangzhou' })
expect(createdLead.city).toBe(hangzhouId)
expect(createdSupplySubmission.city).toBe(hangzhouId)
expect(await submitWithCity('tampered')).toMatchObject({ status: 422 })
```

Assert missing query uses default Shanghai, explicit invalid query renders visible error and disables submit, stage-two Entrust cannot change first-stage city, and source URL stores pathname without query PII.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/inquiry-domain.test.ts tests/inquiry-api-route.test.ts tests/inquiry-demand-update.test.ts tests/supply-submission-domain.test.ts tests/supply-submission-api-route.test.ts`

Expected: FAIL because request bodies and APIs ignore selected city.

- [ ] **Step 3: Add city to client contracts and page props**

Resolve query city on the Server Component page. Pass `{ citySlug, cityName, cityId }` into forms. Display a city selector/locked summary and keep URL synchronized. Include `city` in both stage-one request bodies; stage-two Entrust body omits city and the server preserves original relationship.

- [ ] **Step 4: Resolve city again at the API boundary**

Treat body city as unknown. Resolve canonical active profile/city server-side; store relationship ID. Missing body is rejected because pages always send explicit city; backward-compatible direct API behavior may default only when the field is truly absent and source path is the approved legacy path. Explicit invalid values always return 422.

- [ ] **Step 5: Run tests and commit Task 4**

Run: `pnpm exec vitest run tests/inquiry-domain.test.ts tests/inquiry-api-route.test.ts tests/inquiry-demand-update.test.ts tests/supply-submission-domain.test.ts tests/supply-submission-api-route.test.ts tests/supply-submission-form.test.ts`

Expected: PASS.

```bash
git add payload-office-platform/src/app/\(frontend\)/entrust/page.tsx payload-office-platform/src/app/\(frontend\)/publish/page.tsx payload-office-platform/src/components/frontend/landing/EntrustForm.tsx payload-office-platform/src/components/frontend/landing/SupplySubmissionForm.tsx payload-office-platform/src/domain/inquiry/schema.ts payload-office-platform/src/domain/supply-submission/schema.ts payload-office-platform/src/app/api/inquiries payload-office-platform/src/app/api/supply-submissions payload-office-platform/tests/inquiry-domain.test.ts payload-office-platform/tests/inquiry-api-route.test.ts payload-office-platform/tests/inquiry-demand-update.test.ts payload-office-platform/tests/supply-submission-domain.test.ts payload-office-platform/tests/supply-submission-api-route.test.ts payload-office-platform/tests/e2e/landing-pages.spec.ts
git commit -m "feat: persist city on demand and supply submissions"
```

### Task 5: Metadata, sitemap, analytics, and routing observation controls

**Files:**
- Modify: `payload-office-platform/src/lib/frontend/metadata.ts`
- Modify: `payload-office-platform/src/app/(frontend)/sitemap.ts`
- Modify: `payload-office-platform/src/lib/frontend/analytics/index.ts`
- Modify: `payload-office-platform/src/lib/frontend/analytics/landing.ts`
- Modify: `payload-office-platform/src/components/frontend/city/ComingSoonCityView.tsx`
- Modify: `payload-office-platform/tests/sitemap-static-routes.test.ts`
- Modify: `payload-office-platform/tests/landing-analytics.test.ts`
- Create: `payload-office-platform/tests/city-metadata.test.ts`

**Interfaces:**
- Produces deterministic metadata/robots/canonical per flag and profile status; anonymous city events.

- [ ] **Step 1: Write failing metadata/analytics tests**

```ts
expect(metadataFor(liveShanghai)).toMatchObject({ alternates: { canonical: '/shanghai' } })
expect(metadataFor(comingHangzhou).robots).toMatchObject({ index: false, follow: true })
expect(metadataWithFlagOff(prefixedShanghai).robots).toMatchObject({ index: false })
expect(cityPartnerCanonical('?city=hangzhou')).toBe('/city-partner')
expect(eventPayload('city_partner_cta_clicked')).toEqual({ city: 'hangzhou', status: 'coming-soon' })
```

Assert unique titles/descriptions include canonical city name, live-only sitemap paths, one `/city-partner`, and no raw query or PII in events.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run tests/city-metadata.test.ts tests/sitemap-static-routes.test.ts tests/landing-analytics.test.ts`

Expected: FAIL on old root canonical and missing city events.

- [ ] **Step 3: Implement metadata and events from trusted DTOs**

Generate page metadata from City Profile/Public DTO only. The flag decides legacy versus prefixed canonical during observation. Coming-soon always noindex/follow and is excluded from sitemap. Add `city_switcher_opened`, `city_switched`, `coming_soon_cta_clicked`, `city_page_view`, `city_lead_submitted`, and partner CTA event using enum payloads only.

- [ ] **Step 4: Capture build baseline and commit Task 5**

Run webpack build under Node 22 and record elapsed time:

```bash
pnpm exec next build --webpack
```

Compare with the pre-Plan-4 baseline; >50% increase is a reported optimization blocker, not silently accepted.

Run: `pnpm exec vitest run tests/city-metadata.test.ts tests/sitemap-static-routes.test.ts tests/landing-analytics.test.ts`.

```bash
git add payload-office-platform/src/lib/frontend/metadata.ts payload-office-platform/src/app/\(frontend\)/sitemap.ts payload-office-platform/src/lib/frontend/analytics/index.ts payload-office-platform/src/lib/frontend/analytics/landing.ts payload-office-platform/src/components/frontend/city/ComingSoonCityView.tsx payload-office-platform/tests/sitemap-static-routes.test.ts payload-office-platform/tests/landing-analytics.test.ts payload-office-platform/tests/city-metadata.test.ts
git commit -m "feat: add city seo and observation controls"
```

### Task 6: Full automated and real-browser release candidate verification

**Files:**
- Create: `payload-office-platform/tests/e2e/multi-city-routing.spec.ts`
- Create: `payload-office-platform/tests/e2e/multi-city-isolation.spec.ts`
- Create: `payload-office-platform/tests/e2e/multi-city-forms.spec.ts`
- Modify: `payload-office-platform/tests/e2e/landing-pages.spec.ts`
- Modify: `payload-office-platform/tests/e2e/detail-pages.spec.ts`
- Evidence only: `payload-office-platform/test-results/multi-city/MCF-04/`

**Interfaces:**
- Consumes the completed application.
- Produces Gates D and E evidence; no new business behavior.

- [ ] **Step 1: Write the complete E2E matrices**

Automate direct status and page assertions such as:

```ts
test('coming-soon list is 200 noindex and has no Shanghai cards', async ({ page }) => {
  const response = await page.goto('/hangzhou/listings')
  expect(response?.status()).toBe(200)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.getByRole('heading', { name: /杭州.*正在开通/ })).toBeVisible()
  await expect(page.locator('[data-listing-city="shanghai"]')).toHaveCount(0)
})

test('city switch preserves universal filters and clears geography', async ({ page }) => {
  await page.goto('/shanghai/listings?areaMin=100&rentMax=10&district=pudong&page=3')
  await page.getByRole('button', { name: /当前城市.*上海/ }).click()
  await page.getByRole('link', { name: /杭州.*正在开通/ }).click()
  await expect(page).toHaveURL('/hangzhou/listings?areaMin=100&rentMax=10')
})
```

Add equally explicit tests for: flag-off legacy canonical plus prefixed noindex; flag-on `/`, `/listings`, `/buildings` response status 307 and exact `Location`; wrong-city and legacy detail status 307 with exact DTO-derived destination; all three public application database city relationships; partner no-auto-conversion counts; and zero page/console errors.

Cover all seven city homes, unknown/profile-less city, five global reserved routes, old list/building paths, old and wrong-city details, query canonical, and browser console errors.

- [ ] **Step 2: Run generated/static/full unit verification**

Run under Node 22:

```bash
pnpm exec payload generate:types
pnpm exec payload generate:importmap
pnpm exec tsc --noEmit --pretty false
pnpm test
pnpm exec next build --webpack
pnpm migrate:status
pnpm migrate:verify
```

Expected: generated files contain only intentional changes; typecheck, all Vitest files, build, migration status, and migration verification pass with zero failures.

- [ ] **Step 3: Run Playwright E2E with the routing flag both ways**

Start the correct Node 22 webpack dev server on an unused verification port. Run the new specs plus landing/detail regressions once with `MULTI_CITY_ROUTING_ENABLED=false` and once with `true`.

Expected: all route/status/canonical/isolation/form/console assertions PASS.

- [ ] **Step 4: Perform four-viewport visual review**

At 375×812, 768×1024, 1440×900, and 1920×1080 verify:

- Shanghai live home/list and switcher.
- Hangzhou coming-soon home/list, four CTAs, no false counts/filters.
- City Partner stage one, stage two, validation, retry, and completion.
- Entrust stage one and Publish entry with visible city.
- News or privacy adjacent global route.
- Keyboard open/close/Esc/focus return, reduced motion, long city text, image failure, and zero new console errors.

Save screenshots/logs to the evidence directory, not git.

- [ ] **Step 5: Verify process identity and requested URLs**

Record listener PID, command line, Node version, working directory/worktree, and HTTP status/Location/canonical/robots for `/`, `/shanghai`, `/hangzhou`, `/hangzhou/listings`, `/city-partner?city=hangzhou`, `/entrust?city=hangzhou`, `/publish?city=hangzhou`, `/news`, and `/admin`.

- [ ] **Step 6: Review generated diffs and commit E2E task**

Restore unrelated `next-env.d.ts` or generated churn; keep intentional `payload-types.ts`/import map changes only. Run `git diff --check` and confirm no secrets/media/test data are staged.

```bash
git add payload-office-platform/tests/e2e/multi-city-routing.spec.ts payload-office-platform/tests/e2e/multi-city-isolation.spec.ts payload-office-platform/tests/e2e/multi-city-forms.spec.ts payload-office-platform/tests/e2e/landing-pages.spec.ts payload-office-platform/tests/e2e/detail-pages.spec.ts
git commit -m "test: verify multi city frontend journeys"
```

- [ ] **Step 7: Record Gates D/E and stop before production actions**

Write exact pass counts, migration counts, build time delta, browser matrix, PID/worktree/URL proof, risks, and unverified items into this plan. Do not apply production migrations, deploy, push, change live profile status, promote 307 to 308, or remove the kill switch without a new user approval.
