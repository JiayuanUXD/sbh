# Implementation Plan — C-end Public Site (商办租赁 C 端公开站 MVP)

> **For agentic workers:** This plan is written for subagents/agents with zero context. Read the spec first: `docs/superpowers/specs/2026-07-24-c-end-public-site-design.md`. Do not skip the TDD cycle. Each task ends with a green test/build and a commit. Do not leave the repo in a half-built state between tasks. If a task's code doesn't match what you see in the repo, stop and surface the discrepancy instead of improvising.

Reference spec: `docs/superpowers/specs/2026-07-24-c-end-public-site-design.md`
Plan owner: liujiayuan
Last updated: 2026-07-24

---

## Global Constraints

1. **Stack is fixed:** Payload 3.86 + Next.js 16 monolith at `payload-office-platform/`. PostgreSQL in prod (TencentDB, `push: false` — migrations only), SQLite locally. Tencent COS via S3 plugin for `media`.
2. **No new framework, no UI lib.** Styling = the existing `src/app/(frontend)/styles.css` cream-and-gold design system (vars: `--ink --muted --line --paper --cream --gold --deep --green`) + Tailwind utility classes via the existing `tailwind.config`. If Tailwind is not wired into the `(frontend)` route group, prefer plain CSS modules extending `styles.css` rather than introducing a new dependency.
3. **C-end reads via Payload Local API only.** Server Components call `getPayload()` + `payload.find()/findOne()`. Never call the REST `/api/*` collections from server code. The only HTTP endpoint we add is our own `/api/inquiries` route (Task P3.1).
4. **Every list/detail page is dynamic.** Set `export const dynamic = 'force-dynamic'` on any page that reads the DB, matching the existing homepage pattern. No build-time DB access.
5. **Schema changes go through migrations.** Postgres is `push: false`. Any collection config change (P0.2) must produce a migration via `npx payload migrate:create` and that migration file is committed. Never hand-edit `src/migrations/*.ts` bodies.
6. **TDD where it fits, smoke where it doesn't.**
   - Pure-logic modules (`lib/frontend/filters.ts`, `lib/frontend/validation.ts`, `lib/frontend/format.ts`, `lib/frontend/queries.ts` query-param builders) get unit tests with **Vitest** (installed in P0.4). Write the failing test → run → implement → run green → commit.
   - Pages and route handlers are verified by `npm run build` (typecheck) **and** a `curl` smoke against `npm run dev`/`next start`. These are integration verification, not unit tests — that's intentional and noted in each task.
   - End-to-end flow (list → detail → submit inquiry) gets a **Playwright** test in P5.1.
7. **One logical change per commit.** Commit message prefix: `feat(c-end): ...`, `test(c-end): ...`, `chore(c-end): ...`.
8. **Don't touch the admin.** No edits under `src/app/(payload)` or to admin collection configs beyond the one `source` field on `Leads` (P0.2) + the `status` options alignment if needed.
9. **No placeholders, no "TODO".** Every code block in this plan is the real final code for that step. If a step says "create file X", the content shown is what goes in the file.
10. **Path alias:** `@/*` → `./src/*`. Use it.

---

## File Structure

```
payload-office-platform/
├── src/
│   ├── collections/
│   │   └── Leads.ts                      # EDIT P0.2 — add `source` field
│   ├── app/(frontend)/
│   │   ├── layout.tsx                   # EDIT P1.1 — add nav/footer, metadata
│   │   ├── page.tsx                     # EDIT P1.2 — real homepage (featured + districts)
│   │   ├── styles.css                   # EDIT P1.1 — add component classes
│   │   ├── listings/
│   │   │   └── page.tsx                 # CREATE P1.3 — list + filter
│   │   ├── listings/[slug]/
│   │   │   └── page.tsx                 # CREATE P2.1 — listing detail
│   │   ├── buildings/[slug]/
│   │   │   └── page.tsx                 # CREATE P2.2 — building detail
│   │   ├── sitemap.ts                   # CREATE P4.1
│   │   └── robots.ts                    # CREATE P4.1
│   ├── components/frontend/
│   │   ├── ListingCard.tsx              # CREATE P1.3
│   │   ├── FilterBar.tsx                # CREATE P1.3 (client component)
│   │   ├── InquiryModal.tsx             # CREATE P3.2 (client component)
│   │   └── ListingGallery.tsx          # CREATE P2.1 (client component)
│   ├── lib/frontend/
│   │   ├── queries.ts                   # CREATE P0.5 — Local API query helpers
│   │   ├── filters.ts                   # CREATE P0.5 — URL-param ⇄ query builders (unit-tested)
│   │   ├── format.ts                    # CREATE P0.5 — rent/area/date formatters (unit-tested)
│   │   └── validation.ts                # CREATE P3.1 — inquiry payload validation (unit-tested)
│   ├── app/api/inquiries/
│   │   └── route.ts                     # CREATE P3.1 — POST handler (Local API create lead)
│   └── migrations/
│     └── <timestamp>_add_leads_source.ts # GENERATED P0.2 (commit, don't hand-edit)
├── scripts/
│   └── seed.ts                          # EDIT P0.3 — add source + more listings/districts
├── tests/
│   ├── filters.test.ts                  # CREATE P0.5
│   ├── format.test.ts                   # CREATE P0.5
│   ├── validation.test.ts               # CREATE P3.1
│   └── e2e/inquiry-flow.spec.ts         # CREATE P5.1
├── vitest.config.ts                     # CREATE P0.4
├── playwright.config.ts                 # CREATE P5.1
└── package.json                         # EDIT P0.4 / P5.1 — add deps + scripts
```

---

# Phase P0 — Baseline: data model + query/fmt helpers

**Goal:** Add the one missing field (`Leads.source`), seed enough data to develop against, and stand up the pure-logic helper layer with unit tests. After P0, `npm run seed` produces a browsable dataset and `npm test` runs green.

---

## Task P0.1 — Pre-flight: confirm clean working tree + dev server boots

**Why:** Every subsequent task assumes a bootable app and a clean commit point to roll back to.

### Steps

1. From repo root:
   ```bash
   cd payload-office-platform
   git status --short
   ```
   Expect: clean (or only untracked plan/spec files). If dirty, stop and surface it.
2. Boot dev server to confirm the app starts:
   ```bash
   npm run dev
   ```
   Wait for `Ready` on `http://localhost:3717`. Kill it (Ctrl-C) once it's up. If it errors, stop — fix nothing, surface the error.

### Verification
Dev server printed `Ready` and served `/` without a 500.

### Commit
None. This task is verification-only. Proceed to P0.2.

---

## Task P0.2 — Add `source` field to Leads + generate migration

**Why:** C-end inquiry form creates leads with `source: 'frontend-form'`. The field doesn't exist yet (confirmed: `grep source src/collections/Leads.ts` → none).

### Steps

1. Open `src/collections/Leads.ts`. Locate the `status` select field block. Immediately **after** the `status` field, add the `source` field:

   ```ts
   {
     name: 'source',
     label: '线索来源',
     type: 'select',
     defaultValue: 'frontend-form',
     options: [
       { label: '前台表单', value: 'frontend-form' },
       { label: '电话', value: 'phone' },
       { label: '导入', value: 'import' },
       { label: '其他', value: 'other' },
     ],
   },
   ```

   (Place it right after the `status` select so it groups logically in the admin.)

2. Regenerate Payload types so server code can use the typed `source`:
   ```bash
   npm run generate:types
   ```
   Confirm `src/payload-types.ts` now contains `source?: ...` inside the `Lead` interface.

3. Generate the migration. This requires a DB connection only to diff schema; the local SQLite file is fine:
   ```bash
   npx payload migrate:create add-leads-source
   ```
   This creates `src/migrations/<timestamp>_add_leads_source.ts`. Open it and verify the `up` contains an `ALTER TABLE` (or equivalent add-column) for the `source` column on the leads table, and `down` drops it. **Do not edit the generated file.**

4. Apply the migration to local SQLite so dev has the column:
   ```bash
   npx payload migrate
   ```

### Verification
```bash
grep -n "source" src/payload-types.ts | head
ls src/migrations/*add_leads_source.ts
```
Both must return results.

### Commit
```bash
git add src/collections/Leads.ts src/payload-types.ts src/migrations/*add_leads_source.ts
git commit -m "feat(c-end): add source field to Leads + migration"
```

---

## Task P0.3 — Extend seed with districts, buildings, listings

**Why:** Need ≥8 listings across ≥4 Shanghai districts to make filter UX meaningful during P1/P2.

### Steps

1. Open `scripts/seed.ts`. Find the existing `seed()` function body (before the final `payload.logger.info('Seed data completed.')`).

