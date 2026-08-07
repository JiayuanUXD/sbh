# OPT-027 Homepage and Sitemap Cache Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache homepage and sitemap database work for at most five minutes while actively invalidating article and page content changes.

**Architecture:** Route the homepage through the existing tagged cache, cache sitemap data loading with shared public category tags, and add reusable Payload collection hooks that call Next cache invalidation with structured failure logging. Existing supply-domain events remain authoritative for listing/building/location changes.

**Tech Stack:** Next.js 16, Payload CMS 3.86 collection hooks, TypeScript, Vitest, pnpm.

## Global Constraints

- Cache lifetime is exactly `revalidate: 300`; event invalidation is the primary freshness mechanism.
- Content invalidation failure must be logged without rolling back a successful CMS write.
- Do not add or change fields, indexes, constraints, or migration files.
- Preserve OPT-025 and completed OPT-026 changes.
- Do not commit, push, create a PR, or deploy without separate explicit user authorization.

---

## File Map

- Create `specs/work-items/OPT-027-home-sitemap-cache.md`: Task Packet.
- Create `src/collections/hooks/revalidate-public-content.ts`: reusable article/page cache Hook factory.
- Modify `src/domain/public-catalog/cache-tags.ts`: export category tags instead of duplicating literals.
- Modify `src/domain/public-catalog/cache-invalidator.ts`: consume exported category constants.
- Modify `src/lib/frontend/cached-queries.ts`: consume shared constants and set homepage TTL.
- Modify `src/app/(frontend)/page.tsx`: use `getCachedHomepage`.
- Modify `src/app/(frontend)/sitemap.ts`: cache expensive data loading.
- Modify `src/collections/Articles.ts`: attach homepage invalidation hooks.
- Modify `src/collections/Pages.ts`: attach pages/sitemap invalidation hooks.
- Create `tests/public-content-cache-hooks.test.ts`: tag and error-path unit tests.
- Create `tests/home-sitemap-performance-contract.test.ts`: route/cache contract.
- Create `artifacts/verification/OPT-027/README.md`: verification evidence.

### Task 1: Add failing cache and Hook tests

**Files:**
- Create: `specs/work-items/OPT-027-home-sitemap-cache.md`
- Create: `tests/public-content-cache-hooks.test.ts`
- Create: `tests/home-sitemap-performance-contract.test.ts`

**Interfaces:**
- Produces failure evidence for `createPublicContentCacheHooks(tags)` and route wiring.

- [ ] **Step 1: Create the Task Packet**

Record baseline homepage 0.536–0.599 seconds and sitemap 1.16–1.26 seconds, no schema changes, content freshness risk, and the exact test/browser gates.

- [ ] **Step 2: Test successful Hook invalidation**

Mock `next/cache` before importing the Hook module:

```ts
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

it('invalidates every configured content tag with the max profile', async () => {
  const hooks = createPublicContentCacheHooks([homeTag('shanghai'), SITEMAP_TAG])
  const req = createHookRequest()
  await hooks.afterChange({ req, operation: 'update' } as CollectionAfterChangeArgs)
  expect(revalidateTag).toHaveBeenNthCalledWith(1, homeTag('shanghai'), 'max')
  expect(revalidateTag).toHaveBeenNthCalledWith(2, SITEMAP_TAG, 'max')
})
```

Use a typed minimal helper returning only the `req.payload.logger.error` contract needed by the module; external values must remain `unknown`, with no `any` or ts-ignore.

- [ ] **Step 3: Test failure logging without rejection**

```ts
it('logs invalidation failures without rejecting the CMS write', async () => {
  vi.mocked(revalidateTag).mockImplementationOnce(() => { throw new Error('cache unavailable') })
  const error = vi.fn()
  const hooks = createPublicContentCacheHooks([SITEMAP_TAG])
  await expect(hooks.afterDelete({ req: createHookRequest(error) } as CollectionAfterDeleteArgs)).resolves.toBeUndefined()
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ msg: 'public_content_cache_invalidation_failed', tag: SITEMAP_TAG }))
})
```

- [ ] **Step 4: Add source contracts**

Assert homepage imports/calls `getCachedHomepage`, sitemap declares `unstable_cache` with `SITEMAP_TAG` and `revalidate: 300`, Articles attaches article hooks, Pages attaches page hooks, and no direct `getHomepage(ctx)` remains in the homepage route.

- [ ] **Step 5: Run and capture failures**

```bash
pnpm exec vitest run tests/public-content-cache-hooks.test.ts tests/home-sitemap-performance-contract.test.ts
```

Expected: FAIL because Hook factory and route wiring do not exist.

### Task 2: Centralize category tags and implement content Hooks

**Files:**
- Modify: `src/domain/public-catalog/cache-tags.ts`
- Modify: `src/domain/public-catalog/cache-invalidator.ts`
- Modify: `src/lib/frontend/cached-queries.ts`
- Create: `src/collections/hooks/revalidate-public-content.ts`

**Interfaces:**
- Produces constants `LISTINGS_CATEGORY_TAG`, `BUILDINGS_CATEGORY_TAG`, `PAGES_CATEGORY_TAG`.
- Produces `createPublicContentCacheHooks(tags): { afterChange; afterDelete }`.

- [ ] **Step 1: Export exact category constants**

Add to `cache-tags.ts`:

