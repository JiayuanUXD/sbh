import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PERFORMANCE_MIGRATION = '20260810_170000_public_page_performance_indexes'

describe('news page performance contracts', () => {
  it('routes news list and detail pages through tagged frontend caches', async () => {
    const [newsPage, articlePage, cachedQueries, cacheRevalidation] = await Promise.all([
      readFile(resolve(ROOT, 'src/app/(frontend)/news/page.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/app/(frontend)/news/[slug]/page.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/lib/frontend/cached-queries.ts'), 'utf8'),
      readFile(resolve(ROOT, 'src/lib/frontend/public-cache-revalidation.ts'), 'utf8'),
    ])

    expect(newsPage).toContain('getCachedPublishedArticles(page, PAGE_SIZE)')
    expect(newsPage).not.toContain('listPublishedArticles(')
    expect(articlePage).toContain('getCachedArticleBySlug(slug)')
    expect(articlePage).not.toContain('getArticleBySlug(slug, ctx)')

    expect(cachedQueries).toContain('export const ARTICLES_CATEGORY_TAG')
    expect(cachedQueries).toContain('getCachedPublishedArticles = unstable_cache(')
    expect(cachedQueries).toContain('getCachedArticleBySlug = unstable_cache(')
    expect(cacheRevalidation).toContain('ARTICLES_CATEGORY_TAG')
  })

  it('adds public query indexes for large article lists and listing search candidates', async () => {
    const [migration, migrationIndex] = await Promise.all([
      readFile(resolve(ROOT, `src/migrations/${PERFORMANCE_MIGRATION}.ts`), 'utf8'),
      readFile(resolve(ROOT, 'src/migrations/index.ts'), 'utf8'),
    ])

    expect(migration).toContain('articles_public_list_idx')
    expect(migration).toContain('articles_public_category_list_idx')
    expect(migration).toContain('listings_public_search_base_idx')
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS')
    expect(migration).toContain('DROP INDEX IF EXISTS')
    expect(migrationIndex).toContain(PERFORMANCE_MIGRATION)
  })
})