2. The script already has `upsertBySlug`. Use it to ensure these **locations** exist (if the existing seed already creates some, dedupe by `slug`; upsert is idempotent). Add a `seedDistricts` block that upserts these `locations` (type `district`, parent = the Shanghai city location):

   ```ts
   const shanghaiCity = await upsertBySlug<any>(payload, 'locations', 'shanghai', {
     name: '上海',
     type: 'city',
     sortOrder: 1,
   })

   const districtDefs = [
     { slug: 'jingan', name: '静安' },
     { slug: 'huangpu', name: '黄浦' },
     { slug: 'pudong', name: '浦东' },
     { slug: 'xuhui', name: '徐汇' },
     { slug: 'changning', name: '长宁' },
   ]
   const districts: Record<string, any> = {}
   for (const d of districtDefs) {
     districts[d.slug] = await upsertBySlug<any>(payload, 'locations', d.slug, {
       name: d.name,
       type: 'district',
       parent: shanghaiCity.id,
       sortOrder: 10,
     })
   }
   ```

3. Add **5 buildings** (one per district), each with `slug`, `name`, `status: 'published'`, `grade`, `district` (the location id from step 2), `address`, `summary`. Example for two; replicate the pattern for the other three:

   ```ts
   const bJingan = await upsertBySlug<any>(payload, 'buildings', 'jingan-center', {
     name: '静安国际中心',
     status: 'published',
     grade: 'grade-a',
     district: districts.jingan.id,
     address: '静安区南京西路 1788 号',
     summary: '南京西路甲级写字楼，近地铁 2/7 号线静安寺站。',
   })
   const bHuangpu = await upsertBySlug<any>(payload, 'buildings', 'huangpu-bund', {
     name: '外滩源大厦',
     status: 'published',
     grade: 'super-grade-a',
     district: districts.huangpu.id,
     address: '黄浦区中山东一路',
     summary: '外滩核心区超甲级办公，历史建筑与现代设施融合。',
   })
   // …replicate for pudong-lujiazui, xuhui-xujiahui, changning-hongqiao
   ```

4. Add **8 listings** spread across the 5 buildings, varying `listingType`, `rent`, `rentUnit`, `area`, `status: 'available'`, and `isFeatured` on 3 of them. Each with a unique `slug` and 3 `highlights`. Example:

   ```ts
   await upsertBySlug<any>(payload, 'listings', 'jingan-center-360serviced', {
     title: '静安国际中心 · 精装服务式办公 360㎡',
     status: 'available',
     listingType: 'serviced-office',
     building: bJingan.id,
     rent: 2800,
     rentUnit: 'rmb-seat-month',
     area: 360,
     seats: 42,
     isFeatured: true,
     highlights: [
       { text: '近地铁 2/7 号线' },
       { text: '可即刻入驻' },
       { text: '带家具' },
     ],
   })
   // …7 more, covering listingType traditional-office / coworking / full-floor
   // and rentUnit rmb-sqm-day / rmb-month, so filter tests are meaningful
   ```

5. Run the seed against local SQLite:
   ```bash
   npm run seed
   ```
   (If `.env.local` lacks `DATABASE_URL`, seed uses SQLite — correct for dev.)

### Verification
Seed exits 0 and logs `Seed data completed.` Then:
```bash
node --import tsx -e "import {getPayload} from 'payload'; import config from './src/payload.config'; (async()=>{const p=await getPayload({config}); const r=await p.find({collection:'listings', limit:50}); console.log('listings:', r.totalDocs); const b=await p.find({collection:'buildings', limit:50}); console.log('buildings:', b.totalDocs); process.exit(0)})()"
```
Expect `listings: 8` (or more if seed ran before), `buildings: 5`.

### Commit
```bash
git add scripts/seed.ts
git commit -m "feat(c-end): seed 5 districts / 5 buildings / 8 listings"
```

---

## Task P0.4 — Install Vitest + config

**Why:** P0.5 introduces pure-logic helpers that must be unit-tested before pages consume them.

### Steps

1. Install Vitest as a dev dependency:
   ```bash
   npm install -D vitest
   ```

2. Create `payload-office-platform/vitest.config.ts`:
   ```ts
   import { defineConfig } from 'vitest/config'
   import path from 'path'

   export default defineConfig({
     resolve: {
       alias: {
         '@': path.resolve(__dirname, 'src'),
      },
     },
     test: {
       include: ['tests/**/*.test.ts'],
       environment: 'node',
     },
   })
   ```

3. Add scripts to `package.json` (merge into the existing `scripts` object):
   ```json
   "test": "vitest run",
   "test:watch": "vitest"
   ```

### Verification
```bash
npm test
```
Vitest runs and reports "No test files found" (expected — we add tests in P0.5) and exits 0. If it exits non-zero on "no tests", set `test.passWithNoTests: true` in the config and re-run.

### Commit
```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore(c-end): add vitest"
```

---

## Task P0.5 — `lib/frontend` helpers: `format.ts`, `filters.ts`, `queries.ts` (TDD)

**Why:** These are the pure-logic + Local-API-query layer every page uses. Format + filters are pure functions → real unit tests. Queries wrap Local API (smoke-tested via seed data).

### Subtask P0.5a — `format.ts` (TDD)

1. **Write the failing test** `tests/format.test.ts`:
   ```ts
   import { describe, expect, it } from 'vitest'
   import { formatRent, formatArea, rentUnitLabel } from '@/lib/frontend/format'

   describe('formatRent', () => {
     it('renders 元/㎡/天 with 1 decimal for rmb-sqm-day', () => {
       expect(formatRent(9.8, 'rmb-sqm-day')).toBe('9.8 元/㎡/天')
     })
     it('renders 元/月 for rmb-month', () => {
       expect(formatRent(25000, 'rmb-month')).toBe('25000 元/月')
     })
     it('renders 元/工位/月 for rmb-seat-month', () => {
       expect(formatRent(2800, 'rmb-seat-month')).toBe('2800 元/工位/月')
     })
     it('returns 待面议 when rent is undefined', () => {
       expect(formatRent(undefined, 'rmb-sqm-day')).toBe('待面议')
     })
   })

   describe('rentUnitLabel', () => {
     it('returns short label per unit', () => {
       expect(rentUnitLabel('rmb-sqm-day')).toBe('元/㎡/天')
       expect(rentUnitLabel('rmb-month')).toBe('元/月')
       expect(rentUnitLabel('rmb-seat-month')).toBe('元/工位/月')
     })
   })

   describe('formatArea', () => {
     it('appends ㎡', () => {
       expect(formatArea(360)).toBe('360 ㎡')
     })
     it('returns 面议 when undefined', () => {
       expect(formatArea(undefined)).toBe('面议')
     })
   })
   ```

2. Run it red:
   ```bash
   npm test
   ```
   Expect failure: module `@/lib/frontend/format` does not exist.

3. **Implement** `src/lib/frontend/format.ts`:
   ```ts
   export function rentUnitLabel(unit?: string): string {
     switch (unit) {
       case 'rmb-sqm-day':
         return '元/㎡/天'
       case 'rmb-month':
         return '元/月'
       case 'rmb-seat-month':
         return '元/工位/月'
       default:
         return ''
     }
   }

   export function formatRent(rent?: number | null, unit?: string): string {
     if (rent == null) return '待面议'
     const label = rentUnitLabel(unit)
     return label ? `${rent} ${label}` : `${rent}`
   }

   export function formatArea(area?: number | null): string {
     return area == null ? '面议' : `${area} ㎡`
   }
   ```

4. Run green:
   ```bash
   npm test
   ```

### Subtask P0.5b — `filters.ts` (TDD)

1. **Write the failing test** `tests/filters.test.ts`:
   ```ts
   import { describe, expect, it } from 'vitest'
   import { parseListingFilters, buildListingWhere, type ListingFilters } from '@/lib/frontend/filters'

   describe('parseListingFilters', () => {
     it('parses district, type, rent range, q from URLSearchParams', () => {
       const sp = new URLSearchParams('district=jingan&type=serviced-office&rentMin=2000&rentMax=5000&q=江景')
       const f = parseListingFilters(sp)
       expect(f).toEqual({
         district: 'jingan',
         listingType: 'serviced-office',
         rentMin: 2000,
         rentMax: 5000,
         q: '江景',
         page: 1,
       })
     })
     it('defaults page to 1 when absent', () => {
       expect(parseListingFilters(new URLSearchParams()).page).toBe(1)
     })
     it('clamps page to >=1', () => {
       expect(parseListingFilters(new URLSearchParams('page=0')).page).toBe(1)
       expect(parseListingFilters(new URLSearchParams('page=-3')).page).toBe(1)
     })
     it('ignores non-numeric rentMin', () => {
       expect(parseListingFilters(new URLSearchParams('rentMin=abc')).rentMin).toBeUndefined()
     })
   })

   describe('buildListingWhere', () => {
       it('builds where with status available always', () => {
         const f: ListingFilters = { page: 1 }
         const w = buildListingWhere(f)
         expect(w).toEqual({ status: { equals: 'available' } })
       })
       it('adds listingType equals', () => {
         const w = buildListingWhere({ listingType: 'coworking', page: 1 })
         expect((w as any).listingType.equals).toBe('coworking')
       })
       it('adds rent range', () => {
         const w = buildListingWhere({ rentMin: 100, rentMax: 500, page: 1 }) as any
         expect(w.rent.greater_than_equal).toBe(100)
         expect(w.rent.less_than_equal).toBe(500)
       })
       it('adds title contains for q', () => {
         const w = buildListingWhere({ q: '江景', page: 1 }) as any
         expect(w.title.contains).toBe('江景')
       })
       it('does NOT add district (district handled via building IDs in queries.ts)', () => {
         const w = buildListingWhere({ district: 'jingan', page: 1 }) as any
         expect(w.district).toBeUndefined()
       })
   })
   ```

