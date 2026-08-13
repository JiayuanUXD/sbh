import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

describe('OPT-027 homepage and sitemap cache contracts', () => {
  it('serves the homepage through the tagged cached homepage query', async () => {
    const [homePage, cachedQueries] = await Promise.all([
      readFile(resolve(ROOT, 'src/app/(frontend)/page.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/lib/frontend/cached-queries.ts'), 'utf8'),
    ])

    expect(homePage).toContain('getCachedHomepage(city.slug)')
    expect(homePage).not.toContain('getHomepage(')
    expect(homePage).not.toContain('defaultSearchContext(')
    expect(cachedQueries).toContain('const getCachedHomepageByCity = memoizeByCity')
    expect(cachedQueries).toMatch(/getCachedHomepageByCity[\s\S]*?revalidate:\s*300/)
  })

  it('wraps sitemap entity loading in a tagged 300 second cache', async () => {
    const sitemap = await readFile(resolve(ROOT, 'src/app/(frontend)/sitemap.ts'), 'utf8')

    expect(sitemap).toContain('unstable_cache(')
    expect(sitemap).toContain("['public-sitemap-entries']")
    expect(sitemap).toContain('SITEMAP_TAG')
    expect(sitemap).toMatch(/revalidate:\s*300/)
    expect(sitemap).toContain('getCachedSitemapEntries(multiCityRoutingEnabled)')
  })

  it('invalidates content-dependent public caches from page and article collection hooks', async () => {
    const [pages, articles] = await Promise.all([
      readFile(resolve(ROOT, 'src/collections/Pages.ts'), 'utf8'),
      readFile(resolve(ROOT, 'src/collections/Articles.ts'), 'utf8'),
    ])

    expect(pages).toContain('afterChange: [invalidatePagePublicCache]')
    expect(pages).toContain('afterDelete: [invalidatePagePublicCache]')
    expect(articles).toContain('afterChange: [invalidateArticlePublicCache]')
    expect(articles).toContain('afterDelete: [invalidateArticlePublicCache]')
  })

  it('content cache invalidation logs failures without throwing', async () => {
    const helper = await readFile(
      resolve(ROOT, 'src/lib/frontend/public-cache-revalidation.ts'),
      'utf8',
    )

    expect(helper).toContain("console.error('[public-cache-revalidation] failed'")
    expect(helper).toContain('catch (error)')
    expect(helper).not.toMatch(/throw error|throw new Error/)
  })
})
