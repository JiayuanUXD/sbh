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
import { getCachedSiteSettings } from '@/lib/frontend/site-settings'

export const dynamic = 'force-dynamic'
type Props = Readonly<{ params: Promise<{ city: string; slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }>

async function redirectIfCrossCityBuilding(citySlug: string, slug: string): Promise<void> {
  const identity = await resolveBuildingRouteIdentity(slug)
  if (identity && identity.citySlug !== citySlug) {
    redirect(`/${identity.citySlug}/buildings/${encodeURIComponent(identity.slug)}`)
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolved = await params
  const city = await resolveCityContext(resolved.city)
  if (!city) return { title: '楼盘未找到', robots: { index: false, follow: false } }
  if (city.serviceStatus === 'live') {
    const detail = await getCachedBuildingDetail(city.slug, resolved.slug)
    if (detail?.building && detail.building.slug === resolved.slug) {
      const routingEnabled = getMultiCityRoutingEnabled()
      const metadata = buildBuildingMetadata(
        detail.building,
        siteConfig.siteOrigin,
        routingEnabled ? { citySlug: city.slug } : undefined,
      )
      return routingEnabled ? metadata : { ...metadata, robots: { index: false, follow: true } }
    }
  }
  await redirectIfCrossCityBuilding(city.slug, resolved.slug)
  return { title: '楼盘未找到', robots: { index: false, follow: false } }
}

export default async function CityBuildingDetailPage({ params, searchParams }: Props) {
  const resolved = await params
  const city = await resolveCityContext(resolved.city)
  if (!city) notFound()
  if (city.serviceStatus !== 'live') {
    await redirectIfCrossCityBuilding(city.slug, resolved.slug)
    notFound()
  }
  const supplyInput: BuildingSupplyInput = parseBuildingSupplySearchParams(await searchParams)
  const supplyCurrentSearch = buildBuildingSupplyCanonicalSearchParams(supplyInput).toString()
  const [detail, relatedBuildings, serviceSchedule] = await Promise.all([
    supplyCurrentSearch === ''
      ? getCachedBuildingDetail(city.slug, resolved.slug)
      : getBuildingDetail(resolved.slug, createSearchContext(city.slug), supplyInput),
    getCachedRelatedBuildings(city.slug, resolved.slug),
    getServiceSchedule(),
  ])
  const building = detail?.building?.slug === resolved.slug ? detail.building : null
  const supply = detail?.supply
  if (!building || !supply) {
    await redirectIfCrossCityBuilding(city.slug, resolved.slug)
    notFound()
  }
  const pois = await fetchNearbyPois(building.id, building.coordinates)
  const citySlug = getMultiCityRoutingEnabled() ? city.slug : undefined
  const jsonLd = buildBuildingJsonLd(building, supply, siteConfig.siteOrigin, { citySlug })
  // OPT-053：合规声明来自「站点设置」。与 layout 那次读取在同一请求内由
  // unstable_cache 去重，不多打一次库；缺省时各子组件用自己的字面量兜底。
  const siteSettings = await getCachedSiteSettings()
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} /><BuildingDetailLayout disclaimers={{ price: siteSettings.priceDisclaimer, image: siteSettings.imageDisclaimer }} specVisibility={siteSettings.detailSpecFields.building} building={building} supply={supply} relatedBuildings={relatedBuildings} serviceSchedule={serviceSchedule} pois={pois} mapEnabled={building.coordinates != null && hasAmapJsKey()} citySlug={citySlug} supplyCurrentSearch={supplyCurrentSearch} /></>
}