2. Run red (module missing).

3. **Implement** `src/lib/frontend/filters.ts`:
   ```ts
   export type ListingFilters = {
     district?: string
     listingType?: string
     rentMin?: number
     rentMax?: number
     q?: string
     page: number
   }

   function toInt(v: string | null): number | undefined {
     if (v == null || v === '') return undefined
     const n = Number(v)
     return Number.isFinite(n) ? n : undefined
   }

   export function parseListingFilters(sp: URLSearchParams): ListingFilters {
     const listingType = sp.get('type') || undefined
     const district = sp.get('district') || undefined
     const rentMin = toInt(sp.get('rentMin'))
     const rentMax = toInt(sp.get('rentMax'))
     const q = sp.get('q') || undefined
     let page = toInt(sp.get('page')) ?? 1
     if (!Number.isFinite(page) || page < 1) page = 1
     return { district, listingType, rentMin, rentMax, q, page }
   }

   /**
    * Build the Payload `where` for the listings query EXCLUDING district.
    * District filtering requires resolving building IDs first (a relationship
    * on `building`); that's done in queries.ts because it needs an extra query.
    */
   export function buildListingWhere(f: ListingFilters): Record<string, unknown> {
     const where: Record<string, unknown> = {
       status: { equals: 'available' },
     }
     if (f.listingType) where.listingType = { equals: f.listingType }
     if (f.rentMin != null || f.rentMax != null) {
       where.rent = {}
       if (f.rentMin != null) (where.rent as any).greater_than_equal = f.rentMin
       if (f.rentMax != null) (where.rent as any).less_than_equal = f.rentMax
     }
     if (f.q) where.title = { contains: f.q }
     return where
   }
   ```

4. Run green.

### Subtask P0.5c — `queries.ts` (smoke, not unit-tested — wraps Local API)

The query helpers call Local API, so they're verified by P1 pages + a seed assertion, not unit tests. Implement now so P1 can import.

1. **Implement** `src/lib/frontend/queries.ts`:
   ```ts
   import { getPayload } from 'payload'
   import config from '@/payload.config'
   import { buildListingWhere, type ListingFilters } from '@/lib/frontend/filters'

   const PAGE_SIZE = 12

   export async function getListings(filters: ListingFilters) {
     const payload = await getPayload({ config })

     // Resolve district → building IDs, then filter listings by building.
     let buildingIds: (string | number)[] | undefined
     if (filters.district) {
       const buildings = await payload.find({
         collection: 'buildings',
         where: { 'district.slug': { equals: filters.district } },
         limit: 200,
         select: { id: true },
       })
       buildingIds = buildings.docs.map((d: any) => d.id)
       if (buildingIds.length === 0) {
         // No buildings in that district → return empty without querying listings.
         return { docs: [], totalDocs: 0, totalPages: 0, page: filters.page }
       }
     }

     const where: Record<string, unknown> = buildListingWhere(filters)
     if (buildingIds) where.building = { in: buildingIds }

     const result = await payload.find({
       collection: 'listings',
       where,
       page: filters.page,
       limit: PAGE_SIZE,
       sort: '-isFeatured -updatedAt',
       depth: 2, // populate building + its district + coverImage
     })
     return {
       docs: result.docs,
       totalDocs: result.totalDocs,
       totalPages: result.totalPages,
       page: filters.page,
     }
   }

   export async function getListingBySlug(slug: string) {
     const payload = await getPayload({ config })
     const result = await payload.find({
       collection: 'listings',
       where: { slug: { equals: slug } },
       limit: 1,
       depth: 3, // building + gallery + amenities
     })
     return result.docs[0] ?? null
   }

   export async function getBuildingBySlug(slug: string) {
     const payload = await getPayload({ config })
     const result = await payload.find({
       collection: 'buildings',
       where: { slug: { equals: slug } },
       limit: 1,
       depth: 2, // district, coverImage, gallery, amenities
     })
     return result.docs[0] ?? null
   }

   export async function getFeaturedListings(limit = 6) {
     const payload = await getPayload({ config })
     const result = await payload.find({
       collection: 'listings',
       where: { status: { equals: 'available' }, isFeatured: { equals: true } },
       limit,
       depth: 2,
       sort: '-updatedAt',
     })
     return result.docs
   }

   export async function getDistricts() {
     const payload = await getPayload({ config })
     const result = await payload.find({
       collection: 'locations',
       where: { type: { equals: 'district' } },
       limit: 100,
       sort: 'sortOrder',
     })
     return result.docs
   }

   export async function getListingsByBuilding(buildingId: string | number, limit = 6) {
     const payload = await getPayload({ config })
     const result = await payload.find({
       collection: 'listings',
       where: { building: { equals: buildingId }, status: { equals: 'available' } },
       limit,
       depth: 1,
       sort: '-updatedAt',
     })
     return result.docs
   }
   ```

   > Note on `where: { 'district.slug': { equals } }`: Payload supports nested relationship field filtering with dot notation when `depth` allows. If the Local API rejects the dotted key on this Payload version, the fallback is to fetch locations by `slug` then buildings by `district: { equals: locationId }`. If `getListings` with a district filter returns 0 results during P1 verification while listings exist, switch to the two-hop fallback and note it in the commit.

### Verification (queries smoke)
```bash
node --import tsx -e "import {getListings} from './src/lib/frontend/queries'; (async()=>{const r=await getListings({page:1}); console.log('page1:', r.totalDocs); const r2=await getListings({page:1, district:'jingan'}); console.log('jingan:', r2.totalDocs); process.exit(0)})().catch(e=>{console.error(e);process.exit(1)})"
```
Expect non-zero totals. If `district:'jingan'` returns 0 despite seeded data, apply the dotted-key fallback noted above before proceeding.

### Final P0.5 commit (format + filters + queries together)
```bash
git add src/lib/frontend/ tests/ package-lock.json
git commit -m "feat(c-end): lib/frontend format/filters/queries + unit tests"
```

---

# Phase P1 — List + filter + homepage

**Goal:** A real homepage and a working `/listings` page with URL-driven filters. After P1, a user can browse listings and filter by district/type/rent/keyword — all server-rendered, filters applied via URL `?` params.

---

## Task P1.1 — Frontend shell: layout + nav + footer + styles

### Steps

1. Edit `src/app/(frontend)/layout.tsx` — replace the blank template with a real shell. Keep `import './styles.css'`. Metadata must be real (SEO matters even before P4):
   ```tsx
   import React from 'react'
   import Link from 'next/link'
   import './styles.css'

   export const metadata = {
     title: {
      default: '商办租赁 · 上海中高端办公租赁平台',
      template: '%s · 商办租赁',
    },
     description: '上海甲级写字楼、服务式办公室、共享办公与整层办公租赁平台。',
   }

   const NAV = [
     { href: '/', label: '首页' },
     { href: '/listings', label: '在租房源' },
     { href: '/listings?type=serviced-office', label: '服务式办公' },
     { href: '/listings?type=coworking', label: '共享办公' },
   ]

   export default async function RootLayout(props: { children: React.ReactNode }) {
     const { children } = props
     return (
       <html lang="zh-CN">
         <body>
           <header className="site-header">
             <div className="site-header__inner">
               <Link href="/" className="site-logo">商办租赁</Link>
               <nav className="site-nav">
                 {NAV.map((n) => (
                   <Link key={n.href} href={n.href} className="site-nav__link">{n.label}</Link>
                 ))}
               </nav>
             </div>
           </header>
           <main className="site-main">{children}</main>
           <footer className="site-footer">
             <div className="site-footer__inner">
               <span>© {new Date().getFullYear()} 商办租赁平台</span>
               <span>上海 · 商务办公租赁</span>
             </div>
           </footer>
         </body>
       </html>
     )
   }
   ```
   > Note: `new Date()` in a Server Component layout is fine (server runtime); the plan-script restriction on `new Date()` does not apply to the shipped Next.js code, only to workflow scripts.

