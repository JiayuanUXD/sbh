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

  it('wraps the lightweight sitemap manifest in a tagged 300 second cache', async () => {
    const sitemap = await readFile(resolve(ROOT, 'src/app/(frontend)/_lib/sitemap-shards.ts'), 'utf8')

    expect(sitemap).toContain('unstable_cache(')
    expect(sitemap).toContain("['public-sitemap-manifest-v1']")
    expect(sitemap).toContain('SITEMAP_TAG')
    expect(sitemap).toMatch(/revalidate:\s*300/)
    expect(sitemap).toContain('loadManifest(getMultiCityRoutingEnabled())')
  })

  it('索引按候选总页数生成分片，不冷态扫描完整城市供给', async () => {
    const [sitemap, indexRoute] = await Promise.all([
      readFile(resolve(ROOT, 'src/app/(frontend)/_lib/sitemap-shards.ts'), 'utf8'),
      readFile(resolve(ROOT, 'src/app/(frontend)/sitemap.xml/route.ts'), 'utf8'),
    ])

    // 候选总页数只决定 XML 分片数量；有效供给精筛由各分片执行。
    // 出售频道判定独立于索引，避免索引为了找出售房源而扫描全部租赁供给。
    const manifest = sitemap.slice(sitemap.indexOf('const loadManifest'), sitemap.indexOf('const hasEffectiveSale'))
    expect(manifest).toContain('if (result.totalPages != null)')
    expect(manifest).toContain('Array.from({ length: result.totalPages }')
    expect(manifest).not.toContain('hasEffectiveSale(')
    expect(indexRoute).toContain('getSitemapManifest()')
    expect(indexRoute).not.toContain('getStaticSitemap(')
    expect(indexRoute).not.toContain('getEntitySitemap(')
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
