# Plan 1 final fix report

Base: `b6096c6`

Scope: all Important and Minor findings in `final-review-findings.md`. Work was limited to the `multi-city-frontend` worktree and its local PostgreSQL database. No production connection/write, deployment, push, PR, or plan-checkbox edit was performed.

## Finding 1 — Shanghai immutable-code resolution

- Shanghai compatibility remains restricted to exact immutable codes. The canonical-first order is `CITY-SH`, `LEGACY_LOC_1`, `SH`; there is no name lookup or fuzzy match.
- The seed query now selects `id`, `immutable_code`, `name`, and `status`, filters the exact-code candidates to active rows, deterministically orders canonical code first, and requires exactly one active row.
- Disabled aliases are tolerated. Zero or multiple active candidates throw `city_site_profile_seed_conflict`.
- The behavioral migration fake models the requested production shape: `SH` disabled plus `LEGACY_LOC_1` active. It selects the active legacy row and completes seven inserts. A separate two-active-candidate test remains fail-closed.

RED: the new compatibility test failed because the original query selected only `id` and rejected both rows before considering status. GREEN: `tests/city-site-profile-migration.test.ts` passes this behavior and the complete existing seed matrix.

## Finding 2 — deterministic Chinese city display name

- Added one shared invariant in `src/domain/city-site-profile/schema.ts`: trim the Location name, remove exactly one terminal Chinese city suffix `市`, and otherwise preserve the name. `杭州市` maps to `杭州`; existing `上海` remains `上海`.
- Profile write protection validates SEO against this display name, retaining the exact 1–60 title and 70–160 description bounds.
- Seed rows declare an exact expected display name. The migration normalizes the queried Location name, requires equality with that expected display name, and validates the deterministic seeded SEO copy against it. This does not accept arbitrary substrings as equivalent city names.
- Read-time DTO mapping uses the same normalizer and exposes the short display name while revalidating SEO against it.

RED: a valid short-copy profile for persisted `杭州市` failed with `seo_title_city_required`; read mapping returned `杭州市`; a controlled mismatched seed city name was accepted. GREEN: all three boundaries now pass their behavioral tests.

### Corrective-migration decision

No corrective migration was added. The local persisted profiles were queried against the final invariant before and after seed replay: 7 profiles, `live=1`, `coming-soon=6`, display-invariant failures 0, duplicate city groups 0, invalid city relations 0. Existing operational copy therefore requires no rewrite. The runtime/seed invariant accepts the already-approved short copy and deliberately does not silently rewrite edited content.

## Finding 3 — fail-closed public DTO mapping

- A raw city or featured-region slug must already equal its canonical normalized slug; read mapping no longer silently trims or lowercases persisted drift.
- City status/type/identifier/name, SEO bounds and current display-name inclusion are revalidated.
- Each featured region must have a valid identifier/name/type, canonical raw slug, `status=active`, `frontendVisible=true`, and an owning-city relationship matching the profile city.
- Both profile queries retain `depth: 2`, which populates direct city/region documents plus the featured region's owning city. Missing or malformed population returns no public DTO.

RED: malformed city slugs and SEO were exposed, and five featured-region fixtures (including disabled, hidden, cross-city, and non-canonical data) all mapped publicly. GREEN: only the fully valid profile maps; list/options fail closed for all drift cases.

## Finding 4 — cache expiry/tags and Location deletion

- Per-city and list `unstable_cache` wrappers now use `revalidate: 300`.
- Every per-city wrapper carries both `public:city-profile:{slug}` and the category tag `public:city-profiles`; the list carries the category tag.
- Tests inspect the actual wrapper key parts/options passed to `unstable_cache` rather than source text.
- Location reference counting now includes `city-site-profiles.city` and `city-site-profiles.featuredRegions`; referenced cities/regions are rejected by the existing `LOCATION_REFERENCED` delete guard.
- A Location `afterDelete` hook also invalidates owning-city profile/home/facet/sitemap tags for safely deletable, unreferenced Locations.

RED: wrapper options lacked expiry/category tags; profile-referenced Location deletion resolved successfully; `Locations` had no delete invalidation hook. GREEN: all cache, reference-count, guard, and delete-hook behaviors pass.

## Finding 5 — bounded unknown-slug wrapper allocation

- City slugs now have a strict 64-character maximum in addition to the existing canonical pattern.
- `resolveCityContext` checks the cached public profile list before calling the per-slug wrapper factory. Valid-looking unknown slugs return `null` without entering the module `Map`.
- Known routes still resolve through their city-specific cache; missing/drifted data remains fail-closed with no Shanghai or nationwide fallback.

RED: a 65-character slug normalized successfully and `unknown-city` allocated an `unstable_cache` wrapper. GREEN: both are rejected while a known Hangzhou route still resolves with the required cache metadata.

## Finding 6 — generated SQL whitespace waiver