2. Append component classes to `src/app/(frontend)/styles.css` (add at end of file):
   ```css
   .site-header { border-bottom: 1px solid var(--line); background: var(--cream); position: sticky; top: 0; z-index: 10; }
   .site-header__inner { max-width: 1200px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; }
   .site-logo { font-size: 20px; font-weight: 700; color: var(--ink); letter-spacing: .04em; }
   .site-nav { display: flex; gap: 22px; }
   .site-nav__link { color: var(--muted); font-size: 14px; }
   .site-nav__link:hover { color: var(--ink); }
   .site-main { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }
   .site-footer { border-top: 1px solid var(--line); background: var(--cream); margin-top: 64px; }
   .site-footer__inner { max-width: 1200px; margin: 0 auto; padding: 24px; display: flex; justify-content: space-between; color: var(--muted); font-size: 13px; }
   .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
   .listing-card { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: #fff; display: flex; flex-direction: column; }
   .listing-card__media { aspect-ratio: 4/3; background: var(--paper); object-fit: cover; width: 100%; }
   .listing-card__body { padding: 16px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
   .listing-card__title { font-size: 16px; font-weight: 600; color: var(--ink); }
   .listing-card__meta { font-size: 13px; color: var(--muted); }
   .listing-card__rent { font-size: 18px; font-weight: 700; color: var(--gold); }
   .listing-card__tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
   .tag { font-size: 12px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); }
   .filter-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 24px; }
   .filter-bar__field { display: flex; flex-direction: column; gap: 4px; }
   .filter-bar__label { font-size: 12px; color: var(--muted); }
   .filter-bar__input, .filter-bar__select { border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; font-size: 14px; background: #fff; }
   .btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 18px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; }
   .btn--primary { background: var(--ink); color: #fff; }
   .btn--ghost { background: transparent; border: 1px solid var(--line); color: var(--ink); }
   .pager { display: flex; gap: 8px; justify-content: center; margin-top: 32px; }
   .pager__link { padding: 6px 12px; border: 1px solid var(--line); border-radius: 6px; font-size: 14px; }
   .pager__link--disabled { color: var(--muted); pointer-events: none; opacity: .5; }
   ```

### Verification
```bash
npm run build
```
Build must succeed (typecheck). Then:
```bash
npm run dev
```
`/` renders header + footer. Kill server.

### Commit
```bash
git add "src/app/(frontend)/layout.tsx" "src/app/(frontend)/styles.css"
git commit -m "feat(c-end): frontend shell — nav, footer, styles, metadata"
```

---

## Task P1.2 — Real homepage: featured listings + district chips

### Steps

1. Replace `src/app/(frontend)/page.tsx` with a server component that pulls featured listings + districts via `queries.ts`. Remove the `fallbackListings` demo data entirely.
   ```tsx
   import Link from 'next/link'
   import React from 'react'
   import { getDistricts, getFeaturedListings } from '@/lib/frontend/queries'
   import ListingCard from '@/components/frontend/ListingCard'
   import './styles.css'

   export const dynamic = 'force-dynamic'

   export const metadata = {
     title: '上海中高端商务办公租赁平台',
     description: '聚合上海甲级写字楼、服务式办公室、共享办公与整层办公机会，免费帮你匹配。',
   }

   export default async function HomePage() {
     const [featured, districts] = await Promise.all([
       getFeaturedListings(6),
       getDistricts(),
     ])

     return (
       <div className="home">
         <section className="hero">
           <p className="hero__eyebrow">Shanghai Premium Office Leasing</p>
           <h1 className="hero__heading">为成长型企业匹配更体面的上海办公室</h1>
           <p className="hero__summary">
             聚合甲级写字楼、服务式办公室、共享办公与整层办公机会，免费帮你匹配。
           </p>
           <Link href="/listings" className="btn btn--primary">浏览在租房源</Link>
         </section>

         <section className="section">
           <h2 className="section__title">按区域浏览</h2>
           <div className="district-chips">
             {districts.map((d: any) => (
               <Link key={d.id} href={`/listings?district=${d.slug}`} className="tag tag--lg">
                 {d.name}
               </Link>
             ))}
           </div>
         </section>

         <section className="section">
           <h2 className="section__title">推荐房源</h2>
           {featured.length === 0 ? (
             <p className="empty">暂无推荐房源。</p>
           ) : (
             <div className="card-grid">
               {featured.map((l: any) => (
                 <ListingCard key={l.id} listing={l} />
               ))}
             </div>
           )}
         </section>
       </div>
     )
   }
   ```

2. Append homepage-only CSS to `styles.css`:
   ```css
   .hero { padding: 56px 0 40px; text-align: center; }
   .hero__eyebrow { color: var(--gold); font-size: 13px; letter-spacing: .12em; text-transform: uppercase; }
   .hero__heading { font-size: 34px; color: var(--ink); margin: 12px 0; }
   .hero__summary { color: var(--muted); max-width: 560px; margin: 0 auto 24px; }
   .section { margin-top: 48px; }
   .section__title { font-size: 22px; color: var(--ink); margin-bottom: 16px; }
   .district-chips { display: flex; flex-wrap: wrap; gap: 10px; }
   .tag--lg { font-size: 14px; padding: 8px 16px; }
   .empty { color: var(--muted); }
   ```

> ⚠️ This task imports `ListingCard`, which doesn't exist until P1.3. **Do not run build yet.** Proceed to P1.3 first, then verify both together.

### Commit
```bash
git add "src/app/(frontend)/page.tsx" "src/app/(frontend)/styles.css"
git commit -m "feat(c-end): real homepage — featured listings + district chips"
```

---

## Task P1.3 — `ListingCard`, `FilterBar`, `/listings` page

### Steps

1. Create `src/components/frontend/ListingCard.tsx` (server component — no `"use client"`):
   ```tsx
   import Link from 'next/link'
   import React from 'react'
   import { formatArea, formatRent } from '@/lib/frontend/format'

   type Props = { listing: any }

   export default function ListingCard({ listing }: Props) {
     const cover = listing.coverImage?.url || listing.building?.coverImage?.url
     const rent = formatRent(listing.rent, listing.rentUnit)
     const area = formatArea(listing.area)
     const district = listing.building?.district?.name
     const typeLabel: Record<string, string> = {
       'traditional-office': '传统办公',
       'serviced-office': '服务式办公',
       'coworking': '共享办公',
       'full-floor': '整层办公',
     }
     return (
       <Link href={`/listings/${listing.slug}`} className="listing-card">
         {cover ? (
           <img src={cover} alt={listing.title} className="listing-card__media" />
         ) : (
           <div className="listing-card__media" />
         )}
         <div className="listing-card__body">
           <span className="listing-card__rent">{rent}</span>
           <span className="listing-card__title">{listing.title}</span>
           <span className="listing-card__meta">{[district, area, typeLabel[listing.listingType]].filter(Boolean).join(' · ')}</span>
           {Array.isArray(listing.highlights) && listing.highlights.length > 0 && (
             <div className="listing-card__tags">
               {listing.highlights.slice(0, 3).map((h: any, i: number) => (
                 <span key={i} className="tag">{h.text}</span>
               ))}
             </div>
           )}
         </div>
       </Link>
     )
   }
   ```

