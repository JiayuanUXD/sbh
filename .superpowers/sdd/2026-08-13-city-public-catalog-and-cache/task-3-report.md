# Task 3 Report: Per-city Public Cache Isolation

## Status

Complete. Every supply-facing cached public query now requires a canonical `citySlug`, owns a private memoized cache function for that city, and includes the city in its cache key and tags. Supply invalidation resolves the owning city from the event document/DTO and fails closed to category-wide tags plus sitemap when it cannot do so.

## Implementation

- Replaced the singleton supply cache wrappers with private, typed, memoized per-city factories. The `Map` and raw `unstable_cache` functions remain private; only typed public wrappers are exported.
- Added required `citySlug` first parameters to all eleven supply cache entry points. Each canonicalizes the city with `createSearchContext`, uses `[resource, citySlug]` key parts, carries city-specific tags, and retains the 300-second revalidation backstop.
- Added `public:listings:city:{city}` and `public:buildings:city:{city}` tags alongside conservative global `public:listings` and `public:buildings` fallback tags.
- Updated supply invalidation to prefer city identity on nested listing/building/document DTOs, then explicit event city fields. A resolved event invalidates only the owning city's home/facet/supply tags plus sitemap; an unresolved event invalidates both supply category fallbacks plus sitemap and never guesses Shanghai.
- Preserved global article and page cache signatures. Article invalidation remains category-wide; each city homepage also carries the global article category tag so an article change refreshes all affected homepage entries without a hard-coded city.
- Preserved Location deletion/visibility cache safety. A known Location invalidates its city profile, homepage, facets, listing/building city categories, and sitemap; an unresolved Location/profile event uses city-profile and supply category fallbacks plus sitemap.
- Updated the five explicit legacy route consumers to pass `siteConfig.defaultCity`. These remain the current single-city route boundary until the later city-routing task replaces that source.

## TDD Evidence

All commands used the Node 22 / pnpm 8.6.1 wrapper.

Initial RED command:

```text
pnpm exec vitest run tests/public-catalog-city-cache.test.ts tests/cache-next-adapter-integration.test.ts tests/public-catalog-cache-invalidator.test.ts tests/city-profile-cache-invalidator.test.ts tests/home-sitemap-cache-performance.test.ts
```

Before production edits: 5 files ran, 28 tests passed and 6 failed. The intended failures demonstrated cross-city warm-cache leakage, absence of city key/tag registrations, legacy city overriding actual DTO city, missing building-category fallback, ineffective `home:all`/`facets:all` fallback, and a homepage consumer omitting the required city.

After the minimal implementation: 5 files, 34/34 tests passed. The new cache test warms Shanghai, then Hangzhou, then Shanghai and proves separate adapter contexts, results, cache key registrations, city tags, and reuse of the original Shanghai entry.

## Verification

- Focused cache and invalidation suite: 5 files, 34/34 passed.
- Broader cache/performance/acceptance regression suite: 12 files, 93/93 passed.
- Full unit suite: 188 files, 2769/2769 passed.
- `pnpm exec tsc --noEmit --pretty false`: exit 0, no diagnostics.
- Targeted ESLint for cache/invalidation/tests and all changed route consumers: exit 0.
- Hard-coded `homeTag('shanghai')` / `facetsTag('shanghai')` search: no matches under `src`.
- Raw cache factory/Map export search: no matches.
- `git diff --check`: exit 0.
- No Payload schema/type generation, database, migration, browser UI, plan, ledger, production, deployment, or push action was performed.

## Concerns and Follow-up

- Factory memoization retains one function per canonical city for the process lifetime. The state is private and bounded in normal operation by the configured canonical city set.
- The unresolved-city path deliberately invalidates broad listing/building category tags. This is more expensive than city invalidation but prevents stale cross-city supply when event identity is incomplete.
- Explicit route consumers temporarily use `siteConfig.defaultCity`; the later route-boundary task is responsible for passing the URL-resolved city.
- Articles and pages intentionally remain global. Homepage entries depend on the global article category tag so article mutations invalidate all city homepages without making article queries city-scoped.
