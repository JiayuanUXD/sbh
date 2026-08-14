# Public Page Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize `/listings` and `/news` so local cold-page combinations share reusable work and future article volume does not degrade list/detail rendering.

**Architecture:** Keep the existing Public Catalog facade boundary. Add a reusable listing search source cache that strips page number from the expensive cache key, add tagged article caches for `/news` and `/news/[slug]`, and add safe PostgreSQL indexes for article/listing public query predicates.

**Tech Stack:** Next.js App Router, Payload local API, PostgreSQL migrations, Vitest, TypeScript.

## Global Constraints

- Do not change the Node environment.
- Keep public catalog visibility semantics unchanged.
- Do not expose raw Payload documents to frontend components.
- Use TDD: write failing tests before production changes.
- Do not auto-commit this optimization unless the user asks.

---

### Task 1: Listing shared search-source cache

**Files:**
- Modify: `tests/listings-query-prefetch-performance.test.ts`
- Modify: `src/domain/public-catalog/facade.ts`
- Modify: `src/domain/public-catalog/index.ts`
- Modify: `src/lib/frontend/cached-queries.ts`

**Interfaces:**
- Produces: `buildListingSearchSource(input, ctx, adapter?)`
- Produces: `paginateListingSearchSource(source, input)`
- Produces: `buildListingSearchSourceCacheKey(input)`

- [ ] **Step 1: Write failing tests**

```ts
expect(buildListingSearchSourceCacheKey({ ...base, page: 1 })).toBe(
  buildListingSearchSourceCacheKey({ ...base, page: 2 }),
)
```

- [ ] **Step 2: Verify red**

Run: `pnpm test tests/listings-query-prefetch-performance.test.ts`

- [ ] **Step 3: Implement minimal code**

Extract the expensive all-candidate mapping/sorting part from `searchListings`, cache it by query without page, and paginate after cache retrieval.

- [ ] **Step 4: Verify green**

Run: `pnpm test tests/listings-query-prefetch-performance.test.ts tests/public-catalog-facade.test.ts`

### Task 2: News tagged cache and invalidation

**Files:**
- Create: `tests/news-page-performance.test.ts`
- Modify: `src/lib/frontend/cached-queries.ts`
- Modify: `src/lib/frontend/public-cache-revalidation.ts`
- Modify: `src/app/(frontend)/news/page.tsx`
- Modify: `src/app/(frontend)/news/[slug]/page.tsx`

**Interfaces:**
- Produces: `ARTICLES_CATEGORY_TAG`
- Produces: `getCachedPublishedArticles(page, pageSize)`
- Produces: `getCachedArticleBySlug(slug)`

- [ ] **Step 1: Write failing tests**

```ts
expect(newsPage).toContain('getCachedPublishedArticles(page, PAGE_SIZE)')
expect(articlePage).toContain('getCachedArticleBySlug(slug)')
expect(cacheRevalidation).toContain('ARTICLES_CATEGORY_TAG')
```

- [ ] **Step 2: Verify red**

Run: `pnpm test tests/news-page-performance.test.ts`

- [ ] **Step 3: Implement minimal code**

Route news list/detail through `unstable_cache` wrappers and include the article category tag in article invalidation.

- [ ] **Step 4: Verify green**

Run: `pnpm test tests/news-page-performance.test.ts tests/home-sitemap-cache-performance.test.ts`

### Task 3: Public query indexes

**Files:**
- Create: `src/migrations/20260810_170000_public_page_performance_indexes.ts`
- Modify: `src/migrations/index.ts`
- Modify: `tests/preflight-migrations.test.ts`
- Modify: `tests/news-page-performance.test.ts`

**Interfaces:**
- Produces migration name `20260810_170000_public_page_performance_indexes`

- [ ] **Step 1: Write failing tests**

```ts
expect(migration).toContain('articles_public_list_idx')
expect(migration).toContain('articles_public_category_list_idx')
expect(migration).toContain('listings_public_search_base_idx')
```

- [ ] **Step 2: Verify red**

Run: `pnpm test tests/news-page-performance.test.ts tests/preflight-migrations.test.ts`

- [ ] **Step 3: Implement minimal code**

Add idempotent `CREATE INDEX IF NOT EXISTS` statements in `up` and matching `DROP INDEX IF EXISTS` in `down`.

- [ ] **Step 4: Verify green**

Run: `pnpm test tests/news-page-performance.test.ts tests/preflight-migrations.test.ts`

### Task 4: Regression and local timing check

**Files:**
- No production file changes expected.

**Interfaces:**
- Consumes all tasks above.

- [ ] **Step 1: Typecheck**

Run: `pnpm exec tsc --noEmit --pretty false`

- [ ] **Step 2: Targeted tests**

Run: `pnpm test tests/listings-query-prefetch-performance.test.ts tests/news-page-performance.test.ts tests/preflight-migrations.test.ts`

- [ ] **Step 3: Local timing sample**

Run repeated `curl` timing for `/listings`, `/listings?page=2`, `/news`, and `/news?page=2` against the running local server.