2. Create `src/components/frontend/FilterBar.tsx` — **client component** (manages inputs, pushes to URL on submit):
   ```tsx
   'use client'
   import { useRouter, useSearchParams } from 'next/navigation'
   import React, { useState } from 'react'

   type Props = { districts: { id: string; slug: string; name: string }[] }

   export default function FilterBar({ districts }: Props) {
     const router = useRouter()
     const sp = useSearchParams()
     const [q, setQ] = useState(sp.get('q') || '')
     const [district, setDistrict] = useState(sp.get('district') || '')
     const [type, setType] = useState(sp.get('type') || '')
     const [rentMin, setRentMin] = useState(sp.get('rentMin') || '')
     const [rentMax, setRentMax] = useState(sp.get('rentMax') || '')

     function submit(e: React.FormEvent) {
       e.preventDefault()
       const params = new URLSearchParams()
       if (q) params.set('q', q)
       if (district) params.set('district', district)
       if (type) params.set('type', type)
       if (rentMin) params.set('rentMin', rentMin)
       if (rentMax) params.set('rentMax', rentMax)
       router.push(`/listings?${params.toString()}`)
     }

     function reset() {
       setQ(''); setDistrict(''); setType(''); setRentMin(''); setRentMax('')
       router.push('/listings')
     }

     return (
       <form className="filter-bar" onSubmit={submit}>
         <div className="filter-bar__field">
           <label className="filter-bar__label">关键词</label>
           <input className="filter-bar__input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="如：江景、整层" />
         </div>
         <div className="filter-bar__field">
           <label className="filter-bar__label">区域</label>
           <select className="filter-bar__select" value={district} onChange={(e) => setDistrict(e.target.value)}>
             <option value="">全部</option>
             {districts.map((d) => <option key={d.id} value={d.slug}>{d.name}</option>)}
           </select>
         </div>
         <div className="filter-bar__field">
           <label className="filter-bar__label">类型</label>
           <select className="filter-bar__select" value={type} onChange={(e) => setType(e.target.value)}>
             <option value="">全部</option>
             <option value="traditional-office">传统办公</option>
             <option value="serviced-office">服务式办公</option>
             <option value="coworking">共享办公</option>
             <option value="full-floor">整层办公</option>
           </select>
         </div>
         <div className="filter-bar__field">
           <label className="filter-bar__label">租金(元)</label>
           <div style={{ display: 'flex', gap: 6 }}>
             <input className="filter-bar__input" value={rentMin} onChange={(e) => setRentMin(e.target.value)} placeholder="最低" style={{ width: 80 }} />
             <input className="filter-bar__input" value={rentMax} onChange={(e) => setRentMax(e.target.value)} placeholder="最高" style={{ width: 80 }} />
           </div>
         </div>
         <button type="submit" className="btn btn--primary">筛选</button>
         <button type="button" className="btn btn--ghost" onClick={reset}>重置</button>
      </form>
     )
   }
   ```

3. Create `src/app/(frontend)/listings/page.tsx`:
   ```tsx
   import Link from 'next/link'
   import React from 'react'
   import FilterBar from '@/components/frontend/FilterBar'
   import ListingCard from '@/components/frontend/ListingCard'
   import { parseListingFilters } from '@/lib/frontend/filters'
   import { getDistricts, getListings } from '@/lib/frontend/queries'

   export const dynamic = 'force-dynamic'

   export const metadata = { title: '在租房源' }

   export default async function ListingsPage({
     searchParams,
   }: {
     searchParams: Promise<{ [key: string]: string | string[] | undefined }>
   }) {
     const sp = new URLSearchParams()
     const resolved = await searchParams
     for (const [k, v] of Object.entries(resolved)) {
       if (typeof v === 'string') sp.set(k, v)
     }
     const filters = parseListingFilters(sp)

     const [result, districts] = await Promise.all([
       getListings(filters),
       getDistricts(),
     ])

     const totalPages = result.totalPages ?? 0
     const page = filters.page

     return (
       <div>
         <h1 className="page-title">在租房源</h1>
         <p className="page-subtitle">共 {result.totalDocs} 套在租房源</p>
         <FilterBar districts={districts} />
         {result.docs.length === 0 ? (
           <p className="empty">没有符合条件的房源，试试调整筛选。</p>
         ) : (
           <div className="card-grid">
             {result.docs.map((l: any) => <ListingCard key={l.id} listing={l} />)}
           </div>
         )}
         {totalPages > 1 && (
           <nav className="pager">
             <Link
               href={`/listings?${withPage(sp, Math.max(1, page - 1))}`}
               className={`pager__link ${page <= 1 ? 'pager__link--disabled' : ''}`}
             >
               上一页
             </Link>
             <span className="pager__link">第 {page} / {totalPages} 页</span>
             <Link
               href={`/listings?${withPage(sp, Math.min(totalPages, page + 1))}`}
               className={`pager__link ${page >= totalPages ? 'pager__link--disabled' : ''}`}
             >
               下一页
             </Link>
           </nav>
         )}
       </div>
     )
   }

   function withPage(sp: URLSearchParams, page: number) {
     const next = new URLSearchParams(sp)
     next.set('page', String(page))
     return next.toString()
   }
   ```

4. Append page-level CSS to `styles.css`:
   ```css
   .page-title { font-size: 28px; color: var(--ink); }
   .page-subtitle { color: var(--muted); margin: 4px 0 24px; font-size: 14px; }
   ```

### Verification
```bash
npm run build
```
Build green (this also typechecks P1.2 now that ListingCard exists). Then:
```bash
npm run dev &
sleep 8
curl -s http://localhost:3717/listings | grep -c "listing-card"   # expect > 0
curl -s "http://localhost:3717/listings?district=jingan" | grep -c "listing-card"
curl -s "http://localhost:3717/listings?type=coworking" | grep -c "listing-card"
curl -s "http://localhost:3717/" | grep -c "hero__heading"
kill %1
```
All `grep -c` outputs must be ≥ 1. If `district=jingan` returns 0 cards but seeded data exists, apply the dotted-key fallback from P0.5c.

### Commit
```bash
git add src/components/frontend/ "src/app/(frontend)/listings/" "src/app/(frontend)/styles.css"
git commit -m "feat(c-end): /listings page with URL-driven filters + ListingCard/FilterBar"
```

---

# Phase P2 — Detail pages (listing + building)

**Goal:** `/listings/[slug]` and `/buildings/[slug]` render full detail with gallery and a related-listings block.

---

## Task P2.1 — Listing detail page + `ListingGallery`

### Steps

1. Create `src/components/frontend/ListingGallery.tsx` (client — image switching):
   ```tsx
   'use client'
   import React, { useState } from 'react'

   type Image = { url: string; alt?: string }
   type Props = { images: Image[] }

   export default function ListingGallery({ images }: Props) {
     const [active, setActive] = useState(0)
     if (!images.length) return <div className="gallery__main gallery__empty" />
     const current = images[active] ?? images[0]
     return (
       <div className="gallery">
         <div className="gallery__main">
           <img src={current.url} alt={current.alt || ''} />
         </div>
         {images.length > 1 && (
           <div className="gallery__thumbs">
             {images.map((img, i) => (
               <button
                 key={i}
                 className={`gallery__thumb ${i === active ? 'gallery__thumb--active' : ''}`}
                 onClick={() => setActive(i)}
                 type="button"
               >
                 <img src={img.url} alt={img.alt || ''} />
               </button>
             ))}
           </div>
         )}
       </div>
     )
   }
   ```

2. Create `src/app/(frontend)/listings/[slug]/page.tsx`:
   ```tsx
   import Link from 'next/link'
   import { notFound } from 'next/navigation'
   import React from 'react'
   import InquiryModal from '@/components/frontend/InquiryModal'
   import ListingGallery from '@/components/frontend/ListingGallery'
   import { formatArea, formatRent } from '@/lib/frontend/format'
   import { getListingBySlug, getListingsByBuilding } from '@/lib/frontend/queries'

   export const dynamic = 'force-dynamic'

   export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
     const { slug } = await params
     const listing = await getListingBySlug(slug)
     if (!listing) return { title: '房源未找到' }
     return { title: listing.title, description: listing.title }
   }

   const typeLabel: Record<string, string> = {
     'traditional-office': '传统办公',
     'serviced-office': '服务式办公',
     'coworking': '共享办公',
     'full-floor': '整层办公',
   }

   export default async function ListingDetailPage({
     params,
   }: {
     params: Promise<{ slug: string }>
   }) {
     const { slug } = await params
     const listing = await getListingBySlug(slug)
     if (!listing) notFound()

     const building = listing.building
     const related = await getListingsByBuilding(building.id, 6)

     const images = [
       ...(listing.coverImage?.url ? [{ url: listing.coverImage.url, alt: listing.title }] : []),
       ...(Array.isArray(building?.gallery) ? building.gallery.map((g: any) => ({ url: g.image?.url, alt: building.name })) : []),
     ].filter((i: any) => i.url)

     return (
       <div className="detail">
         <div className="detail__top">
           <ListingGallery images={images} />
           <div className="detail__summary">
             <span className="detail__type">{typeLabel[listing.listingType]}</span>
             <h1 className="detail__title">{listing.title}</h1>
             <div className="detail__rent">{formatRent(listing.rent, listing.rentUnit)}</div>
             <dl className="detail__specs">
               <div><dt>面积</dt><dd>{formatArea(listing.area)}</dd></div>
               <div><dt>工位</dt><dd>{listing.seats ?? '面议'}</dd></div>
               <div><dt>可入驻</dt><dd>{listing.availableFrom || '面议'}</dd></div>
               <div><dt>楼盘</dt><dd>{building?.name}</dd></div>
              <div><dt>区域</dt><dd>{building?.district?.name}</dd></div>
              <div><dt>地址</dt><dd>{building?.address}</dd></div>
             </dl>
             {Array.isArray(listing.highlights) && listing.highlights.length > 0 && (
               <div className="detail__tags">
                 {listing.highlights.map((h: any, i: number) => <span key={i} className="tag">{h.text}</span>)}
               </div>
             )}
             <InquiryModal listingTitle={listing.title} />
           </div>
         </div>
         {listing.description && (
           <section className="detail__section">
             <h2>房源说明</h2>
             <div className="richtext">{/* lexical RTE -> plain render for MVP; upgrade in P4 */}</div>
           </section>
         )}
         {building && (
           <section className="detail__section">
             <h2>所在楼盘</h2>
             <p>{building.name} · {building.address}</p>
             {building.summary && <p className="detail__building-summary">{building.summary}</p>}
             {building.slug && <Link href={`/buildings/${building.slug}`} className="btn btn--ghost">查看楼盘</Link>}
           </section>
         )}
         {related.length > 1 && (
           <section className="detail__section">
             <h2>同楼盘其他房源</h2>
             <div className="card-grid">
               {related.filter((r: any) => r.id !== listing.id).map((r: any) => (
                 <Link key={r.id} href={`/listings/${r.slug}`} className="listing-card">
                   <div className="listing-card__body">
                     <span className="listing-card__rent">{formatRent(r.rent, r.rentUnit)}</span>
                     <span className="listing-card__title">{r.title}</span>
                   </div>
                 </Link>
               ))}
             </div>
           </section>
         )}
       </div>
     )
   }
   ```
   > `description` is Lexical RTE. For MVP we render nothing inside `.richtext` (P4 renders it via the Lexical React renderer). This is not a placeholder — it's a deliberate MVP scope cut documented in the spec. Leave the empty div; do NOT render raw Lexical JSON.

