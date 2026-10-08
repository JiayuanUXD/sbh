import { describe, expect, it } from 'vitest'
import { getHomepage } from '@/domain/public-catalog/facade'
import { createSearchContext } from '@/domain/public-catalog/types'
import { makeHomepageAdapter } from './helpers/opt035-fixtures'
import type { Article } from '@/payload-types'

function makeTestArticle(id: number, overrides: Partial<Article> = {}): Article {
  return {
    id,
    title: `文章 ${id}`,
    slug: `article-${id}`,
    status: 'published',
    category: 'market',
    publishedAt: '2026-08-01T10:00:00.000Z',
    isHomeFeatured: false,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  } as Article
}

describe('getHomepage featuredArticle resolution and fallback', () => {
  const ctx = createSearchContext('shanghai')

  it('uses findHomeFeaturedArticle when available', async () => {
    const featured = makeTestArticle(99, { title: '头条主推', isHomeFeatured: true })
    const latest = [makeTestArticle(1), makeTestArticle(2)]

    const adapter = makeHomepageAdapter({
      findLatestArticles: async () => latest,
      findHomeFeaturedArticle: async () => featured,
    })

    const hp = await getHomepage(ctx, {}, adapter)
    expect(hp.featuredArticle).not.toBeNull()
    expect(hp.featuredArticle?.id).toBe(99)
    expect(hp.featuredArticle?.title).toBe('头条主推')
    expect(hp.latestArticles.map((a) => a.id)).toEqual([1, 2])
  })

  it('falls back to latestArticles[0] when findHomeFeaturedArticle returns null', async () => {
    const latest = [makeTestArticle(1, { title: '最新文章 1' }), makeTestArticle(2)]

    const adapter = makeHomepageAdapter({
      findLatestArticles: async () => latest,
      findHomeFeaturedArticle: async () => null,
    })

    const hp = await getHomepage(ctx, {}, adapter)
    expect(hp.featuredArticle).not.toBeNull()
    expect(hp.featuredArticle?.id).toBe(1)
    expect(hp.featuredArticle?.title).toBe('最新文章 1')
  })

  it('returns null when both findHomeFeaturedArticle and latestArticles are empty', async () => {
    const adapter = makeHomepageAdapter({
      findLatestArticles: async () => [],
      findHomeFeaturedArticle: async () => null,
    })

    const hp = await getHomepage(ctx, {}, adapter)
    expect(hp.featuredArticle).toBeNull()
  })
})
