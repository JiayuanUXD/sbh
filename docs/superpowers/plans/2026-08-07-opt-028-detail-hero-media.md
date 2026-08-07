# OPT-028 Detail Request and Hero Media Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce repeat listing-detail work and prevent unnecessary hero video downloads while preserving the existing visual fallback and business behavior.

**Architecture:** Add tagged caching for detail recommendations, route metadata/page reads through existing cached queries, and parallelize independent detail dependencies. Replace the inline video source with a small client component driven by a pure eligibility function, a generated WebP poster, reduced-motion, data-saver, viewport, and idle checks.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, ffmpeg asset conversion, pnpm.

## Global Constraints

- Detail visibility must continue to use the unified effective-supply query and return 404 for invalid supply.
- Cache lifetime is at most 300 seconds and uses listings/buildings category tags.
- Mobile, reduced-motion, and save-data paths must not request `/hero/bg.mp4`.
- No database or Collection changes.
- Preserve all OPT-025–OPT-027 work.
- Do not commit, push, create a PR, or deploy without separate explicit user authorization.

---

## File Map

- Create `specs/work-items/OPT-028-detail-hero-media.md`: Task Packet.
- Create `src/components/frontend/HeroBackgroundMedia.tsx`: progressive video loader.
- Create `src/lib/frontend/hero-media.ts`: pure eligibility function and connection type guard.
- Create `public/hero/poster.webp`: deterministic first-frame fallback.
- Modify `src/lib/frontend/cached-queries.ts`: cache detail recommendations and ensure detail caches use 300-second ceilings.
- Modify `src/app/(frontend)/listings/[slug]/page.tsx`: cached reads and parallel dependencies.
- Modify `src/app/(frontend)/page.tsx`: render `HeroBackgroundMedia`.
- Modify `src/app/(frontend)/styles.css`: poster/video fill and reduced-motion fallback styling.
- Create `tests/detail-hero-performance.test.ts`: pure helper and route/component contracts.
- Create `artifacts/verification/OPT-028/README.md`: verification evidence.

### Task 1: Establish failing detail/media tests

**Files:**
- Create: `specs/work-items/OPT-028-detail-hero-media.md`
- Create: `tests/detail-hero-performance.test.ts`

**Interfaces:**
- Produces failure evidence for `shouldLoadHeroVideo` and cached detail route wiring.

- [ ] **Step 1: Create the Task Packet**

Record first/warm detail timings, the duplicate current-listing reads, the 1.2 MB video request, exact routes/viewports, and explicit no-schema scope.

- [ ] **Step 2: Write pure video eligibility tests**

```ts
describe('shouldLoadHeroVideo', () => {
  it.each([
    [{ desktop: false, reducedMotion: false, saveData: false }, false],
    [{ desktop: true, reducedMotion: true, saveData: false }, false],
    [{ desktop: true, reducedMotion: false, saveData: true }, false],
    [{ desktop: true, reducedMotion: false, saveData: false }, true],
  ] as const)('evaluates %o', (input, expected) => {
    expect(shouldLoadHeroVideo(input)).toBe(expected)
  })
})
```

- [ ] **Step 3: Add route/component contracts**

Assert the detail route imports `getCachedListingBySlug`, `getCachedBuildingBySlug`, and `getCachedDetailRecommendations`; it uses one `Promise.all` after the listing check; homepage renders `<HeroBackgroundMedia />` and has no literal `<source src="/hero/bg.mp4"`; the client component only inserts `/hero/bg.mp4` after eligibility/idle scheduling and declares `/hero/poster.webp`.

- [ ] **Step 4: Run and capture failures**

```bash
pnpm exec vitest run tests/detail-hero-performance.test.ts
```

Expected: FAIL because helper, component, recommendation cache, and route wiring do not exist.

### Task 2: Cache and parallelize listing detail dependencies

**Files:**
- Modify: `src/lib/frontend/cached-queries.ts`
- Modify: `src/app/(frontend)/listings/[slug]/page.tsx`

**Interfaces:**
- Produces: `getCachedDetailRecommendations(listingSlug: string, limit?: number)`.
- Consumes: `getCachedListingBySlug`, `getCachedBuildingBySlug`, existing category tags.

- [ ] **Step 1: Add recommendation cache**

Import `getDetailRecommendations` and add:

```ts
export const getCachedDetailRecommendations = unstable_cache(
  async (listingSlug: string, limit: number = 6) =>
    getDetailRecommendations(listingSlug, defaultCtx(), { limit }),
  ['detail-recommendations'],
  {
    tags: [LISTINGS_CATEGORY_TAG, BUILDINGS_CATEGORY_TAG],
    revalidate: 300,
  },
)
```

