# OPT-026 Listings Query and Prefetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache canonical listing searches, replace the full homepage dependency with a lightweight district query, and stop automatic prefetch from multiplying expensive listing requests.

**Architecture:** Add a Public Catalog facade query that maps effective districts only, wrap it and listing search with the existing tagged Next.js cache, then route `/listings` through those wrappers. Disable prefetch only on high-cardinality listing-filter links; retain normal detail/building prefetch.

**Tech Stack:** Next.js 16 App Router, React 19, Payload CMS 3.86, TypeScript, Vitest, pnpm.

## Global Constraints

- Preserve the unified effective-supply predicate; routes and components must not build Payload `where` clauses.
- Public supply caches must set `revalidate: 300` and retain event-driven category tags.
- Do not change Collections, database schema, indexes, constraints, or migrations.
- Preserve all existing OPT-025 changes in `src/lib/frontend/cached-queries.ts` and the worktree.
- Do not commit, push, create a PR, or deploy without separate explicit user authorization.
- Use Node 22 for tests, build, and production-mode verification.

---

## File Map

- Create `specs/work-items/OPT-026-listings-query-prefetch.md`: active Task Packet and acceptance record.
- Create `tests/listings-query-prefetch-performance.test.ts`: facade behavior and source-level wiring contract.
- Modify `src/domain/public-catalog/facade.ts`: expose the lightweight `getListingDistrictOptions` query.
- Modify `src/domain/public-catalog/index.ts`: export the new facade query.
- Modify `src/lib/frontend/cached-queries.ts`: add the district cache and a 300-second listing-search ceiling without removing OPT-025.
- Modify `src/app/(frontend)/listings/page.tsx`: use canonical cached search and district options.
- Modify `src/components/frontend/CategoryTiles.tsx`: disable prefetch on listing destinations only.
- Modify `src/components/frontend/DistrictCards.tsx`: disable prefetch on listing destinations.
- Modify `src/components/frontend/SiteNav.tsx`: disable prefetch on `/listings` and preset listing-filter navigation items.
- Modify `src/components/frontend/FilterBar.tsx`: disable prefetch on generated filter links.
- Create `artifacts/verification/OPT-026/README.md`: commands, timings, browser routes, and remaining risk.

### Task 1: Establish the Task Packet and failing contracts

**Files:**
- Create: `specs/work-items/OPT-026-listings-query-prefetch.md`
- Create: `tests/listings-query-prefetch-performance.test.ts`

**Interfaces:**
- Consumes: `SupplyAdapter.findEffectiveDistricts(ctx)` and `DistrictViewModel`.
- Produces: executable failure evidence for `getListingDistrictOptions`, cached route wiring, and prefetch controls.

- [ ] **Step 1: Create the Task Packet**

Write the packet with goal, current timings (`/listings` 1.18–1.27 seconds; page navigation about 1.26 seconds), exact files above, no database changes, and browser checks for default/filter/pagination URLs.

- [ ] **Step 2: Write the failing facade test**

Add a test beside the existing fake adapter pattern:

```ts
it('loads listing district options without running homepage aggregations', async () => {
  const calls: string[] = []
  const adapter = createFakeAdapter({ listings: [], districts: [DISTRICT_ACTIVE] })
  const result = await getListingDistrictOptions(TEST_CTX, {
    ...adapter,
    async findEffectiveDistricts(ctx) {
      calls.push('districts')
      return adapter.findEffectiveDistricts(ctx)
    },
    async findFeaturedListings() {
      calls.push('featured')
      return []
    },
    async sumEffectiveLeasableAreaByBuildings() {
      calls.push('areas')
      return new Map()
    },
  })

  expect(result).toEqual([{ id: DISTRICT_ACTIVE.id, slug: DISTRICT_ACTIVE.slug, name: DISTRICT_ACTIVE.name }])
  expect(calls).toEqual(['districts'])
})
```

Use the exact valid district fixture shape already present in `tests/public-catalog-facade.test.ts`; do not invent a partial Payload document with type assertions.

- [ ] **Step 3: Write source-wiring failures**

Read source files with `readFile` and assert:

```ts
expect(listingsPage).toContain('getCachedSearchListings(canonical, input)')
expect(listingsPage).toContain('getCachedListingDistrictOptions()')
expect(listingsPage).not.toContain('getHomepage(')
expect(cachedQueries).toMatch(/getCachedSearchListings[\s\S]*?revalidate:\s*300/)
expect(categoryTiles).toMatch(/href=\{t\.href\}[\s\S]*?prefetch=\{t\.href\.startsWith\('\/listings'\) \? false : undefined\}/)
expect(districtCards).toMatch(/href=\{`\/listings\?businessArea=\$\{district\.slug\}`\}[\s\S]*?prefetch=\{false\}/)
expect(siteNav).toContain("prefetch={item.href.startsWith('/listings') ? false : undefined}")
expect(filterBar).toContain('prefetch={false}')
```

- [ ] **Step 4: Run the focused tests and capture the expected failure**

Run:

```bash
pnpm exec vitest run tests/public-catalog-facade.test.ts tests/listings-query-prefetch-performance.test.ts
```

Expected: FAIL because `getListingDistrictOptions` and the route/cache wiring do not yet exist.

### Task 2: Add the lightweight district facade and cache

**Files:**
- Modify: `src/domain/public-catalog/facade.ts`
- Modify: `src/domain/public-catalog/index.ts`
- Modify: `src/lib/frontend/cached-queries.ts`

