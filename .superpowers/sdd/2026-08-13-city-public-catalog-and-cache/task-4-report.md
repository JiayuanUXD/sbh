# Task 4 Report: City-aware Sitemap and Gate B

## Status

Complete. The runtime sitemap now enumerates only live City Site Profiles, sources every city listing and building from Task 3 city-scoped cached Public Catalog APIs, preserves global public content, and emits no coming-soon or query-variant URLs.

## Implementation

- Replaced the default-city/raw Payload sitemap loader with one cached sitemap aggregation that calls `listPublicCityProfiles()` once and filters `serviceStatus === 'live'`.
- Each live city calls `getCachedSearchListings(citySlug, ...)` and `getCachedSearchBuildings(citySlug)`. Listing pagination is followed to the existing 5,000-entity safety limit; no raw listing/building document query or duplicate effective-supply predicate remains in the sitemap.
- Added city root, listing index/detail, and building index/detail URLs under `/{city}`. Coming-soon profiles and cross-city inventory are excluded.
- Preserved global `/news`, published `/news/{slug}` articles, published `/pages/{slug}` content, `/pages/privacy`, `/entrust`, and `/publish`. `/city-partner` is emitted exactly once, and URL de-duplication prevents duplicate canonical paths.
- Kept the existing runtime-only sitemap cache, global `public:sitemap` tag, 300-second backstop, entity caps, and secret-safe fail-closed logging.
- Removed two obsolete source-text tests that required sitemap to call raw adapter/building predicate symbols directly. Task 4 requires the Task 3 cached Public Catalog boundary; behavior tests now prove the resulting city and effective-supply contract instead.

## Behavioral Parity Matrix

The new two-city matrix runs real Public Catalog facade functions with an in-memory adapter that delegates fine eligibility to the production `isListingEffectivelySupplied` predicate. It includes effective Shanghai/Suzhou inventory plus a media-ineligible listing in each city.

For each city, the test compares the exact listing ID set returned by homepage, listing search, detail lookups, detail recommendations, facets, and generated sitemap URLs. Both cities agree on their own effective set, reject the other city, and reject the media-ineligible fixtures.

## TDD Evidence

All commands used the Node 22 / pnpm 8.6.1 wrapper.

Initial RED command:

```text
pnpm exec vitest run tests/sitemap-static-routes.test.ts tests/public-catalog-city-parity.test.ts
```

Before production edits: 2 files failed, 5/5 tests failed. The sitemap had no live-profile city roots, used only the default city, omitted global news/articles/privacy/city-partner, and produced no city supply URLs for either parity row. The real homepage/search/detail/recommendation/facet paths already agreed; only sitemap parity was empty.

After the minimal implementation: 2 files, 5/5 tests passed.

## Verification

- Exact Plan 2 Gate B suite: 7 files, 140/140 passed.
- Sitemap/effective-supply/cache related regressions: 11 files, 192/192 passed.
- Full unit suite: 189 files, 2772/2772 passed.
- `pnpm exec tsc --noEmit --pretty false`: exit 0, no diagnostics.
- Targeted ESLint for the sitemap and changed tests: exit 0.
- `git diff --check`: exit 0.
- No Payload schema/type generation, route-tree work, database, migration, browser UI, plan, ledger, production, deployment, or push action was performed.

## Concerns and Follow-up

- Public listing/building DTOs do not expose `updatedAt`; city supply sitemap entries therefore use sitemap generation time for `lastModified`. Published pages retain their DTO update time, and articles use `publishedAt` when available.
- The sitemap follows listing pages until the existing 5,000-entry cap per city and article pages until the same global cap. This preserves bounded runtime work while avoiding the former first-page/default-city limitation.
- City-prefixed routes are emitted before the Plan 3 route tree is implemented, as explicitly required by this task. Browser route verification belongs to Plan 3; this task verifies the sitemap source and URL set behavior only.

## Fix Round 1 (2026-08-13)

### Changes

- Added a typed `findEffectiveBuildingsPage` adapter contract and `searchBuildingsPage` Public Catalog facade. The Payload implementation carries canonical city, page, and bounded limit into the public-building query and returns `page`, `hasNextPage`, and `nextPage` without exposing raw documents beyond the facade.
- Added private per-city/per-page cached factories exposed through `getCachedSitemapBuildingsPage(citySlug, page, limit)`. Cache key parts explicitly contain city/page/limit; tags contain the city building category plus a page/limit-specific city tag; the 300-second backstop remains.
- Changed sitemap building enumeration to follow `nextPage` for every live city until exhaustion or 5,000 entries. A visited-page set and strictly increasing next-page check prevent repeated or cyclic pagination from looping indefinitely. Coming-soon profiles are never queried.
- Strengthened the parity matrix with an actually fine-ineligible two-media listing per city and independent exact facet assertions for district keys/counts, listing-type counts, and rent-unit counts. Suzhou intentionally uses a different listing-type/rent-unit distribution from Shanghai.

### TDD and Verification Evidence

All commands used the Node 22 / pnpm 8.6.1 wrapper.

- RED: 3 files ran 10 tests; 7 passed and 3 failed as intended. The typed cached page function did not exist, second-page building URLs were absent, and the 5,000-cap scenario emitted zero paginated buildings.
- GREEN focused pagination/cache/parity suite: 3 files, 10/10 passed.
- Exact Plan 2 Gate B suite: 7 files, 142/142 passed.
- Broader sitemap/cache/adapter/effective-supply regressions: 15 files, 267/267 passed.
- Full unit suite: 189 files, 2774/2774 passed.
- `pnpm exec tsc --noEmit --pretty false`: exit 0, no diagnostics.
- Targeted ESLint for all changed production and test files: exit 0.
- `git diff --check`: exit 0.

### Fix-Round Concerns

- The sitemap-specific building page cache retains one private function per requested canonical city/page/limit combination for the process lifetime. Sitemap uses a fixed page size and 5,000 cap, so the reachable key count is bounded.
- No plan, ledger, route-tree, schema, generated type, database, migration, browser UI, production, deployment, or push action was performed.
