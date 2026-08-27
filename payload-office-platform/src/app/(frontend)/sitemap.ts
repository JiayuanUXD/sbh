import type { MetadataRoute } from 'next'
import { unstable_cache } from 'next/cache'

import { listPublicCityProfiles } from '@/app/(frontend)/_lib/city-context'
import {
  SITEMAP_TAG,
  type ArticleCardViewModel,
  type BuildingSummaryViewModel,
  type EffectiveListingSitemapEntry,
} from '@/domain/public-catalog'
import {
  getCachedPublishedArticles,
  getCachedPublishedPages,
  getCachedSitemapBuildingsPage,
  getCachedSitemapListingsPage,
} from '@/lib/frontend/cached-queries'
import { shouldListSaleChannelInSitemap } from '@/lib/frontend/sale-channel'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'

const base = siteConfig.siteOrigin
const HOME_SLUG = 'home'
const PRIVACY_SLUG = 'privacy'
const SITEMAP_ENTITY_LIMIT = 5_000
const ARTICLE_PAGE_SIZE = 48
const BUILDING_PAGE_SIZE = 200
const LISTING_PAGE_SIZE = 200

/**
 * 拉取该城市的全部有效房源 URL（**不按租售过滤**）。
 *
 * 走 sitemap 专用查询而不是搜索管线：sitemap 只要 slug 和 lastmod，而
 * getCachedSearchListings 会把每套房源的楼盘、城市、行政区、商圈、地铁、媒体、
 * 经纪人全部水合（depth 2），再映射成完整展示卡片。7 个城市各付一遍这个代价，
 * 直接把 /sitemap.xml 拖到 70 秒无响应；超时又导致 unstable_cache 写不进去，
 * 下一次请求仍然是冷的——死循环，所以它表现为 100% 坏而不是偶尔慢（OPT-031）。
 *
 * 精筛口径没有打折：专用查询走的是同一个 fineFilter，媒体数 / 商户关系 / 资质 /
 * 举报暂停与前台一致，所以这里输出的 URL 逐条可达。
 *
 * 仍然一次拉全集、租售在内存里分组：按频道各查一次会让开销乘以频道数，而且为了
 * 确认「这个城市没有出售房源」要付出和查全部租赁房源一样的代价。
 */
async function getCityListings(citySlug: string) {
  const docs: EffectiveListingSitemapEntry[] = []
  const visitedPages = new Set<number>()
  let page = 1
  while (docs.length < SITEMAP_ENTITY_LIMIT && !visitedPages.has(page)) {
    visitedPages.add(page)
    const result = await getCachedSitemapListingsPage(citySlug, page, LISTING_PAGE_SIZE)
    docs.push(...result.docs.slice(0, SITEMAP_ENTITY_LIMIT - docs.length))
    if (!result.hasNextPage || result.nextPage == null || result.nextPage <= page) break
    page = result.nextPage
  }
  return docs
}

async function getPublishedArticles() {
  const docs: ArticleCardViewModel[] = []
  let page = 1
  while (docs.length < SITEMAP_ENTITY_LIMIT) {
    const result = await getCachedPublishedArticles(page, ARTICLE_PAGE_SIZE)
    docs.push(...result.docs.slice(0, SITEMAP_ENTITY_LIMIT - docs.length))
    if (page >= result.totalPages) break
    page += 1
  }
  return docs
}

async function getCityBuildings(citySlug: string) {
  const docs: BuildingSummaryViewModel[] = []
  const visitedPages = new Set<number>()
  let page = 1
  while (docs.length < SITEMAP_ENTITY_LIMIT && !visitedPages.has(page)) {
    visitedPages.add(page)
    const result = await getCachedSitemapBuildingsPage(citySlug, page, BUILDING_PAGE_SIZE)
    docs.push(...result.docs.slice(0, SITEMAP_ENTITY_LIMIT - docs.length))
    if (!result.hasNextPage || result.nextPage == null || result.nextPage <= page) break
    page = result.nextPage
  }
  return docs
}

