# Authorized residual fix report

Base: `b2fb4c94d41bd80c61e6b07877de5bb01b072356`

## Status

Implemented the authorized CityContext resolver correctness repair. Exact city resolution no longer uses the cached public-profile list as a gate, and the process-local per-slug `unstable_cache` wrapper map is a deterministic capacity-64 LRU.

## RED evidence

Tests were changed before production code. Command:

```powershell
npx -y node@22 "C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js" exec vitest run tests/city-context-resolver.test.ts
```

Result: exit `1`; 1 test file failed; 4 failed and 12 passed.

- Stale-list regression: expected Hangzhou context, received `null`.
- Unknown exact lookup: expected one `public-city-profile/unknown-city` factory call, received zero.
- Capacity regression: after 65 unique slugs and re-requesting the first, expected two wrapper factory calls, received one, demonstrating the map retained the first entry without a bound.
- Recency regression: after refreshing the first slug and inserting the 65th, expected the second slug to be re-created, received one factory call, demonstrating there was no LRU eviction.

## Implementation

- Removed `listPublicCityProfiles()` from `resolveCityContext` exact-resolution correctness flow.
- Preserved `normalizeCitySlug` rejection, including malformed/path-like values and the 64-character maximum.
- Kept exact fail-closed resolution through `createCityContextResolver(findPublicCityProfile)`; an unknown valid slug queries its exact `city.slug` and returns `null`.
- Added a process-local wrapper capacity of 64. A hit deletes and reinserts the key to refresh `Map` insertion order. Insertion above capacity deletes the first key, which is the deterministic least-recently-used wrapper.
- Preserved the exact cache key `['public-city-profile', citySlug]`, tags `public:city-profile:<slug>` and `public:city-profiles`, and `revalidate: 300`.
- Added no production reset, inspection, or other test-only hook. Tests observe exact Payload queries and `unstable_cache` factory calls.

## GREEN and verification evidence

CityContext GREEN command:

```powershell
npx -y node@22 "C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js" exec vitest run tests/city-context-resolver.test.ts
```

Result: exit `0`; 1 test file passed; 16/16 tests passed.

Full foundation-focused tests:

```powershell
npx -y node@22 "C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js" exec vitest run tests/city-site-profile-domain.test.ts tests/city-site-profile-access.test.ts tests/city-site-profile-migration.test.ts tests/city-context-resolver.test.ts tests/city-profile-cache-invalidator.test.ts tests/location-protect.test.ts tests/admin-navigation-config.test.ts tests/location-references.test.ts tests/location-delete-guard.test.ts tests/preflight-migrations.test.ts
```

Result: exit `0`; 10/10 test files passed; 124/124 tests passed.

TypeScript:

```powershell
npx -y node@22 "C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js" exec tsc --noEmit --pretty false
```

Result: exit `0`; no diagnostics.

Focused lint:

```powershell
npx -y node@22 "C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js" exec eslint "src/app/(frontend)/_lib/city-context.ts" tests/city-context-resolver.test.ts
```

Result: exit `0`; no diagnostics.

Scoped diff check:

```powershell
git diff --check -- 'payload-office-platform/src/app/(frontend)/_lib/city-context.ts' 'payload-office-platform/tests/city-context-resolver.test.ts' '.superpowers/sdd/2026-08-13-city-foundation-and-profiles/authorized-residual-fix-report.md'
```

Result: exit `0`; no whitespace errors. The same check is repeated against the staged diff before commit so the ignored-but-required report is included in the evidence.

## Changed files

- `payload-office-platform/src/app/(frontend)/_lib/city-context.ts`
- `payload-office-platform/tests/city-context-resolver.test.ts`
- `.superpowers/sdd/2026-08-13-city-foundation-and-profiles/authorized-residual-fix-report.md`

No migration, database, plan, generated-type, or unrelated file was changed. No production action, deployment, push, or PR was performed.

## Self-review

- The stale-list test supplies an empty cached list while the exact Payload query contains a newly valid Hangzhou document; resolution succeeds only if the list is not consulted.
- The unknown-slug test observes both the per-slug cache factory and the exact `where: { 'city.slug': { equals: 'unknown-city' } }` query before the `null` result.
- The capacity test fills 65 distinct slugs and observes wrapper re-creation for the first slug.
- The recency test fills 64 slugs, hits the first, inserts the 65th, then observes that the first remains resident and the second is re-created.
- Existing assertions continue to cover the list cache and exact per-city cache revalidation/tag contracts.
- No Shanghai or nationwide fallback was introduced.

## Concerns and residual risks

- The LRU bounds only process-local resolver wrapper objects. Next.js owns the underlying `unstable_cache` entries under the preserved keys and revalidation policy.
- Syntactically valid unknown slugs now intentionally reach an exact cached lookup. The 64-entry wrapper bound prevents unbounded process-local allocation; the lookup remains fail-closed.
- The list cache can still be stale for switcher/options presentation under its existing 300-second policy, but it can no longer cause an exact city route false negative.