**Interfaces:**
- Produces: `getListingDistrictOptions(ctx: SearchContext, adapter?: SupplyAdapter): Promise<readonly DistrictViewModel[]>`.
- Produces: `getCachedListingDistrictOptions(): Promise<readonly DistrictViewModel[]>`.
- Preserves: `getCachedSearchListings(canonicalQuery: string, input: ListingSearchInput)`.

- [ ] **Step 1: Implement the minimal facade query**

Add to `facade.ts`:

```ts
export async function getListingDistrictOptions(
  ctx: SearchContext,
  adapter: SupplyAdapter = getDefaultSupplyAdapter(),
): Promise<readonly DistrictViewModel[]> {
  const districts = await adapter.findEffectiveDistricts(ctx)
  const result: DistrictViewModel[] = []
  for (const district of districts) {
    const mapped = mapDistrict(district)
    if (mapped) result.push(mapped)
  }
  return result
}
```

Export it from `index.ts` next to `getHomepage`.

- [ ] **Step 2: Add tagged caches**

In `cached-queries.ts`, import the new function and add:

```ts
export const getCachedListingDistrictOptions = unstable_cache(
  async () => getListingDistrictOptions(defaultCtx()),
  ['listing-district-options'],
  {
    tags: [BUILDINGS_CATEGORY_TAG, LISTINGS_CATEGORY_TAG, facetsTag('shanghai')],
    revalidate: 300,
  },
)
```

Add `revalidate: 300` to `getCachedSearchListings`. Keep the existing OPT-025 `getCachedSearchBuildings` implementation byte-for-byte except where formatting requires an adjacent insertion.

- [ ] **Step 3: Run facade and contract tests**

Run the Task 1 command. Expected: facade/cache assertions pass; route and prefetch assertions remain failing.

### Task 3: Wire the listing route and prefetch controls

**Files:**
- Modify: `src/app/(frontend)/listings/page.tsx`
- Modify: `src/components/frontend/CategoryTiles.tsx`
- Modify: `src/components/frontend/DistrictCards.tsx`
- Modify: `src/components/frontend/SiteNav.tsx`
- Modify: `src/components/frontend/FilterBar.tsx`

**Interfaces:**
- Consumes: `getCachedSearchListings(canonical, input)` and `getCachedListingDistrictOptions()`.
- Preserves: all existing URL/canonical/page-building functions.

- [ ] **Step 1: Replace direct route queries**

Remove `defaultSearchContext`, `getHomepage`, and `searchListings` imports. After parsing input, compute the canonical key once and load both cached values:

```ts
const canonical = buildCanonicalSearchParams(input).toString()
const [result, districts] = await Promise.all([
  getCachedSearchListings(canonical, input),
  getCachedListingDistrictOptions(),
])
```

Pass `districts` to `FilterBar` and `MobileFilterDrawer`. Do not change metadata canonical generation or pagination calculations.

- [ ] **Step 2: Disable only expensive prefetch destinations**

For category tiles, apply the same conditional to both the mapped tiles and the “查看全部房源” link (the latter may use a literal `prefetch={false}`):

```tsx
<Link
  href={t.href}
  prefetch={t.href.startsWith('/listings') ? false : undefined}
  className="cat-tile"
  data-event-name={t.event}
>
```

Set `prefetch={false}` on DistrictCards listing links and every `FilterBar` link whose href is produced by `buildHref`. Also set it on reset `/listings` links. Do not alter building/detail links, and leave the already-correct `Pagination` prefetch behavior unchanged.

For both desktop and mobile `SiteNav` loops, use:

```tsx
prefetch={item.href.startsWith('/listings') ? false : undefined}
```

This disables the two preset type-filter requests as well as the listing overview request while retaining default prefetch for buildings and news.

- [ ] **Step 3: Run the focused tests**

Run the Task 1 command. Expected: PASS.

- [ ] **Step 4: Run static verification**

```bash
pnpm exec tsc --noEmit --pretty false
pnpm exec vitest run tests/public-catalog-facade.test.ts tests/listings-query-prefetch-performance.test.ts tests/public-catalog-effective-supply-consistency.test.ts
```

Expected: all commands exit 0.

### Task 4: Production and browser verification

**Files:**
- Create: `artifacts/verification/OPT-026/README.md`
- Modify: `specs/work-items/OPT-026-listings-query-prefetch.md`

**Interfaces:**
- Produces: reproducible evidence and a completed OPT-026 acceptance decision.

- [ ] **Step 1: Run full project gates**

```bash
pnpm test
pnpm build
```

Expected: all tests and production build pass under Node 22.

- [ ] **Step 2: Measure cold and warm routes**

Start the production server on a free local port and record at least five warm samples for `/listings`, `/listings?page=2`, and one filtered URL. Expected: warm server responses are within 200–300 ms; explicitly record cold search latency even if it remains near 1 second.

- [ ] **Step 3: Verify browser behavior**

At 375×812, 768×1024, 1440×900, and 1920×1080 verify default list, filter change, pagination, keyboard operation, empty state, and console. Scroll the homepage and inspect network requests; expected: no automatic RSC requests for every type/business-area listing URL.

- [ ] **Step 4: Write evidence and close only completed checks**

Record commands, exact timings, routes, expected/actual results, console status, and remaining 1000-candidate risk in `artifacts/verification/OPT-026/README.md`. Update the Task Packet with a short summary and evidence link; do not commit.
