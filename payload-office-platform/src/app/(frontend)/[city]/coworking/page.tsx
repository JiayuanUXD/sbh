import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import CityListingsView from '@/components/frontend/city/CityListingsView'
import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedListingDistrictOptions, getCachedSearchListings } from '@/lib/frontend/cached-queries'
import { resolveListingSearchInput } from '@/app/(frontend)/_lib/search-input'
import { buildCityPageMetadata } from '@/lib/frontend/metadata'
import { parseListingViewMode } from '@/lib/frontend/listing-url'
import {
  buildCoworkingCanonicalParams,
  coworkingChannelPath,
  lockCoworkingInput,
} from '@/lib/frontend/coworking-channel'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'

/**
 * 共享办公频道（OPT-103）。与 `[city]/sale/page.tsx` 同形：`CityListingsView` 的另一个实例，
 * 差别是类型由这里锁死为 coworking、canonical 不输出 `type`（见 lib/frontend/coworking-channel.ts）。
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
  const input = lockCoworkingInput(await resolveListingSearchInput(city.slug, toUrlSearchParams(raw)))
  const query = buildCoworkingCanonicalParams(input).toString()
  return buildCityPageMetadata({
    city,
    pageType: 'coworking',
    canonicalQuery: query || undefined,
    multiCityRoutingEnabled: getMultiCityRoutingEnabled(),
  })
}

export default async function CityCoworkingPage({ params, searchParams }: Props) {
  const [{ city: slug }, raw] = await Promise.all([params, searchParams])
  const city = await resolveCityContext(slug)
  if (!city) notFound()
  if (city.serviceStatus === 'coming-soon') {
    return <ComingSoonCityView city={city} />
  }
  const input = lockCoworkingInput(await resolveListingSearchInput(city.slug, toUrlSearchParams(raw)))
  const canonical = buildCoworkingCanonicalParams(input).toString()
  const [result, districts] = await Promise.all([
    getCachedSearchListings(city.slug, canonical, input),
    getCachedListingDistrictOptions(city.slug),
  ])
  return (
    <CityListingsView
      city={city}
      result={result}
      districts={districts}
      input={input}
      basePath={coworkingChannelPath(city.slug)}
      routeMode="prefixed"
      channel="coworking"
      view={parseListingViewMode(raw.view)}
    />
  )
}
