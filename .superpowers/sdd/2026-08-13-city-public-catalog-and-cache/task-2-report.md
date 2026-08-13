# Task 2 Report: Canonical City Identity in Public Catalog DTOs

## Status

Complete. Public listing/building DTOs now require canonical city identity, invalid or unpopulated city relationships fail closed, route-only legacy identity services expose only `{ slug, citySlug }`, and JSON-LD/recommendations consume the DTO identity.

## Implementation

- Added `PublicCityIdentity` (`citySlug`, `cityName`) to `ListingCardViewModel`, `ListingDetailViewModel`, `BuildingSummaryViewModel`, and `BuildingDetailViewModel`.
- Added strict `mapBuildingCity(building)` behavior. It accepts only a populated Location whose type is `city`, status is `active`, slug is already canonical, and name is non-empty. Raw IDs, missing values, disabled nodes, wrong location types, malformed slugs, and blank names return `null`.
- Listing and building mappers now return `null` when city identity is unavailable. No empty-string city fallback or page-level city query was added.
- Standard listing/building adapter queries retain sufficient depth to populate `building.city` in the original catalog query. The regression test asserts one listing query and zero Location lookups.
- Added `resolveListingRouteIdentity(slug)` and `resolveBuildingRouteIdentity(slug)`. Their public result is exactly `{ slug, citySlug } | null`.
  - Listing identity performs a narrow cityless lookup for slug/building, then reuses the existing city-scoped effective-supply path before returning identity.
  - Building identity reuses `getPublicBuildingWhere()` and selects only slug/city.
- Recommendation cards preserve their mapped city identity.
- Listing/building JSON-LD emits a `PostalAddress.addressLocality` sourced from DTO `cityName`, with no hard-coded city label.
- Updated typed demo/test fixtures and DTO whitelist contracts so required identity cannot be bypassed.

## TDD Evidence

Initial focused RED command (Node 22.23.2, pnpm 8.6.1):

```text
pnpm exec vitest run tests/frontend-mappers.test.ts tests/detail-pages-seo.test.ts tests/detail-recommendations.test.ts tests/public-catalog-city-context.test.ts
```

Observed before production edits: 4 failed files, 11 failed tests, 110 passed. Failures were the intended missing helper/fields/services, fail-closed city behavior, recommendation propagation, JSON-LD locality, and route identity behavior.

After minimal implementation: 4 files passed, 121/121 tests passed.

## Verification

All commands ran via the Node 22/pnpm 8.6.1 wrapper.

- Focused required suite: 4 files, 121/121 passed.
- Broader Public Catalog/detail/supply regression suite: 12 files, 267/267 passed.
- Full unit suite: 187 files, 2762/2762 passed.
- `pnpm exec tsc --noEmit --pretty false`: exit 0, no diagnostics.
- `git diff --check`: exit 0.
- No Payload type generation was required because no Collection or Global schema changed.
- No database, migration, production, deployment, browser-route, or plan changes were performed.

## Concerns and Follow-up

- The route-only listing identity intentionally uses two catalog reads: a narrow cityless identity lookup followed by the existing city-scoped effective-supply resolution. This preserves the single effective-supply predicate and prevents raw/display data from crossing the Public Catalog boundary; it is not used by normal listing/detail rendering.
- `cityName` follows the persisted canonical Location name (for example, `上海市`), as required by this task. City Site Profile short-display-name normalization remains separate.
- Browser verification is not applicable to this DTO/service-only task; route pages that consume these identity services are a later plan task.

## Fix Round 1 (2026-08-13)

### Changes

- Added Payload 3.86 collection-scoped `populate` projections to both cityless route-identity reads:
  - listing route identity selects only `slug` and `building`, populates only `buildings.city`, and limits Location population to `name`, `slug`, `type`, and `status` (Payload retains relationship `id` automatically);
  - building route identity selects only `slug` and `city`, with the same minimal canonical Location population.
- Replaced route-path assertions from selected partial documents to full generated `Listing`/`Building` types with dedicated `unknown` validators for the minimal projections. Malformed or unpopulated projections fail closed.
- Constructed route `Where` objects directly. `getEffectiveSupplyWhere()` now exposes its existing runtime shape as the precise equals/exists predicate union instead of `Record<string, unknown>`; this is a type-only narrowing and does not change query behavior.
- Added a coarse-visible Hangzhou listing with only two media items. Its first route lookup succeeds, its existing city-scoped fine effective-supply read rejects it, and the identity returns `null`.
- Added an archived Hangzhou building fixture and verified the public-building predicate excludes its route identity.
- Kept all normal catalog depth/population and mapper queries unchanged.

### TDD and Verification Evidence

All commands ran via the Node 22/pnpm 8.6.1 wrapper.

- RED: `tests/public-catalog-city-context.test.ts` failed 1/11 because both route identity queries omitted the required collection-scoped `populate` contract. The other 10 behavior tests passed.
- GREEN city-context: 1 file, 11/11 passed.
- Focused mapper/detail/recommendation/city suite: 4 files, 124/124 passed.
- Broader Public Catalog/effective-supply regression suite: 13 files, 321/321 passed.
- Full unit suite: 187 files, 2765/2765 passed.
- `pnpm exec tsc --noEmit`: exit 0, no diagnostics.
- `git diff --check`: exit 0.

### Fix-Round Concerns

- The route listing service still intentionally performs the two reads described above: the first discovers canonical city identity using a minimal projection; the second is the existing city-scoped full effective-supply check. The new regression explicitly proves the second read carries `building.city.slug` and rejects fine-ineligible inventory.
- No database, migration, generated schema, plan, production, deployment, or public DTO changes were made in this fix round.