const getCachedSitemapEntries = unstable_cache(
  async (multiCityRoutingEnabled: boolean) => {
    const profiles = await listPublicCityProfiles()
    const liveProfiles = profiles.filter((profile) => (
      profile.serviceStatus === 'live'
      && (multiCityRoutingEnabled || profile.citySlug === siteConfig.defaultCity)
    ))
    const [cities, pages, articles] = await Promise.all([
      Promise.all(liveProfiles.map(async (profile) => {
        const [allListings, buildings] = await Promise.all([
          getCityListings(profile.citySlug),
          getCityBuildings(profile.citySlug),
        ])
        // 一次查询、内存分组：租售各查一次会让最贵的那步开销翻倍
        const saleListings = allListings.filter((l) => l.businessType === 'sale')
        return { citySlug: profile.citySlug, listings: allListings, saleListings, buildings }
      })),
      getCachedPublishedPages(SITEMAP_ENTITY_LIMIT),
      getPublishedArticles(),
    ])
    return { cities, pages, articles }
  },
  ['public-sitemap-entries'],
  { tags: [SITEMAP_TAG], revalidate: 300 },
)

function globalStaticUrls(now: Date): MetadataRoute.Sitemap {
  return [
    { url: `${base}/news`, lastModified: now, changeFrequency: 'daily', priority: 0.7 },
    { url: `${base}/pages/privacy`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/entrust`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/publish`, lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/city-partner`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
  ]
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const staticUrls = globalStaticUrls(now)
  const multiCityRoutingEnabled = getMultiCityRoutingEnabled()

  let entities: Awaited<ReturnType<typeof getCachedSitemapEntries>>
  try {
    entities = await getCachedSitemapEntries(multiCityRoutingEnabled)
  } catch {
    console.error('[sitemap] dynamic_entries_unavailable')
    return staticUrls
  }

  const dynamicUrls: MetadataRoute.Sitemap = []
  for (const city of entities.cities) {
    const prefix = multiCityRoutingEnabled ? `${base}/${city.citySlug}` : base
    dynamicUrls.push(
      { url: prefix, lastModified: now, changeFrequency: 'daily', priority: 1 },
      { url: `${prefix}/listings`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
      { url: `${prefix}/buildings`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    )
    // 出售频道页与 noindex 判定同口径：房源数为 0 时既不进索引也不进 sitemap。
    // 两者不一致就是自相矛盾的信号（「别收录」+「快来收录」），noindex 的降噪
    // 作用会被抵消，还白耗抓取预算。
    // 开关关闭时频道页返回 404，出现在 sitemap 里就是让爬虫去撞死链
    if (shouldListSaleChannelInSitemap(city.saleListings.length)) {
      dynamicUrls.push({
        url: `${prefix}/sale`,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.9,
      })
    }
    // city.listings 已是租售全集（详情页共用 /listings/{slug} 路由）。
    for (const listing of city.listings) {
      dynamicUrls.push({
        url: `${prefix}/listings/${listing.slug}`,
        // 专用查询顺带取到了真实 updatedAt，不再统一填 now——每条 URL 都写「刚刚
        // 更新」等于没给爬虫任何信息。
        lastModified: listing.updatedAt ? new Date(listing.updatedAt) : now,
        changeFrequency: 'weekly',
        priority: 0.8,
      })
    }
    for (const building of city.buildings) {
      dynamicUrls.push({
        url: `${prefix}/buildings/${building.slug}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.6,
      })
    }
  }

  for (const article of entities.articles) {
    dynamicUrls.push({
      url: `${base}/news/${article.slug}`,
      lastModified: article.publishedAt ? new Date(article.publishedAt) : now,
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  }
  for (const page of entities.pages) {
    if (page.slug === HOME_SLUG || page.slug === PRIVACY_SLUG) continue
    dynamicUrls.push({
      url: `${base}/pages/${page.slug}`,
      lastModified: new Date(page.updatedAt),
      changeFrequency: 'monthly',
      priority: 0.6,
    })
  }

  const unique = new Map<string, MetadataRoute.Sitemap[number]>()
  for (const entry of [...staticUrls, ...dynamicUrls]) unique.set(entry.url, entry)
  return [...unique.values()]
}
