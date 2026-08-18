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

  it('每个城市只构建一次 search source（租售分组走内存，不各查一次）', async () => {
    const sitemap = await readFile(resolve(ROOT, 'src/app/(frontend)/sitemap.ts'), 'utf8')

    // 构建 search source 是 sitemap 里最贵的一步：全量有效供给查询 + 逐条精筛
    // （媒体数、商户关系有效期、资质、举报暂停）。按频道各查一次会让它乘以频道数，
    // 而且为了确认「这个城市没有出售房源」要付出和查全部租赁一样的开销。
    // 生产上这样做把 /sitemap.xml 拖到超时，超时又让 unstable_cache 写不进去，
    // 下次请求仍是冷的，形成死循环。
    const listingCalls = sitemap.match(/getCityListings\(/g) ?? []
    // 一处定义 + 一处调用
    expect(listingCalls.length).toBe(2)
    expect(sitemap).not.toMatch(/getCityListings\([^)]*['"]sale['"]/)
    expect(sitemap).not.toMatch(/getCityListings\([^)]*['"]lease['"]/)
    // 租售分组必须是内存过滤
    expect(sitemap).toContain("allListings.filter((l) => l.businessType === 'sale')")
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