Add `revalidate: 300` to the listing-by-slug and building-by-slug caches if OPT-027 has not already done so.

- [ ] **Step 2: Route all detail reads through caches**

Use `getCachedListingBySlug(slug)` in both metadata and page. After `notFound`, load independent work together:

```ts
const [buildingDetail, recommendations, pois, serviceSchedule] = await Promise.all([
  building ? getCachedBuildingBySlug(building.slug) : Promise.resolve(null),
  getCachedDetailRecommendations(slug, 6),
  fetchNearbyPois(building?.id ?? 0, building?.coordinates),
  getServiceSchedule(),
])
```

Keep all DTO rendering, inquiry snapshots, JSON-LD, 404 behavior, and recommendation output unchanged.

- [ ] **Step 3: Run focused detail tests**

```bash
pnpm exec vitest run tests/detail-hero-performance.test.ts tests/public-catalog-page.test.ts tests/public-catalog-effective-supply-consistency.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected: detail contracts pass; media contracts remain failing until Task 3.

### Task 3: Add progressive hero media

**Files:**
- Create: `src/lib/frontend/hero-media.ts`
- Create: `src/components/frontend/HeroBackgroundMedia.tsx`
- Create: `public/hero/poster.webp`
- Modify: `src/app/(frontend)/page.tsx`
- Modify: `src/app/(frontend)/styles.css`

**Interfaces:**
- Produces: `shouldLoadHeroVideo(input: HeroVideoEligibility): boolean`.
- Produces: default server-safe `HeroBackgroundMedia` client component.

- [ ] **Step 1: Implement the pure decision helper**

```ts
export type HeroVideoEligibility = Readonly<{
  desktop: boolean
  reducedMotion: boolean
  saveData: boolean
}>

export function shouldLoadHeroVideo(input: HeroVideoEligibility): boolean {
  return input.desktop && !input.reducedMotion && !input.saveData
}
```

Define a local guarded connection shape in the component:

```ts
type NavigatorWithConnection = Navigator & {
  connection?: { readonly saveData?: boolean }
}
```

- [ ] **Step 2: Implement idle video loading**

The client component initializes `source` as `null`, evaluates desktop/reduced-motion/save-data in `useEffect`, and schedules `setSource('/hero/bg.mp4')` with `requestIdleCallback` when available or a 1,500 ms timeout fallback. Cleanup must cancel the idle callback/timeout. Render:

```tsx
<video autoPlay muted loop playsInline preload="none" poster="/hero/poster.webp">
  {source ? <source src={source} type="video/mp4" /> : null}
</video>
```

Do not access `window` or `navigator` during render.

- [ ] **Step 3: Generate the poster deterministically**

Run:

```bash
ffmpeg -y -ss 00:00:00.500 -i public/hero/bg.mp4 -frames:v 1 -vf "scale=1600:-2" -quality 75 public/hero/poster.webp
```

Expected: `public/hero/poster.webp` exists, is visually representative, and is materially smaller than 1.2 MB. Inspect it before retaining it; if ffmpeg is unavailable, stop this task and report the missing local dependency rather than fabricating an asset.

- [ ] **Step 4: Wire homepage and fallback styles**

Replace the inline video block with `<HeroBackgroundMedia />`. Ensure `.hero__bg`, its `<video>`, and poster fallback all cover the same area with `object-fit: cover`; do not change hero copy, search, CTA, scrim, or layout dimensions.

- [ ] **Step 5: Run focused tests**

```bash
pnpm exec vitest run tests/detail-hero-performance.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

### Task 4: Full and browser verification

**Files:**
- Create: `artifacts/verification/OPT-028/README.md`
- Modify: `specs/work-items/OPT-028-detail-hero-media.md`

- [ ] **Step 1: Run full gates**

```bash
pnpm test
pnpm build
```

Expected: exit 0 under Node 22.

- [ ] **Step 2: Measure listing detail**

Record first plus five warm requests for a valid listing detail. Confirm metadata, JSON-LD, building summary, recommendations, POIs, and inquiry actions remain present and the warm response improves without visibility drift.

- [ ] **Step 3: Verify media network behavior**

At 375×812 verify `/hero/bg.mp4` is never requested. At 1440×900 verify poster renders immediately and video is requested only after the idle delay. Emulate reduced motion and data saver separately; each must retain the poster and make no video request.

- [ ] **Step 4: Complete four-viewport and adjacent-route checks**

Verify homepage, listing detail, one building detail, keyboard navigation, reduced motion, image fallback, and console at 375×812, 768×1024, 1440×900, and 1920×1080.

- [ ] **Step 5: Record evidence**

Write commands, timings, poster size, screenshots/network observations, console status, and the remaining cold recommendation limitation. Update the Task Packet; do not commit.
