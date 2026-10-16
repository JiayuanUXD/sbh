import type { MetadataRoute } from 'next'
import { unstable_cache } from 'next/cache'
import { listPublicCityProfiles } from './city-context'
import { globalStaticUrls } from './sitemap'
import { SITEMAP_TAG, createSearchContext, searchListingsSitemapPage } from '@/domain/public-catalog'
import {
  getCachedPublishedArticles,
  getCachedPublishedPages,
  getCachedSitemapBuildingsPage,
  getCachedSitemapListingsPage,
} from '@/lib/frontend/cached-queries'
import { shouldListSaleChannelInSitemap } from '@/lib/frontend/sale-channel'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'

export const SITEMAP_PAGE_SIZE = 500
const MAX_PAGES_PER_CITY = 500
type Kind = 'listings' | 'buildings'
type CityManifest = { citySlug: string; listingPages: number[]; buildingPages: number[] }
const base = siteConfig.siteOrigin

const loadManifest = unstable_cache(async (multiCity: boolean): Promise<CityManifest[]> => {
  const profiles = await listPublicCityProfiles()
  const cities: CityManifest[] = []
  // 顺序扫描城市，限制冷缓存时的数据库并发；只缓存页号而非全部实体。
  for (const profile of profiles) {
    if (profile.serviceStatus !== 'live' || (!multiCity && profile.citySlug !== siteConfig.defaultCity)) continue
    const city: CityManifest = { citySlug: profile.citySlug, listingPages: [], buildingPages: [] }
    for (const kind of ['listings', 'buildings'] as const) {
      let page = 1
      while (true) {
        const result = kind === 'listings'
          ? await getCachedSitemapListingsPage(city.citySlug, page, SITEMAP_PAGE_SIZE)
          : await getCachedSitemapBuildingsPage(city.citySlug, page, SITEMAP_PAGE_SIZE)
        // 用候选分页总数建立索引，精筛仍在每个分片执行；空分片是合法空 XML。
        // 索引冷启动只读取每类第一页，不把全量供给水合或写入同一个缓存条目。
        if (result.totalPages != null) {
          if (!Number.isInteger(result.totalPages) || result.totalPages < 0 || result.totalPages > MAX_PAGES_PER_CITY) {
            throw new Error('站点地图超过安全枚举上限')
          }
          const pages = Array.from({ length: result.totalPages }, (_, index) => index + 1)
          if (kind === 'listings') city.listingPages = pages
          else city.buildingPages = pages
          break
        }
        if (result.docs.length > SITEMAP_PAGE_SIZE) throw new Error('站点地图分页超出容量')
        if (result.docs.length) {
          if (kind === 'listings') city.listingPages.push(page)
          else city.buildingPages.push(page)
        }
        if (!result.hasNextPage) break
        if (page >= MAX_PAGES_PER_CITY) throw new Error('站点地图超过安全枚举上限')
        if (result.nextPage !== page + 1) throw new Error('站点地图分页未连续推进')
        page = result.nextPage
      }
    }
    cities.push(city)
  }
  return cities
}, ['public-sitemap-manifest-v1'], { tags: [SITEMAP_TAG], revalidate: 300 })

const hasEffectiveSale = unstable_cache(async (citySlug: string) => {
  const ctx = createSearchContext(citySlug, undefined, 'sale')
  for (let page = 1; page <= MAX_PAGES_PER_CITY; page += 1) {
    const result = await searchListingsSitemapPage(ctx, { page, limit: SITEMAP_PAGE_SIZE })
    if (result.docs.length) return true
    if (!result.hasNextPage) return false
    if (result.nextPage !== page + 1) throw new Error('出售站点地图分页未连续推进')
  }
  throw new Error('出售站点地图超过安全枚举上限')
}, ['public-sitemap-sale-exists-v1'], { tags: [SITEMAP_TAG], revalidate: 300 })

export function getSitemapManifest() {
  return loadManifest(getMultiCityRoutingEnabled())
}

function cityPrefix(citySlug: string) {
  return getMultiCityRoutingEnabled() ? `${base}/${citySlug}` : base
}

export function sitemapShardUrl(citySlug: string, kind: Kind, page: number) {
  return `${base}/sitemaps/${citySlug}/${kind}/${page}.xml`
}

