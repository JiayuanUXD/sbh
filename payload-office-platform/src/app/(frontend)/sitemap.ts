import type { MetadataRoute } from 'next'
import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Building } from '@/payload-types'
import { siteConfig } from '@/lib/frontend/site-config'
import { getPublicBuildingWhere } from '@/domain/supply/public-building'
import {
  createSearchContext,
  getDefaultSupplyAdapter,
  listPublishedPages,
  parseSearchInput,
  SITEMAP_TAG,
} from '@/domain/public-catalog'

// sitemap 查库（listings/buildings/pages），构建期无 DB。与 (frontend) 各页面一致，
// 强制运行时动态生成，禁止构建期预渲染，否则 builder 阶段报 no such table。
export const dynamic = 'force-dynamic'

// 站点 URL 由类型化环境配置提供，禁止硬编码生产域名。
// F0.5：见 specs/frontend-mvp/tasks.md 与 design.md §11。
// 生产构建缺失 NEXT_PUBLIC_SITE_URL 时，site-config 模块会在启动时抛错。
const base = siteConfig.siteOrigin

/**
 * 内容页 home slug 特殊处理（F6.4）
 *
 * Pages collection 中 slug='home' 的页面由 CMS 维护首页内容，
 * 但首页路由为 '/'（已由 sitemap 首条占位），不应再生成 /pages/home。
 * 见 facade.ts listPublishedPages 注释：home slug 由调用方转换。
 */
const HOME_SLUG = 'home'
const SITEMAP_ENTITY_LIMIT = 5_000

// M4.7（F1.6 收口）：listings 不再内联 `status=available` 过渡谓词，改走 Public Catalog
// SupplyAdapter 的统一有效供给口径（查询层谓词 + 媒体/关系/商户逐条精筛），与 C 端列表 /
// 详情可见性一致——满足 M4 验收门「同一房源可见性结论一致」。
//   · MVP 计数封顶：findEffectiveListings 候选上限随 pageSize（默认 24×5=120），
//     超大城市 sitemap 会封顶，与列表分页口径同源，属后续优化点。
//   · 用 adapter 而非 searchListings：需保留 slug + updatedAt 供 lastModified，卡片 DTO 不含。
// buildings 仍走原生查询（楼盘可见性只依赖楼盘自身状态 + 在营,无需房源级精筛）。
const getCachedSitemapEntries = unstable_cache(
  async () => {
    const payload = await getPayload({ config })
    const ctx = createSearchContext(siteConfig.defaultCity)
    const adapter = getDefaultSupplyAdapter()
    const [listings, buildings, pages] = await Promise.all([
      adapter.findEffectiveListings(parseSearchInput(new URLSearchParams()), ctx),
      (async () => {
        const docs: Building[] = []
        let page = 1
        while (docs.length < SITEMAP_ENTITY_LIMIT) {
          const result = await payload.find({
            collection: 'buildings',
            where: {
              ...getPublicBuildingWhere(),
              'city.slug': { equals: ctx.city },
            },
            limit: Math.min(200, SITEMAP_ENTITY_LIMIT - docs.length),
            page,
            depth: 0,
            sort: 'id',
          })
          docs.push(...result.docs)
          if (!result.hasNextPage || result.nextPage == null) break
          page = result.nextPage
        }
        return docs
      })(),
      // F6.4：内容页通过 Public Catalog Facade 查询，与 /pages/[slug] 路由可见性一致
      listPublishedPages(ctx, { limit: SITEMAP_ENTITY_LIMIT }),
    ])

    return { listings, buildings, pages }
  },
  ['public-sitemap-entries'],
  {
    tags: [SITEMAP_TAG],
    revalidate: 300,
  },
)

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticUrls: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${base}/listings`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
    {
      url: `${base}/entrust`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${base}/publish`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
  ]

  let entities: Awaited<ReturnType<typeof getCachedSitemapEntries>>
  try {
    entities = await getCachedSitemapEntries()
  } catch {
    console.error('[sitemap] dynamic_entries_unavailable')
    return staticUrls
  }

  const { listings, buildings, pages } = entities

  const lUrls = listings.map((d) => ({
    url: `${base}/listings/${d.slug}`,
    lastModified: new Date(d.updatedAt),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))
  const bUrls = buildings.map((d) => ({
    url: `${base}/buildings/${d.slug}`,
    lastModified: new Date(d.updatedAt),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))
  // F6.4：内容页 URL 与优先级
  //   - home slug 跳过：首页 '/' 已由下方首条占位，不重复 /pages/home；
  //   - 内容页更新频率低于房源/楼盘，使用 monthly；
  //   - 优先级 0.6：与楼盘同级，低于房源详情（0.8）与列表（0.9）。
  const pUrls = pages
    .filter((p) => p.slug !== HOME_SLUG)
    .map((p) => ({
      url: `${base}/pages/${p.slug}`,
      lastModified: new Date(p.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }))

  return [
    ...staticUrls,
    ...lUrls,
    ...bUrls,
    ...pUrls,
  ]
}