```ts
export const LISTINGS_CATEGORY_TAG = `${PUBLIC_CACHE_TAG_PREFIX}:listings` as const
export const BUILDINGS_CATEGORY_TAG = `${PUBLIC_CACHE_TAG_PREFIX}:buildings` as const
export const PAGES_CATEGORY_TAG = `${PUBLIC_CACHE_TAG_PREFIX}:pages` as const
```

Use these constants in `ALL_PUBLIC_CACHE_TAG_GROUPS`, `cache-invalidator.ts`, and `cached-queries.ts`; remove only the now-duplicated local declarations.

- [ ] **Step 2: Implement the Hook factory**

Create `revalidate-public-content.ts`:

```ts
import { revalidateTag } from 'next/cache'
import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

type PublicContentCacheHooks = Readonly<{
  afterChange: CollectionAfterChangeHook
  afterDelete: CollectionAfterDeleteHook
}>

export function createPublicContentCacheHooks(tags: readonly string[]): PublicContentCacheHooks {
  async function invalidate(req: Parameters<CollectionAfterChangeHook>[0]['req']): Promise<void> {
    for (const tag of tags) {
      try {
        revalidateTag(tag, 'max')
      } catch (error: unknown) {
        req.payload.logger.error({
          msg: 'public_content_cache_invalidation_failed',
          tag,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return {
    afterChange: async ({ req }) => invalidate(req),
    afterDelete: async ({ req }) => invalidate(req),
  }
}
```

If Payload's generated Hook request types differ, use the named Payload request type that both hooks share; do not cast through `any`.

- [ ] **Step 3: Run Hook and existing invalidator tests**

```bash
pnpm exec vitest run tests/public-content-cache-hooks.test.ts tests/public-catalog-cache-invalidator.test.ts tests/cache-next-adapter-integration.test.ts
```

Expected: PASS.

### Task 3: Wire homepage, sitemap, Articles, and Pages

**Files:**
- Modify: `src/app/(frontend)/page.tsx`
- Modify: `src/app/(frontend)/sitemap.ts`
- Modify: `src/lib/frontend/cached-queries.ts`
- Modify: `src/collections/Articles.ts`
- Modify: `src/collections/Pages.ts`

**Interfaces:**
- Consumes shared category tags and `createPublicContentCacheHooks`.
- Produces a cached homepage and cached sitemap data loader.

- [ ] **Step 1: Cache the homepage**

Add `revalidate: 300` to `getCachedHomepage`. Replace direct facade imports/call in the homepage route with:

```ts
import { getCachedHomepage } from '@/lib/frontend/cached-queries'

const {
  featuredListings,
  districts,
  featuredBuildings,
  districtCards,
  latestArticles,
} = await getCachedHomepage()
```

- [ ] **Step 2: Attach collection hooks**

At module scope:

```ts
const articleCacheHooks = createPublicContentCacheHooks([homeTag('shanghai')])
const pageCacheHooks = createPublicContentCacheHooks([PAGES_CATEGORY_TAG, SITEMAP_TAG])
```

Configure Articles and Pages respectively:

```ts
hooks: {
  afterChange: [articleCacheHooks.afterChange],
  afterDelete: [articleCacheHooks.afterDelete],
},
```

Use `pageCacheHooks` in Pages. Keep existing access, trash, admin configuration, and fields unchanged.

- [ ] **Step 3: Cache sitemap data loading**

Extract the existing three-way database load into `loadSitemapEntities`, then wrap it:

```ts
const getCachedSitemapEntities = unstable_cache(
  loadSitemapEntities,
  ['public-sitemap-entities'],
  {
    tags: [SITEMAP_TAG, LISTINGS_CATEGORY_TAG, BUILDINGS_CATEGORY_TAG, PAGES_CATEGORY_TAG],
    revalidate: 300,
  },
)
```

The default `sitemap()` calls `getCachedSitemapEntities()` and performs the existing URL mapping unchanged. Do not cache `new Date()` placeholders separately and do not change entity limits or effective-supply access.

- [ ] **Step 4: Run focused tests and type generation**

```bash
pnpm exec payload generate:types
pnpm exec tsc --noEmit --pretty false
pnpm exec vitest run tests/public-content-cache-hooks.test.ts tests/home-sitemap-performance-contract.test.ts tests/fp-06-content-seo-cache-acceptance.test.ts tests/cache-next-adapter-integration.test.ts
```

Expected: all pass; generated type diff is empty or limited to deterministic generator formatting. Do not retain unrelated generated changes.

### Task 4: Verify freshness and performance

**Files:**
- Create: `artifacts/verification/OPT-027/README.md`
- Modify: `specs/work-items/OPT-027-home-sitemap-cache.md`

- [ ] **Step 1: Run full gates**

```bash
pnpm test
pnpm build
```

Expected: exit 0 under Node 22.

- [ ] **Step 2: Measure production routes**

Record cold plus five warm samples for `/` and `/sitemap.xml`. Expected warm TTFB is within 200–300 ms and sitemap content remains equivalent.

- [ ] **Step 3: Verify browser and CMS invalidation**

Check homepage at all four viewports and console, then create/update a disposable draft/published article and page only if an isolated local database is in use. Verify the expected tags are invalidated and the new content state appears within the target window. Do not mutate shared or production data.

- [ ] **Step 4: Record evidence**

Write exact commands, generated-type result, timings, tag observations, routes, and any unverified CMS path to the evidence file. Update only completed Task Packet boxes; do not commit.