export async function getStaticSitemap(): Promise<MetadataRoute.Sitemap> {
  const cities = await getSitemapManifest()
  const entries = globalStaticUrls()
  // 城市频道页（首页 / 列表 / 楼盘 / 共享办公 / 出售）是实时聚合页，没有单一的「最后修改」时间，
  // 不写 lastmod 比写请求时刻诚实。
  for (const city of cities) {
    const prefix = cityPrefix(city.citySlug)
    entries.push(
      { url: prefix, changeFrequency: 'daily', priority: 1 },
      { url: `${prefix}/listings`, changeFrequency: 'daily', priority: 0.9 },
      { url: `${prefix}/buildings`, changeFrequency: 'daily', priority: 0.8 },
      { url: `${prefix}/coworking`, changeFrequency: 'daily', priority: 0.8 },
    )
    if (shouldListSaleChannelInSitemap(await hasEffectiveSale(city.citySlug) ? 1 : 0)) {
      entries.push({ url: `${prefix}/sale`, changeFrequency: 'daily', priority: 0.9 })
    }
  }
  const pages = await getCachedPublishedPages(5_000)
  for (const page of pages) {
    if (page.slug === 'home' || page.slug === 'privacy') continue
    entries.push({ url: `${base}/pages/${page.slug}`, lastModified: new Date(page.updatedAt), changeFrequency: 'monthly', priority: 0.6 })
  }
  let page = 1
  let newsTotal = 0
  let newsLastModified = 0
  while (true) {
    const articles = await getCachedPublishedArticles(page, 48)
    newsTotal = articles.totalDocs
    for (const article of articles.docs) {
      // lastmod 用真实修改时间（文章发布后再编辑要反映给搜索引擎）；updatedAt 取不到才退回发布时间，都没有就不写
      const modified = article.updatedAt ?? article.publishedAt
      const time = modified ? Date.parse(modified) : Number.NaN
      if (Number.isFinite(time)) newsLastModified = Math.max(newsLastModified, time)
      entries.push({ url: `${base}/news/${article.slug}`, ...(Number.isFinite(time) ? { lastModified: new Date(time) } : {}), changeFrequency: 'monthly', priority: 0.6 })
    }
    if (page >= articles.totalPages) break
    if (page >= MAX_PAGES_PER_CITY) throw new Error('资讯站点地图超过安全枚举上限')
    page += 1
  }
  // 没有任何已发布资讯时 /news 是空页，不提交收录；有则 lastmod 取所有资讯里最晚的修改时间
  if (newsTotal > 0) {
    entries.push({ url: `${base}/news`, ...(newsLastModified > 0 ? { lastModified: new Date(newsLastModified) } : {}), changeFrequency: 'weekly', priority: 0.7 })
  }
  return [...new Map(entries.map((entry) => [entry.url, entry])).values()]
}

export async function getEntitySitemap(citySlug: string, kind: Kind, page: number): Promise<MetadataRoute.Sitemap | null> {
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGES_PER_CITY) return null
  const profiles = await listPublicCityProfiles()
  if (!profiles.some((city) => city.citySlug === citySlug && city.serviceStatus === 'live')) return null
  if (!getMultiCityRoutingEnabled() && citySlug !== siteConfig.defaultCity) return null
  const now = new Date()
  const prefix = cityPrefix(citySlug)
  const result = kind === 'listings'
    ? await getCachedSitemapListingsPage(citySlug, page, SITEMAP_PAGE_SIZE)
    : await getCachedSitemapBuildingsPage(citySlug, page, SITEMAP_PAGE_SIZE)
  if (result.totalPages != null && page > result.totalPages) return null
  if (result.docs.length > SITEMAP_PAGE_SIZE) throw new Error('站点地图分页超出容量')
  return result.docs.map((doc) => ({
    url: `${prefix}/${kind}/${doc.slug}`,
    lastModified: 'updatedAt' in doc && doc.updatedAt ? new Date(doc.updatedAt as string) : now,
    changeFrequency: 'weekly',
    priority: kind === 'listings' ? 0.8 : 0.6,
  }))
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
}

export function sitemapIndexXml(urls: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<sitemap><loc>${escapeXml(url)}</loc></sitemap>`).join('')}</sitemapindex>`
}

export function sitemapXml(entries: MetadataRoute.Sitemap) {
  if (entries.length > 50_000) throw new Error('站点地图 URL 数超过协议上限')
  const body = entries.map((entry) => {
    const lastmod = entry.lastModified instanceof Date ? entry.lastModified.toISOString() : entry.lastModified
    return `<url><loc>${escapeXml(entry.url)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}${entry.changeFrequency ? `<changefreq>${entry.changeFrequency}</changefreq>` : ''}${entry.priority != null ? `<priority>${entry.priority}</priority>` : ''}</url>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`
}

export function xmlResponse(xml: string) {
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' } })
}

export function sitemapUnavailable() {
  console.error('[sitemap] dynamic_entries_unavailable')
  return new Response('Sitemap temporarily unavailable', { status: 503, headers: { 'Retry-After': '60' } })
}
