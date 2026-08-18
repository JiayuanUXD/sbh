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
import type { SearchChannel } from '@/lib/frontend/cached-queries'
import { shouldListSaleChannelInSitemap } from '@/lib/frontend/sale-channel'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'

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
 * @param businessType 频道。出售房源的详情页 URL 与租赁共用 /listings/{slug}，
 *   两边都要收录，否则出售房源对搜索引擎完全不可见。
 */
async function getCityListings(citySlug: string, businessType: SearchChannel = 'lease') {
  const docs: ListingCardViewModel[] = []
  let page = 1
  while (docs.length < SITEMAP_ENTITY_LIMIT) {
    const input = listingInput(page)
    const result = await getCachedSearchListings(citySlug, `page=${page}`, input, businessType)
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
        const [listings, saleListings, buildings] = await Promise.all([
          getCityListings(profile.citySlug, 'lease'),
          getCityListings(profile.citySlug, 'sale'),
          getCityBuildings(profile.citySlug),
        ])
        return { citySlug: profile.citySlug, listings, saleListings, buildings }
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
    if (shouldListSaleChannelInSitemap(city.saleListings.length)) {
      dynamicUrls.push({
        url: `${prefix}/sale`,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.9,
      })
    }
    // 租售房源的详情页共用 /listings/{slug} 路由，合并收录。
    for (const listing of [...city.listings, ...city.saleListings]) {
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