The generated forward SQL in `src/migrations/20260813_010000_city_site_profiles.ts` was not cosmetically edited. Plan-range `git diff --check d2bd338..b6096c6` reports Payload-generated mixed indentation/trailing whitespace in that file (notably generated table-body lines 7–34 and generated blank lines). This is an explicit generated-file waiver, not a claim that the whole Plan 1 range is whitespace-clean. The fix-wave diff itself does not alter that generated schema migration.

## TDD and static verification

All commands used Node 22 with the repository's pnpm 8.6.1 entrypoint.

RED command:

```powershell
npx -y node@22 "C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js" exec vitest run tests/city-site-profile-domain.test.ts tests/city-site-profile-migration.test.ts tests/city-context-resolver.test.ts tests/city-profile-cache-invalidator.test.ts tests/location-references.test.ts tests/location-delete-guard.test.ts
```

Result: exit 1, 6 files failed, 34 tests failed / 33 passed. The failures included every changed behavior described above.

Focused GREEN: the same command exited 0 with 6 files / 67 tests passed.

Foundation GREEN:

```powershell
npx -y node@22 "C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js" exec vitest run tests/city-site-profile-domain.test.ts tests/city-site-profile-access.test.ts tests/city-site-profile-migration.test.ts tests/city-context-resolver.test.ts tests/city-profile-cache-invalidator.test.ts tests/location-protect.test.ts tests/admin-navigation-config.test.ts tests/location-references.test.ts tests/location-delete-guard.test.ts tests/preflight-migrations.test.ts
```

Result: exit 0, 10 files / 121 tests passed.

Full repository GREEN:

```powershell
npx -y node@22 "C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js" test
```

Result: exit 0, 186 files / 2,742 tests passed.

Typecheck:

```powershell
npx -y node@22 "C:\Program Files\nodejs\node_modules\corepack\dist\pnpm.js" exec tsc --noEmit --pretty false
```

Result: exit 0, no output.

Focused ESLint over all changed non-migration source/tests: exit 0, no output. The seed migration is ignored by the repository ESLint configuration and is covered by TypeScript and migration tests. No `any`, `as any`, TypeScript suppression, or new lint suppression was added.

## Local PostgreSQL verification

Target proof: `localhost`, database `postgres`. The verification helper blocked any non-local hostname and printed no credentials. The temporary helper was removed after use.

1. `pnpm migrate:dry-run`: 44 migrations, 0 blocking hits, 2 pre-existing warnings from `20260725_130727_m2_1_locations_geo_node`.
2. Amended seed replay through the local Payload PostgreSQL Drizzle executor: exit 0; `replayed=true`; before/after were identical at 7 profiles, `live=1`, `coming-soon=6`, duplicate city groups 0, invalid city relations 0, display-invariant failures 0. Because all seven persisted profiles matched, the idempotent replay performed no row inserts/updates.
3. `pnpm exec payload migrate`: exit 0, `Done.`; there were no pending migrations to apply.
4. `pnpm migrate:status`: emitted the complete report with 44 code migrations, 44 applied, 0 pending. After printing the complete report, the existing CLI retained an open handle and was interrupted; this did not affect the database evidence.
5. `pnpm migrate:verify`: exit 0, 173 checks, 0 failures, 17 pre-existing missing-JSON warnings.
6. Fresh post-migrate query: exit 0; 7 profiles, `live=1`, `coming-soon=6`, duplicate city groups 0, invalid city relations 0, display-invariant failures 0.

Local Shanghai candidates consisted of `SH` / `上海` / `active`. The required disabled-`SH` plus active-`LEGACY_LOC_1` production compatibility shape is covered by the controlled behavioral migration test; production was not accessed.

## Files changed

- `payload-office-platform/src/app/(frontend)/_lib/city-context.ts`
- `payload-office-platform/src/collections/Locations.ts`
- `payload-office-platform/src/domain/city-site-profile/profile-protect.ts`
- `payload-office-platform/src/domain/city-site-profile/resolver.ts`
- `payload-office-platform/src/domain/city-site-profile/schema.ts`
- `payload-office-platform/src/domain/geography/location-references.ts`
- `payload-office-platform/src/migrations/20260813_011000_seed_city_site_profiles.ts`
- `payload-office-platform/tests/city-context-resolver.test.ts`
- `payload-office-platform/tests/city-profile-cache-invalidator.test.ts`
- `payload-office-platform/tests/city-site-profile-domain.test.ts`
- `payload-office-platform/tests/city-site-profile-migration.test.ts`
- `payload-office-platform/tests/location-delete-guard.test.ts`
- `payload-office-platform/tests/location-references.test.ts`
- `.superpowers/sdd/2026-08-13-city-foundation-and-profiles/final-fix-report.md`

## Residual risks / concerns

- Production was not queried or changed. If production contains zero or multiple active Shanghai compatibility rows, the seed intentionally fails closed for operator correction.
- The local `migrate:status` command printed a complete correct report but retained an open handle; the independent post-migrate query and `migrate:verify` both exited 0.
- No browser verification was run because this wave changes server-side data validation/cache contracts and hooks, not a user-visible page, route, form, permission, or rendered state.
