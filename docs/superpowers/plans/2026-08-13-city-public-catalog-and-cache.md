# City-Scoped Public Catalog and Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make city a mandatory, end-to-end dimension of every Public Catalog query, DTO, cache key, cache tag, recommendation, facet, and sitemap source.

**Architecture:** `SearchContext.city` becomes required and the Shanghai default constructor is removed. Public DTO mappers expose canonical city identity, while memoized per-city `unstable_cache` factories guarantee the same slug appears in key parts and tags.

**Tech Stack:** TypeScript, Payload Local API adapters, Next.js `unstable_cache`, Vitest, pnpm on Node.js 22.

## Global Constraints

- Plan 1 Gate A must pass before this plan starts.
- Read `payload-office-platform/AGENTS.md`, `.agent/core.md`, `.agent/frontend.md`, `.agent/supply.md`, and `.agent/testing.md`.
- No Public Catalog API may accept an optional city after Task 1.
- Never duplicate or weaken the effective-supply predicate.
- Do not migrate to Cache Components; retain `unstable_cache` and implement memoized per-city factories.
- `public:sitemap` remains a single global tag by design.

---

### Task 1: Required city in SearchContext and every query consumer

**Files:**
- Modify: `payload-office-platform/src/domain/public-catalog/types.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/supply-adapter.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/index.ts`
- Modify: `payload-office-platform/src/app/api/inquiries/route.ts`
- Modify: `payload-office-platform/src/app/(frontend)/listings/actions.ts`
- Modify: `payload-office-platform/src/app/(frontend)/pages/[slug]/page.tsx`
- Modify: `payload-office-platform/src/app/(frontend)/buildings/[slug]/page.tsx`
- Modify: `payload-office-platform/src/test/factory/listings.ts`
- Create: `payload-office-platform/tests/public-catalog-city-context.test.ts`
- Modify: `payload-office-platform/tests/public-catalog-effective-supply-consistency.test.ts`

**Interfaces:**
- Consumes: `CityContext['slug']` from Plan 1.
- Produces: `createSearchContext(citySlug, now?)`; required `SearchContext.city: string`.

- [x] **Step 1: Write failing fail-open regression tests**

```ts
expectTypeOf<SearchContext>().toMatchTypeOf<{ city: string }>()
expect(() => createSearchContext('', now)).toThrow('search_context_city_required')
const hangzhouResult = await searchListings(input, context('hangzhou'), adapter)
expect(hangzhouResult.docs.every((doc) => doc.citySlug === 'hangzhou')).toBe(true)
expect(adapter.lastWhere).toContainEqual({ 'building.city.slug': { equals: 'hangzhou' } })
```

Add a cross-city fixture containing one Shanghai and one Hangzhou effective listing and assert Hangzhou returns only Hangzhou for list, detail, recommendations, homepage, facets, and inquiry target validation.

- [x] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/public-catalog-city-context.test.ts tests/public-catalog-effective-supply-consistency.test.ts`

Expected: FAIL because city is optional and `defaultSearchContext()` exists.

- [x] **Step 3: Replace the default context constructor**

```ts
export type SearchContext = Readonly<{
  asOf: string
  timezone: 'Asia/Shanghai'
  channel: 'public-web'
  city: string
}>

export function createSearchContext(city: string, now: Date = new Date()): SearchContext {
  const normalized = city.trim().toLowerCase()
  if (!normalized) throw new Error('search_context_city_required')
  return { asOf: now.toISOString(), timezone: 'Asia/Shanghai', channel: 'public-web', city: normalized }
}
```

Delete `defaultSearchContext`. Replace every import/call with an explicit city. During this intermediate plan, legacy pages pass `siteConfig.defaultCity`; Plan 4 replaces route boundaries with resolved `CityContext.slug`.

- [x] **Step 4: Remove conditional city filtering**

Replace `if (ctx.city)` branches in the Supply Adapter with unconditional city predicates. Ensure buildings, listing relationships, facets, homepage regions, recommendations, and counts all use the same context.

- [x] **Step 5: Run focused tests and compile**

Run:

```bash
pnpm exec vitest run tests/public-catalog-city-context.test.ts tests/public-catalog-effective-supply-consistency.test.ts tests/inquiry-api-route.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS; `rg "defaultSearchContext|city\?: string" src/domain/public-catalog src/lib/frontend src/app` returns no city-context regressions.

- [x] **Step 6: Commit Task 1**

```bash
git add payload-office-platform/src/domain/public-catalog/types.ts payload-office-platform/src/domain/public-catalog/supply-adapter.ts payload-office-platform/src/domain/public-catalog/index.ts payload-office-platform/src/app/api/inquiries/route.ts payload-office-platform/src/app/\(frontend\)/listings/actions.ts payload-office-platform/src/app/\(frontend\)/pages/\[slug\]/page.tsx payload-office-platform/src/app/\(frontend\)/buildings/\[slug\]/page.tsx payload-office-platform/src/test/factory/listings.ts payload-office-platform/tests/public-catalog-city-context.test.ts payload-office-platform/tests/public-catalog-effective-supply-consistency.test.ts
git commit -m "refactor: require city in public catalog context"
```