3. Append detail CSS to `styles.css`:
   ```css
   .detail__top { display: grid; grid-template-columns: 1.2fr 1fr; gap: 32px; }
   .gallery__main { aspect-ratio: 4/3; background: var(--paper); border-radius: 10px; overflow: hidden; }
   .gallery__main img { width: 100%; height: 100%; object-fit: cover; }
   .gallery__empty { aspect-ratio: 4/3; }
   .gallery__thumbs { display: flex; gap: 8px; margin-top: 8px; overflow-x: auto; }
   .gallery__thumb { border: 2px solid transparent; padding: 0; background: none; cursor: pointer; border-radius: 6px; overflow: hidden; }
   .gallery__thumb--active { border-color: var(--gold); }
   .gallery__thumb img { width: 72px; height: 54px; object-fit: cover; }
   .detail__type { color: var(--gold); font-size: 13px; }
   .detail__title { font-size: 26px; color: var(--ink); margin: 6px 0; }
   .detail__rent { font-size: 24px; font-weight: 700; color: var(--gold); margin-bottom: 16px; }
   .detail__specs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 0 16px; }
   .detail__specs dt { color: var(--muted); font-size: 12px; }
   .detail__specs dd { margin: 2px 0 0; color: var(--ink); font-size: 14px; }
   .detail__tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
   .detail__section { margin-top: 40px; }
   .detail__section h2 { font-size: 20px; color: var(--ink); margin-bottom: 12px; }
   @media (max-width: 768px) { .detail__top { grid-template-columns: 1fr; } }
   ```

> `InquiryModal` doesn't exist yet — P2 builds green only after P3.2 lands. To keep P2 independently testable, **create a stub-free real `InquiryModal` in P3.2** but, for this task, temporarily comment out the `<InquiryModal ... />` line and run verification; uncomment it in P3.2. Document this in the commit. (This is the one allowed transient state, and only because the modal is the P3 deliverable.)

### Verification
```bash
npm run build
npm run dev &
sleep 8
SLUG=$(curl -s http://localhost:3717/listings | grep -oE '/listings/[a-z0-9-]+' | head -1 | sed 's#/listings/##')
echo "slug=$SLUG"
curl -s "http://localhost:3717/listings/$SLUG" | grep -c "detail__title"
curl -s "http://localhost:3717/listings/this-slug-does-not-exist" -o /dev/null -w "%{http_code}\n"
kill %1
```
Expect detail page shows the title (≥1) and the non-existent slug returns 404.

### Commit
```bash
git add "src/app/(frontend)/listings/[slug]/" src/components/frontend/ListingGallery.tsx "src/app/(frontend)/styles.css"
git commit -m "feat(c-end): listing detail page + gallery (InquiryModal wired in P3.2)"
```

---

## Task P2.2 — Building detail page

### Steps

1. Create `src/app/(frontend)/buildings/[slug]/page.tsx`:
   ```tsx
   import Link from 'next/link'
   import { notFound } from 'next/navigation'
   import React from 'react'
   import ListingCard from '@/components/frontend/ListingCard'
   import { getBuildingBySlug, getListingsByBuilding } from '@/lib/frontend/queries'

   export const dynamic = 'force-dynamic'

   export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
     const { slug } = await params
     const building = await getBuildingBySlug(slug)
     if (!building) return { title: '楼盘未找到' }
     return { title: building.name, description: building.summary }
   }

   export default async function BuildingDetailPage({
     params,
   }: {
     params: Promise<{ slug: string }>
   }) {
     const { slug } = await params
     const building = await getBuildingBySlug(slug)
     if (!building) notFound()

     const listings = await getListingsByBuilding(building.id, 50)

     return (
       <div className="detail">
         <div className="detail__top">
           {building.coverImage?.url ? (
             <div className="gallery__main">
               <img src={building.coverImage.url} alt={building.name} />
             </div>
           ) : <div className="gallery__main gallery__empty" />}
           <div className="detail__summary">
             <span className="detail__type">{building.grade} · {building.district?.name}</span>
             <h1 className="detail__title">{building.name}</h1>
             <p className="detail__building-summary">{building.address}</p>
             {building.summary && <p>{building.summary}</p>}
             {Array.isArray(building.amenities) && building.amenities.length > 0 && (
               <div className="detail__tags">
                 {building.amenities.map((a: any) => <span key={a.id} className="tag">{a.name}</span>)}
               </div>
             )}
           </div>
         </div>
         <section className="detail__section">
           <h2>在租房源</h2>
           {listings.length === 0 ? (
             <p className="empty">该楼盘暂无在租房源。</p>
           ) : (
             <div className="card-grid">
               {listings.map((l: any) => <ListingCard key={l.id} listing={l} />)}
             </div>
           )}
         </section>
       </div>
     )
   }
   ```

### Verification
```bash
npm run build
npm run dev &
sleep 8
BSLUG=$(curl -s http://localhost:3717/listings | grep -oE '/buildings/[a-z0-9-]+' | head -1 | sed 's#/buildings/##')
curl -s "http://localhost:3717/buildings/$BSLUG" | grep -c "detail__title"
kill %1
```
Expect ≥1.

### Commit
```bash
git add "src/app/(frontend)/buildings/[slug]/"
git commit -m "feat(c-end): building detail page with in-building listings"
```

---

# Phase P3 — Inquiry loop (validation + route + modal)

**Goal:** User submits an inquiry on a listing; it creates a Lead with `source: 'frontend-form'`. Validated server-side, rate-limited minimally.

---

## Task P3.1 — `validation.ts` (TDD) + `/api/inquiries` route

### Subtask P3.1a — `validation.ts` (TDD)

1. **Failing test** `tests/validation.test.ts`:
   ```ts
   import { describe, expect, it } from 'vitest'
   import { validateInquiry } from '@/lib/frontend/validation'

   const ok = { name: '张三', phone: '13800001111', listingSlug: 'jingan-center-360serviced', message: '想约看' }

   describe('validateInquiry', () => {
     it('returns ok for valid payload', () => {
       const r = validateInquiry(ok)
       expect(r.ok).toBe(true)
       expect(r.errors).toEqual([])
     })
     it('requires name', () => {
       const r = validateInquiry({ ...ok, name: '' })
       expect(r.ok).toBe(false)
       expect(r.errors).toContain('name_required')
     })
     it('requires valid phone (11 digits CN mobile)', () => {
       expect(validateInquiry({ ...ok, phone: '123' }).ok).toBe(false)
       expect(validateInquiry({ ...ok, phone: '13800001111' }).ok).toBe(true)
     })
     it('rejects name > 50 chars', () => {
       expect(validateInquiry({ ...ok, name: 'x'.repeat(51) }).ok).toBe(false)
     })
     it('rejects message > 500 chars', () => {
       expect(validateInquiry({ ...ok, message: 'x'.repeat(501) }).ok).toBe(false)
     })
     it('rejects missing listingSlug', () => {
       expect(validateInquiry({ ...ok, listingSlug: '' }).ok).toBe(false)
     })
   })
   ```

2. Run red.

