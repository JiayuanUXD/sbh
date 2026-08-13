import type { MetadataRoute } from 'next'
import { unstable_cache } from 'next/cache'

import { listPublicCityProfiles } from '@/app/(frontend)/_lib/city-context'
import {
  SITEMAP_TAG,
  parseSearchInput,
  type ArticleCardViewModel,
  type ListingCardViewModel,
  type ListingSearchInput,
} from '@/domain/public-catalog'
import {
  getCachedPublishedArticles,
  getCachedPublishedPages,
  getCachedSearchBuildings,
  getCachedSearchListings,
} from '@/lib/frontend/cached-queries'
import { siteConfig } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'

const base = siteConfig.siteOrigin
const HOME_SLUG = 'home'
const PRIVACY_SLUG = 'privacy'
const SITEMAP_ENTITY_LIMIT = 5_000
const ARTICLE_PAGE_SIZE = 48

function listingInput(page: number): ListingSearchInput {
  return { ...parseSearchInput(new URLSearchParams()), page }
}

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

const getCachedSitemapEntries = unstable_cache(
  async () => {
    const profiles = await listPublicCityProfiles()
    const liveProfiles = profiles.filter((profile) => profile.serviceStatus === 'live')
    const [cities, pages, articles] = await Promise.all([
      Promise.all(liveProfiles.map(async (profile) => {
        const [listings, buildingResult] = await Promise.all([
          getCityListings(profile.citySlug),
          getCachedSearchBuildings(profile.citySlug),
        ])
        return { citySlug: profile.citySlug, listings, buildings: buildingResult.docs }
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

  let entities: Awaited<ReturnType<typeof getCachedSitemapEntries>>
  try {
    entities = await getCachedSitemapEntries()
  } catch {
    console.error('[sitemap] dynamic_entries_unavailable')
    return staticUrls
  }

  const dynamicUrls: MetadataRoute.Sitemap = []
  for (const city of entities.cities) {
    const prefix = `${base}/${city.citySlug}`
    dynamicUrls.push(
      { url: prefix, lastModified: now, changeFrequency: 'daily', priority: 1 },
      { url: `${prefix}/listings`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
      { url: `${prefix}/buildings`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    )
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