### Task 2: Canonical city fields in Public Catalog DTOs

**Files:**
- Modify: `payload-office-platform/src/domain/public-catalog/contracts.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/mappers.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/supply-adapter.ts`
- Modify: `payload-office-platform/src/test/frontend/payload-documents.ts`
- Test: `payload-office-platform/tests/frontend-mappers.test.ts`
- Test: `payload-office-platform/tests/detail-pages-seo.test.ts`
- Test: `payload-office-platform/tests/detail-recommendations.test.ts`

**Interfaces:**
- Produces required `citySlug: string` and `cityName: string` on `ListingCardViewModel`, `ListingDetailViewModel`, `BuildingSummaryViewModel`, and `BuildingDetailViewModel`.
- Produces route-only `resolveListingRouteIdentity(slug)` and `resolveBuildingRouteIdentity(slug)` returning `{ slug, citySlug } | null` after the same public/effective checks; legacy redirect pages consume these without rendering raw data.

- [ ] **Step 1: Write failing mapper tests**

```ts
expect(mapListingCard(shanghaiListing)).toMatchObject({ citySlug: 'shanghai', cityName: '上海市' })
expect(mapBuildingDetail(hangzhouBuilding)).toMatchObject({ citySlug: 'hangzhou', cityName: '杭州市' })
expect(mapBuildingDetail(buildingWithoutCity)).toBeNull()
expect(await resolveListingRouteIdentity('hidden-listing')).toBeNull()
expect(await resolveListingRouteIdentity('visible-listing')).toEqual({ slug: 'visible-listing', citySlug: 'shanghai' })
```

Assert recommendation DTOs preserve city and JSON-LD uses `cityName` from the DTO rather than a hard-coded label.

- [ ] **Step 2: Run mapper tests and verify RED**

Run: `pnpm exec vitest run tests/frontend-mappers.test.ts tests/detail-pages-seo.test.ts tests/detail-recommendations.test.ts`

Expected: FAIL because DTO fields are absent.

- [ ] **Step 3: Add required DTO fields and strict mapper helper**

```ts
export type PublicCityIdentity = Readonly<{ citySlug: string; cityName: string }>

export function mapBuildingCity(building: PopulatedBuilding): PublicCityIdentity | null {
  const city = building.city
  if (!isLocation(city) || typeof city.slug !== 'string' || typeof city.name !== 'string') return null
  return { citySlug: city.slug, cityName: city.name }
}
```

Spread this identity into all four DTOs. If identity is null, the mapper returns null so the public page resolves 404. Do not return empty strings or perform a second page-level Payload query.

Add route-identity services that reuse the existing Public Catalog/effective-supply service and select only slug plus canonical city. They are the sole cityless lookup exception and exist only for legacy/correction redirects; they must not return title, inventory, price, or other display data.

- [ ] **Step 4: Ensure adapter population depth includes city**

Adjust select/populate/depth settings so `building.city.slug/name` are available in one catalog query. Add an adapter assertion that no N+1 city lookup occurs.

- [ ] **Step 5: Run tests and commit Task 2**

Run: `pnpm exec vitest run tests/frontend-mappers.test.ts tests/detail-pages-seo.test.ts tests/detail-recommendations.test.ts tests/public-catalog-city-context.test.ts`

Expected: PASS.

```bash
git add payload-office-platform/src/domain/public-catalog/contracts.ts payload-office-platform/src/domain/public-catalog/mappers.ts payload-office-platform/src/domain/public-catalog/supply-adapter.ts payload-office-platform/src/test/frontend/payload-documents.ts payload-office-platform/tests/frontend-mappers.test.ts payload-office-platform/tests/detail-pages-seo.test.ts payload-office-platform/tests/detail-recommendations.test.ts
git commit -m "feat: expose canonical city in public dto"
```

### Task 3: Per-city cached query factories

**Files:**
- Modify: `payload-office-platform/src/lib/frontend/cached-queries.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/cache-tags.ts`
- Modify: `payload-office-platform/src/domain/public-catalog/cache-invalidator.ts`
- Modify: `payload-office-platform/src/lib/frontend/public-cache-revalidation.ts`
- Test: `payload-office-platform/tests/cache-next-adapter-integration.test.ts`
- Test: `payload-office-platform/tests/home-sitemap-cache-performance.test.ts`
- Test: `payload-office-platform/tests/public-catalog-cache-invalidator.test.ts`
- Create: `payload-office-platform/tests/public-catalog-city-cache.test.ts`

**Interfaces:**
- Produces cached functions whose first argument is `citySlug`: `getCachedHomepage(citySlug)`, `getCachedSearchListings(citySlug, canonical, input)`, `getCachedListingBySlug(citySlug, slug)`, `getCachedSearchBuildings(citySlug)`, and all related/facet variants.

- [ ] **Step 1: Write failing key/tag isolation tests**