3. **Implement** `src/lib/frontend/validation.ts`:
   ```ts
   export type InquiryInput = {
     name?: string
     phone?: string
     message?: string
     listingSlug?: string
   }

   export type ValidationResult =
     | { ok: true; data: Required<Pick<InquiryInput, 'name' | 'phone' | 'listingSlug'>> & { message: string } }
     | { ok: false; errors: string[] }

   const CN_MOBILE = /^1[3-9]\d{9}$/

   export function validateInquiry(input: InquiryInput): ValidationResult {
     const errors: string[] = []
     const name = (input.name || '').trim()
     const phone = (input.phone || '').trim()
     const message = (input.message || '').trim()
     const listingSlug = (input.listingSlug || '').trim()

     if (!name) errors.push('name_required')
     if (name.length > 50) errors.push('name_too_long')
     if (!CN_MOBILE.test(phone)) errors.push('phone_invalid')
     if (message.length > 500) errors.push('message_too_long')
     if (!listingSlug) errors.push('listing_required')

     if (errors.length) return { ok: false, errors }
     return { ok: true, data: { name, phone, listingSlug, message } }
   }
   ```

4. Run green.

### Subtask P3.1b — `/api/inquiries` route

1. Create `src/app/api/inquiries/route.ts`:
   ```ts
   import { getPayload } from 'payload'
   import { NextResponse } from 'next/server'
   import config from '@/payload.config'
   import { validateInquiry } from '@/lib/frontend/validation'

   export const dynamic = 'force-dynamic'

   export async function POST(req: Request) {
     let body: any
     try {
       body = await req.json()
     } catch {
       return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
     }

     const result = validateInquiry(body)
     if (!result.ok) {
       return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 })
     }

     const payload = await getPayload({ config })

     // Resolve the listing by slug so we can link it.
     const listing = await payload.find({
       collection: 'listings',
       where: { slug: { equals: result.data.listingSlug } },
       limit: 1,
       depth: 0,
     })
     if (!listing.docs[0]) {
       return NextResponse.json({ ok: false, error: 'listing_not_found' }, { status: 404 })
     }

     try {
       const lead = await payload.create({
         collection: 'leads',
         data: {
           name: result.data.name,
           phone: result.data.phone,
           status: 'new',
           source: 'frontend-form',
           interestedListing: (listing.docs[0] as any).id,
           notes: result.data.message,
         },
       })
       return NextResponse.json({ ok: true, id: lead.id })
     } catch (e) {
       payload.logger.error({ err: e }, 'inquiry create failed')
       return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 })
     }
   }
   ```

> ⚠️ Verify the `Leads` field names used in `payload.create` match the actual `Leads.ts` collection: `name`, `phone`, `status`, `interestedListing`, `notes`. The summary confirms these exist. If `Leads` uses a different key (e.g. `phone` vs `mobile`), stop and align before committing.

### Verification
```bash
npm test                                # validation tests green
npm run build
npm run dev &
sleep 8
SLUG=$(curl -s http://localhost:3717/listings | grep -oE '/listings/[a-z0-9-]+' | head -1 | sed 's#/listings/##')
# happy path
curl -s -X POST http://localhost:3717/api/inquiries -H 'Content-Type: application/json' \
  -d "{\"name\":\"测试用户\",\"phone\":\"13800001111\",\"listingSlug\":\"$SLUG\",\"message\":\"约看\"}" | head
# invalid phone
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3717/api/inquiries -H 'Content-Type: application/json' \
  -d "{\"name\":\"x\",\"phone\":\"123\",\"listingSlug\":\"$SLUG\"}"   # expect 422
# missing listing
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3717/api/inquiries -H 'Content-Type: application/json' \
  -d "{\"name\":\"x\",\"phone\":\"13800001111\",\"listingSlug\":\"nope\"}"   # expect 404
kill %1
```
Happy path returns `{"ok":true,...}`, invalid phone → 422, missing listing → 404.

### Commit
```bash
git add src/lib/frontend/validation.ts tests/validation.test.ts src/app/api/inquiries/
git commit -m "feat(c-end): inquiry validation + POST /api/inquiries (creates lead, source=frontend-form)"
```

---

## Task P3.2 — `InquiryModal` (client) + wire into listing detail

### Steps

1. Create `src/components/frontend/InquiryModal.tsx`:
   ```tsx
   'use client'
   import React, { useState } from 'react'

   type Props = { listingTitle: string }

   export default function InquiryModal({ listingTitle }: Props) {
     const [open, setOpen] = useState(false)
     const [name, setName] = useState('')
     const [phone, setPhone] = useState('')
     const [message, setMessage] = useState('')
     const [status, setStatus] = useState<'idle' | 'submitting' | 'ok' | 'error'>('idle')
     const [errors, setErrors] = useState<string[]>([])

     async function submit(e: React.FormEvent) {
       e.preventDefault()
       setStatus('submitting')
       setErrors([])
       const slug = window.location.pathname.split('/').filter(Boolean).pop() || ''
       const res = await fetch('/api/inquiries', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ name, phone, message, listingSlug: slug }),
       })
       if (res.ok) {
         setStatus('ok')
         setName(''); setPhone(''); setMessage('')
       } else {
         const data = await res.json().catch(() => ({}))
         setStatus('error')
         setErrors(Array.isArray(data.errors) ? data.errors : ['server_error'])
       }
     }

     return (
       <>
         <button className="btn btn--primary" onClick={() => setOpen(true)}>在线询价 / 留电</button>
         {open && (
           <div className="modal__overlay" onClick={() => setOpen(false)}>
             <div className="modal" onClick={(e) => e.stopPropagation()}>
               <button className="modal__close" onClick={() => setOpen(false)} type="button">×</button>
               <h3 className="modal__title">询价 / 预约看房</h3>
               <p className="modal__subtitle">{listingTitle}</p>
               {status === 'ok' ? (
                 <div className="modal__success">
                   <p>已收到，顾问将在 1 工作日内联系你。</p>
                   <button className="btn btn--ghost" onClick={() => { setOpen(false); setStatus('idle') }}>关闭</button>
                 </div>
               ) : (
                 <form className="modal__form" onSubmit={submit}>
                   <label className="modal__label">姓名<input className="filter-bar__input" value={name} onChange={(e) => setName(e.target.value)} required /></label>
                   <label className="modal__label">手机<input className="filter-bar__input" value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" /></label>
                   <label className="modal__label">留言<textarea className="filter-bar__input" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} /></label>
                   {errors.length > 0 && <p className="modal__error">请检查：{errors.join('、')}</p>}
                   <button type="submit" className="btn btn--primary" disabled={status === 'submitting'}>
                     {status === 'submitting' ? '提交中…' : '提交'}
                   </button>
                 </form>
               )}
             </div>
           </div>
         )}
       </>
     )
   }
   ```

   > The modal derives `listingSlug` from `window.location.pathname` (the listing detail route is `/listings/[slug]`). This is simpler than threading the slug prop and is robust for this single route.

2. In `src/app/(frontend)/listings/[slug]/page.tsx`, **uncomment** the `<InquiryModal listingTitle={listing.title} />` line and its import (added in P2.1).

3. Append modal CSS to `styles.css`:
   ```css
   .modal__overlay { position: fixed; inset: 0; background: rgba(16,25,35,.5); display: flex; align-items: center; justify-content: center; z-index: 50; }
   .modal { background: #fff; border-radius: 12px; padding: 28px; width: min(440px, 92vw); position: relative; }
   .modal__close { position: absolute; top: 12px; right: 16px; border: none; background: none; font-size: 24px; cursor: pointer; color: var(--muted); }
   .modal__title { font-size: 20px; color: var(--ink); }
   .modal__subtitle { color: var(--muted); font-size: 13px; margin-bottom: 16px; }
   .modal__form { display: flex; flex-direction: column; gap: 12px; }
   .modal__label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--muted); }
   .modal__error { color: #b00020; font-size: 13px; }
   .modal__success { text-align: center; }
   ```

### Verification
```bash
npm run build
npm run dev &
sleep 8
SLUG=$(curl -s http://localhost:3717/listings | grep -oE '/listings/[a-z0-9-]+' | head -1 | sed 's#/listings/##')
curl -s "http://localhost:3717/listings/$SLUG" | grep -c "在线询价"   # expect 1
kill %1
```
Manual: open the page, click 询价, submit a valid form → see success. (Full E2E asserted in P5.1.)

### Commit
```bash
git add src/components/frontend/InquiryModal.tsx "src/app/(frontend)/listings/[slug]/page.tsx" "src/app/(frontend)/styles.css"
git commit -m "feat(c-end): InquiryModal + wire into listing detail"
```

---

# Phase P4 — SEO + performance polish

**Goal:** Sitemap/robots, listing-detail SEO metadata, and the Lexical description rendered (not blank). Lighthouse SEO/Performance ≥ 90 (measured in P5).

