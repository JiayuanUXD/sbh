import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'

import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import SiteSearchView from '@/components/frontend/search/SiteSearchView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { parseSiteSearchParams } from '@/domain/search/tabs'
import {
  getCachedSearchFallback,
  getCachedSiteSearchArticles,
  getCachedSiteSearchBuildings,
  getCachedSiteSearchListings,
} from '@/lib/frontend/cached-queries'

/**
 * 站内搜索页。
 *
 * 不属于任何目录：结果跨房源 / 楼盘 / 资讯，挂在任一目录下都会让页面身份错位。
 * 因此它不进主导航，也不吃列表页的筛选参数——`q` + `tab` + `page` 就是全部状态。
 * 索引策略：搜索页一律 noindex，搜索结果不是内容页。
 */
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>
type Props = Readonly<{ params: Promise<{ city: string }>; searchParams: Promise<SearchParams> }>

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { city: slug } = await params
  const city = await resolveCityContext(slug)
  if (!city) return { title: '页面未找到', robots: { index: false, follow: false } }
  return {
    title: `搜索 · ${city.name}`,
    robots: { index: false, follow: true },
  }
}

export default async function CitySearchPage({ params, searchParams }: Props) {
  const [{ city: slug }, raw] = await Promise.all([params, searchParams])
  const city = await resolveCityContext(slug)
  if (!city) notFound()
  if (city.serviceStatus === 'coming-soon') return <ComingSoonCityView city={city} />

  const { q, tab, page } = parseSiteSearchParams(raw)
  const hasQuery = q.length > 0

  const [listings, buildings, articles] = await Promise.all([
    hasQuery
      ? getCachedSiteSearchListings(city.slug, q, tab === 'listings' ? page : 1)
      : Promise.resolve(null),
    hasQuery
      ? getCachedSiteSearchBuildings(city.slug, q, tab === 'buildings' ? page : 1)
      : Promise.resolve(null),
    hasQuery
      ? getCachedSiteSearchArticles(q, tab === 'news' ? page : 1)
      : Promise.resolve(null),
  ])

  const total =
    (listings?.result.pagination.totalDocs ?? 0)
    + (buildings?.result.totalDocs ?? 0)
    + (articles?.totalDocs ?? 0)
  // 兜底内容只在搜索引导页与全局零结果页取；有结果时不发这三条查询。
  const fallback = !hasQuery || total === 0 ? await getCachedSearchFallback(city.slug) : null

  return (
    <SiteSearchView
      city={city}
      basePath={`/${city.slug}/search`}
      q={q}
      tab={tab}
      page={page}
      fallback={fallback}
      listings={listings}
      buildings={buildings}
      articles={articles}
    />
  )
}
