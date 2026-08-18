import type { MetadataRoute } from 'next'
import { unstable_cache } from 'next/cache'

import { listPublicCityProfiles } from '@/app/(frontend)/_lib/city-context'
import {
  SITEMAP_TAG,
  parseSearchInput,
  type ArticleCardViewModel,
  type BuildingSummaryViewModel,
  type ListingCardViewModel,
  type ListingSearchInput,
} from '@/domain/public-catalog'
import {
  getCachedPublishedArticles,
  getCachedPublishedPages,
  getCachedSitemapBuildingsPage,
  getCachedSearchListings,
} from '@/lib/frontend/cached-queries'
import { shouldListSaleChannelInSitemap } from '@/lib/frontend/sale-channel'
import { getMultiCityRoutingEnabled, getSaleChannelEnabled, siteConfig } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'

const base = siteConfig.siteOrigin
const HOME_SLUG = 'home'
const PRIVACY_SLUG = 'privacy'
const SITEMAP_ENTITY_LIMIT = 5_000
const ARTICLE_PAGE_SIZE = 48
const BUILDING_PAGE_SIZE = 200

function listingInput(page: number): ListingSearchInput {
  return { ...parseSearchInput(new URLSearchParams()), page }
}

/**
 * 拉取该城市的全部有效房源（**不按租售过滤**）。
 *
 * 刻意拉全集而不是按 businessType 各查一次：每次查询都要构建一份 search source，
 * 即全量有效供给查询 + 逐条精筛（媒体数、商户关系有效期、资质、举报暂停）。这是
 * 整个 sitemap 里最贵的一步。
 *
 * 按频道各查一次会让这个代价乘以频道数——而且为了确认「这个城市没有出售房源」，
 * 要付出和查全部租赁房源一样的开销，再乘以城市数。生产上这样做直接把 /sitemap.xml
 * 拖到超时；超时又导致 unstable_cache 写不进去，下一次请求仍然是冷的，形成死循环。
 *
 * 租售分组是纯内存操作（ListingCardViewModel 自带 businessType），放在调用方做。
 */
async function getCityListings(citySlug: string) {
  const docs: ListingCardViewModel[] = []
  let page = 1
  while (docs.length < SITEMAP_ENTITY_LIMIT) {
    const input = listingInput(page)
    const result = await getCachedSearchListings(citySlug, `page=${page}`, input)
    docs.push(...result.docs.slice(0, SITEMAP_ENTITY_LIMIT - docs.length))
    if (page >= result.pagination.totalPages) break
    page += 1
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
    if (getSaleChannelEnabled() && shouldListSaleChannelInSitemap(city.saleListings.length)) {
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
        lastModified: now,
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