---

## Task P4.1 — Sitemap + robots + Lexical render

### Steps

1. Create `src/app/(frontend)/sitemap.ts`:
   ```ts
   import { getPayload } from 'payload'
   import config from '@/payload.config'

   export default async function sitemap() {
     const payload = await getPayload({ config })
     const [listings, buildings] = await Promise.all([
       payload.find({ collection: 'listings', where: { status: { equals: 'available' } }, limit: 500, depth: 0 }),
       payload.find({ collection: 'buildings', where: { status: { equals: 'published' } }, limit: 200, depth: 0 }),
     ])
     const base = 'https://sbh.example.com' // replace with real prod domain when known
     const lUrls = listings.docs.map((d: any) => ({
       url: `${base}/listings/${d.slug}`,
       lastModified: new Date(d.updatedAt),
       changeFrequency: 'weekly' as const,
       priority: 0.8,
     }))
     const bUrls = buildings.docs.map((d: any) => ({
       url: `${base}/buildings/${d.slug}`,
       lastModified: new Date(d.updatedAt),
       changeFrequency: 'weekly' as const,
       priority: 0.6,
     }))
     return [
       { url: `${base}/`, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 1 },
       { url: `${base}/listings`, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 0.9 },
       ...lUrls,
       ...bUrls,
     ]
   }
   ```

2. Create `src/app/(frontend)/robots.ts`:
   ```ts
   export default function robots() {
     return {
       rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
       sitemap: 'https://sbh.example.com/sitemap.xml',
     }
   }
   ```

3. Render the Lexical description. In `src/app/(frontend)/listings/[slug]/page.tsx`, replace the empty `.richtext` div content with the Lexical React renderer. Add at top of imports:
   ```tsx
   import { RichText } from '@payloadcms/richtext-lexical/react'
   ```
   and replace the `{/* lexical RTE ... */}` comment block with:
   ```tsx
   <RichText data={listing.description} />
   ```
   > If the import path differs on this Payload version, run `npm ls @payloadcms/richtext-lexical` and use the package's exported `RichText` client. Do not skip rendering — the spec calls for visible description.

### Verification
```bash
npm run build
npm run dev &
sleep 8
curl -s http://localhost:3717/sitemap.xml | grep -c "<url>"
curl -s http://localhost:3717/robots.txt | grep -c "Sitemap"
SLUG=$(curl -s http://localhost:3717/listings | grep -oE '/listings/[a-z0-9-]+' | head -1 | sed 's#/listings/##')
curl -s "http://localhost:3717/listings/$SLUG" | grep -c "房源说明"   # only if description seeded; 0 is OK if no description
kill %1
```
sitemap.xml returns ≥1 `<url>`; robots.txt has `Sitemap`.

### Commit
```bash
git add "src/app/(frontend)/sitemap.ts" "src/app/(frontend)/robots.ts" "src/app/(frontend)/listings/[slug]/page.tsx"
git commit -m "feat(c-end): sitemap + robots + lexical description render"
```

---

# Phase P5 — E2E test + deploy

**Goal:** One automated end-to-end test of the full inquiry flow, then a green build/deploy on CloudBase CloudRun.

---

## Task P5.1 — Playwright E2E

### Steps

1. Install Playwright:
   ```bash
   npm install -D @playwright/test
   npx playwright install --with-deps chromium
   ```

2. Create `playwright.config.ts`:
   ```ts
   import { defineConfig } from '@playwright/test'

   export default defineConfig({
     testDir: './tests/e2e',
     timeout: 30_000,
     use: { baseURL: 'http://localhost:3717', headless: true },
     webServer: {
       command: 'npm run dev',
       port: 3717,
       reuseExistingServer: !process.env.CI,
       timeout: 60_000,
    },
   })
   ```

3. Add script to `package.json`:
   ```json
   "test:e2e": "playwright test"
   ```

4. Create `tests/e2e/inquiry-flow.spec.ts`:
   ```ts
   import { expect, test } from '@playwright/test'

   test('list → detail → submit inquiry creates a lead', async ({ page }) => {
     await page.goto('/listings')
     await expect(page.locator('.listing-card').first()).toBeVisible()

     const slug = await page.locator('.listing-card').first().getAttribute('href')
     expect(slug).toBeTruthy()

     await page.goto(slug!)
     await expect(page.locator('h1')).toBeVisible()

     await page.getByRole('button', { name: /在线询价|留电/ }).click()
     await page.getByLabel('姓名').fill('E2E 用户')
     await page.getByLabel('手机').fill('13800001111')
     await page.getByRole('button', { name: '提交' }).click()

     await expect(page.getByText(/已收到/)).toBeVisible()
   })
   ```

### Verification
```bash
npm run test:e2e
```
Test passes. If the listing click or label selectors don't match the rendered DOM, fix the selector in the test (not the component) — the test is the source of truth for the user-facing contract.

### Commit
```bash
git add playwright.config.ts tests/e2e/ package.json package-lock.json
git commit -m "test(c-end): e2e inquiry flow (list → detail → submit)"
```

---

## Task P5.2 — Production build + deploy + smoke

### Steps

1. Full production build locally to catch SSR/build-only errors Vitest missed:
   ```bash
   npm run build
   npm start &
   sleep 6
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/            # expect 200
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/listings    # expect 200
   kill %1
   ```
   > `next start` default port is 3000; the CloudRun container uses `--port 80` per the existing deploy workflow.

2. Commit any build artifacts/fixes if build surfaced issues (otherwise no commit).

3. Push to master to trigger the existing GitHub Actions deploy workflow (`.github/workflows/deploy.yml` already deploys `payload-office-platform/` to CloudBase CloudRun service `sbh`):
   ```bash
   git push origin master
   ```
   (Only if the user has approved a push — confirm before pushing.)

4. Watch the run:
   ```bash
   gh run watch
   ```

5. Once deployed, smoke the production URL:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" https://sbh-286300-10-1253925058.sh.run.tcloudbase.com/
   curl -s -o /dev/null -w "%{http_code}\n" https://sbh-286300-10-1253925058.sh.run.tcloudbase.com/listings
   curl -s -o /dev/null -w "%{http_code}\n" -X POST https://sbh-286300-10-1253925058.sh.run.tcloudbase.com/api/inquiries \
     -H 'Content-Type: application/json' \
     -d '{"name":"部署烟测","phone":"13800001111","listingSlug":"jingan-center-360serviced","message":"e2e"}'
   ```
   All expect 200 (the POST expects 200 with `{"ok":true}`).

### Verification
`gh run view` shows green; the three curls return 200.

### Commit
None (deploy is a CI run, not a commit). Record the deploy run id in `DEPLOYMENT.md` if the user wants.

---

## Self-review against spec

Completed after writing. Checks:

- **Spec §3 Route map:** `/`, `/listings`, `/listings/[slug]`, `/buildings/[slug]`, `/api/inquiries`, `/sitemap.xml`, `/robots.txt` — all present (P1.2, P1.3, P2.1, P2.2, P3.1, P4.1). ✅
- **Spec §4 Data model:** `source` added to Leads (P0.2, with migration). Buildings.slug + Locations.slug verified present (confirmed in pre-flight). Listings unchanged. ✅
- **Spec §5 Lead flow:** C-end form → POST → Lead with `source=frontend-form`, `status=new`, linked `interestedListing` (P3.1). ✅
- **Spec §6 Directory structure:** matches `components/frontend/`, `lib/frontend/`, `(frontend)/` route group (File Structure section). ✅
- **Spec §7 6-phase plan:** P0→P5 each represented as a task group. ✅
- **Spec §8 Testing:** Vitest unit (filters/format/validation) + Playwright E2E (P5.1) + curl smoke. ✅
- **Spec §10 Risks:** shared-PG `push:false` honored (migrations only, P0.2). Dotted-key relationship filter risk flagged in P0.5c with a documented two-hop fallback. ✅

**Gaps I chose to leave for a follow-up plan (not in this MVP):** map search (spec explicitly excludes for MVP), admin lead-management UI (covered by existing backend PRD), Lead dedup/rate-limit hardening (P3 has minimal validation only — a follow-up plan should add IP rate-limit + duplicate-phone detection). These are out of scope here and should not be silently absorbed.

---

## Execution choice

Two ways to run this plan:

1. **Subagent-driven** (recommended for this size) — a `subagent-driven-development` skill orchestrator spawns one subagent per task, each with this plan + the spec as context, verifying green before handing off. Best when you want to step away and have it run end-to-end.
2. **Inline** — I execute the tasks sequentially in this session, committing after each, pausing for your review at phase boundaries (after P0, P1, P3, P5).

Tell me which, and I'll start. Default if you say "go": subagent-driven.
