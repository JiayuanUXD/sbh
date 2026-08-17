import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import CityListingsView from '@/components/frontend/city/CityListingsView'
import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import { listPublicCityOptions, resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedListingDistrictOptions, getCachedSearchListings } from '@/lib/frontend/cached-queries'
import { buildCanonicalSearchParams, parseListingSearchInput } from '@/domain/public-catalog'
import { buildCityPageMetadata } from '@/lib/frontend/metadata'
import { saleChannelPath, shouldIndexSaleChannel } from '@/lib/frontend/sale-channel'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'

/**
 * 城市出售频道。
 *
 * 与 `/[city]/listings` 是**同一套组件的另一个实例**，差异只有三处：查询作用域
 * 传 'sale'、文案走出售语境、房源数为 0 时 noindex。不写第二套筛选器或卡片。
 */
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>
type Props = Readonly<{ params: Promise<{ city: string }>; searchParams: Promise<SearchParams> }>

function toUrlSearchParams(value: SearchParams): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') params.set(key, raw)
    else if (typeof raw?.[0] === 'string') params.set(key, raw[0])
  }
  return params
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ city: slug }, raw] = await Promise.all([params, searchParams])
  const city = await resolveCityContext(slug)
  if (!city) return { title: '页面未找到', robots: { index: false, follow: false } }
  const input = parseListingSearchInput(toUrlSearchParams(raw))
  const query = buildCanonicalSearchParams(input).toString()
  const base = buildCityPageMetadata({
    city,
    pageType: 'listings',
    canonicalQuery: query || undefined,
    multiCityRoutingEnabled: getMultiCityRoutingEnabled(),
  })

  // 空频道不进索引。查询走 unstable_cache，与下方页面渲染同参数命中同一份缓存，
  // 不产生额外的库往返。
  const result = await getCachedSearchListings(city.slug, query, input, 'sale')
  const indexable = shouldIndexSaleChannel(result.pagination.totalDocs)

  return {
    ...base,
    title: `${city.name}写字楼出售 · 商办买卖`,
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
  }
}

export default async function CitySalePage({ params, searchParams }: Props) {
  const [{ city: slug }, raw] = await Promise.all([params, searchParams])
  const city = await resolveCityContext(slug)
  if (!city) notFound()
  if (city.serviceStatus === 'coming-soon') {
    return <ComingSoonCityView city={city} />
  }
  const input = parseListingSearchInput(toUrlSearchParams(raw))
  const canonical = buildCanonicalSearchParams(input).toString()
  const [result, districts] = await Promise.all([
    getCachedSearchListings(city.slug, canonical, input, 'sale'),
    getCachedListingDistrictOptions(city.slug),
  ])
  return (
    <CityListingsView
      city={city}
      result={result}
      districts={districts}
      input={input}
      basePath={saleChannelPath(city.slug)}
      routeMode="prefixed"
      businessType="sale"
    />
  )
}