```ts
await getCachedHomepage('shanghai')
await getCachedHomepage('hangzhou')
expect(createdCaches).toEqual(expect.arrayContaining([
  expect.objectContaining({ keyParts: ['homepage', 'shanghai'], tags: expect.arrayContaining(['public:home:shanghai']) }),
  expect.objectContaining({ keyParts: ['homepage', 'hangzhou'], tags: expect.arrayContaining(['public:home:hangzhou']) }),
]))
expect(shanghaiResult.featuredListings).not.toEqual(hangzhouResult.featuredListings)
```

Add a warm-cache regression: call Shanghai, then Hangzhou, then Shanghai again; assert adapters receive correct city and results never cross.

- [ ] **Step 2: Run cache tests and verify RED**

Run: `pnpm exec vitest run tests/public-catalog-city-cache.test.ts tests/cache-next-adapter-integration.test.ts tests/public-catalog-cache-invalidator.test.ts`

Expected: FAIL because current wrappers and tags are Shanghai singletons.

- [ ] **Step 3: Implement a typed memoized factory**

```ts
function memoizeByCity<T>(create: (citySlug: string) => T): (citySlug: string) => T {
  const cache = new Map<string, T>()
  return (citySlug) => {
    const existing = cache.get(citySlug)
    if (existing) return existing
    const created = create(citySlug)
    cache.set(citySlug, created)
    return created
  }
}
```

For every resource, construct `unstable_cache` with both key parts and tags containing city. Export simple typed wrappers; do not expose the Map or raw cached function.

- [ ] **Step 4: Make event invalidation derive actual city**

Update listing/building/profile/Location invalidators to use DTO/document city. If city resolution fails, invalidate category-level tags plus `public:sitemap`; never guess Shanghai.

- [ ] **Step 5: Prove no hard-coded city tags remain**

Run:

```bash
rg "homeTag\('shanghai'\)|facetsTag\('shanghai'\)" src
pnpm exec vitest run tests/public-catalog-city-cache.test.ts tests/cache-next-adapter-integration.test.ts tests/home-sitemap-cache-performance.test.ts tests/public-catalog-cache-invalidator.test.ts
```

Expected: `rg` has no matches; all tests PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add payload-office-platform/src/lib/frontend/cached-queries.ts payload-office-platform/src/domain/public-catalog/cache-tags.ts payload-office-platform/src/domain/public-catalog/cache-invalidator.ts payload-office-platform/src/lib/frontend/public-cache-revalidation.ts payload-office-platform/tests/public-catalog-city-cache.test.ts payload-office-platform/tests/cache-next-adapter-integration.test.ts payload-office-platform/tests/home-sitemap-cache-performance.test.ts payload-office-platform/tests/public-catalog-cache-invalidator.test.ts
git commit -m "feat: isolate public caches by city"
```

### Task 4: City-aware sitemap source and catalog verification gate

**Files:**
- Modify: `payload-office-platform/src/app/(frontend)/sitemap.ts`
- Modify: `payload-office-platform/tests/sitemap-static-routes.test.ts`
- Modify: `payload-office-platform/tests/fp-06-content-seo-cache-acceptance.test.ts`
- Create: `payload-office-platform/tests/public-catalog-city-parity.test.ts`

**Interfaces:**
- Consumes: profile list resolver from Plan 1 and city-scoped cached catalog functions from Task 3.
- Produces: a sitemap source that enumerates only live profiles and effective city-scoped supply.

- [ ] **Step 1: Write failing sitemap/parity tests**

```ts
expect(urls).toContain('/shanghai')
expect(urls).not.toContain('/hangzhou') // coming-soon
expect(urls).toContain('/shanghai/listings/shanghai-listing')
expect(urls).not.toContain('/shanghai/listings/hangzhou-listing')
```

Create a parity table asserting homepage/list/search/detail/recommendation/facet/sitemap consumers resolve the same effective listing ID set for each city.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run tests/sitemap-static-routes.test.ts tests/public-catalog-city-parity.test.ts`

Expected: FAIL on old global paths/default city.

- [ ] **Step 3: Implement live-profile sitemap enumeration**

Fetch public profiles once, filter `serviceStatus==='live'`, and call catalog functions with each profile slug. Keep global `/news`, published articles, and `/pages/privacy`; include `/city-partner` once; exclude coming-soon city paths and query variants.

- [ ] **Step 4: Run Plan 2 gate verification**

Run:

```bash
pnpm exec vitest run tests/public-catalog-city-context.test.ts tests/public-catalog-city-cache.test.ts tests/public-catalog-city-parity.test.ts tests/frontend-mappers.test.ts tests/detail-recommendations.test.ts tests/sitemap-static-routes.test.ts tests/fp-06-content-seo-cache-acceptance.test.ts
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: all focused tests/typecheck pass and diff check is clean.

- [ ] **Step 5: Commit Task 4 and record Gate B evidence**

```bash
git add payload-office-platform/src/app/\(frontend\)/sitemap.ts payload-office-platform/tests/sitemap-static-routes.test.ts payload-office-platform/tests/fp-06-content-seo-cache-acceptance.test.ts payload-office-platform/tests/public-catalog-city-parity.test.ts
git commit -m "feat: generate city scoped public sitemap"
```
