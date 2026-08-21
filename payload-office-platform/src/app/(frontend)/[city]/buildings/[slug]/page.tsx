import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import BuildingDetailLayout from '@/components/frontend/building-detail/BuildingDetailLayout'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedBuildingDetail, getCachedRelatedBuildings } from '@/lib/frontend/cached-queries'
import { buildBuildingJsonLd, buildBuildingMetadata, serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { getServiceSchedule } from '@/lib/frontend/service-schedule'
import { fetchNearbyPois } from '@/lib/frontend/location-pois'
import { hasAmapJsKey } from '@/lib/frontend/amap-public-config'
import { resolveBuildingRouteIdentity, createSearchContext, getBuildingDetail, parseBuildingSupplySearchParams, buildBuildingSupplyCanonicalSearchParams, type BuildingSupplyInput } from '@/domain/public-catalog'

export const dynamic = 'force-dynamic'
type Props = Readonly<{ params: Promise<{ city: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }>

async function loadIdentity(params: Awaited<Props['params']>) {
  const city = await resolveCityContext(params.city)
  if (!city) return { city: null }
  const identity = await resolveBuildingRouteIdentity(params.slug)
  if (!identity) return { city, identity: null }
  if (identity.citySlug !== city.slug) redirect(`/${identity.citySlug}/buildings/${encodeURIComponent(identity.slug)}`)
  if (city.serviceStatus !== 'live') return { city, identity: null }
  return { city, identity }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolved = await params
  const loaded = await loadIdentity(resolved)
  if (!loaded.city || !loaded.identity) return { title: '楼盘未找到', robots: { index: false, follow: false } }
  const { building } = await getCachedBuildingDetail(loaded.city.slug, resolved.slug)
  if (!building) return { title: '楼盘未找到', robots: { index: false, follow: false } }
  const routingEnabled = getMultiCityRoutingEnabled()
  const metadata = buildBuildingMetadata(
    building,
    siteConfig.siteOrigin,
    routingEnabled ? { citySlug: loaded.city.slug } : undefined,
  )
  return routingEnabled ? metadata : { ...metadata, robots: { index: false, follow: true } }
}

export default async function CityBuildingDetailPage({ params, searchParams }: Props) {
  const resolved = await params
  const loaded = await loadIdentity(resolved)
  if (!loaded.city || !loaded.identity || loaded.city.serviceStatus !== 'live') notFound()
  const supplyInput: BuildingSupplyInput = parseBuildingSupplySearchParams(await searchParams)
  const [{ building, supply }, relatedBuildings, serviceSchedule] = await Promise.all([
    getBuildingDetail(resolved.slug, createSearchContext(loaded.city.slug), supplyInput),
    getCachedRelatedBuildings(loaded.city.slug, resolved.slug),
    getServiceSchedule(),
  ])
  if (!building) notFound()
  const pois = await fetchNearbyPois(building.id, building.coordinates)
  const citySlug = getMultiCityRoutingEnabled() ? loaded.city.slug : undefined
  const jsonLd = buildBuildingJsonLd(building, supply, siteConfig.siteOrigin, { citySlug })
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} /><BuildingDetailLayout building={building} supply={supply} relatedBuildings={relatedBuildings} serviceSchedule={serviceSchedule} pois={pois} mapEnabled={building.coordinates != null && hasAmapJsKey()} citySlug={citySlug} supplyCurrentSearch={buildBuildingSupplyCanonicalSearchParams(supplyInput).toString()} /></>
}
