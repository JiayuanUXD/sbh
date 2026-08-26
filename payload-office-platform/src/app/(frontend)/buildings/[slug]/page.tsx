import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import React from 'react'
import BuildingDetailLayout from '@/components/frontend/building-detail/BuildingDetailLayout'
import { getServiceSchedule } from '@/lib/frontend/service-schedule'
import { fetchNearbyPois } from '@/lib/frontend/location-pois'
import { buildBuildingJsonLd, buildBuildingMetadata, serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'
import { hasAmapJsKey } from '@/lib/frontend/amap-public-config'
import {
  getCachedBuildingDetail,
  getCachedRelatedBuildings,
} from '@/lib/frontend/cached-queries'
import {
  buildBuildingSupplyCanonicalSearchParams,
  createSearchContext,
  getBuildingDetail,
  parseBuildingSupplySearchParams,
  type BuildingSupplyInput,
  resolveBuildingRouteIdentity,
} from '@/domain/public-catalog'
import { getCachedSiteSettings } from '@/lib/frontend/site-settings'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  if (getMultiCityRoutingEnabled()) {
    const identity = await resolveBuildingRouteIdentity(slug)
    if (!identity) notFound()
    redirect(`/${identity.citySlug}/buildings/${encodeURIComponent(identity.slug)}`)
  }
  const { building } = await getCachedBuildingDetail(siteConfig.defaultCity, slug)
  if (!building) {
    return {
      title: '楼盘未找到',
      robots: { index: false, follow: false },
    }
  }
  return buildBuildingMetadata(building, siteConfig.siteOrigin)
}

export default async function BuildingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  if (getMultiCityRoutingEnabled()) {
    const identity = await resolveBuildingRouteIdentity(slug)
    if (!identity) notFound()
    redirect(`/${identity.citySlug}/buildings/${encodeURIComponent(identity.slug)}`)
  }
  const supplyInput: BuildingSupplyInput = parseBuildingSupplySearchParams(await searchParams)
  const ctx = createSearchContext(siteConfig.defaultCity)
  const [{ building, supply }, relatedBuildings, serviceSchedule] = await Promise.all([
    getBuildingDetail(slug, ctx, supplyInput),
    getCachedRelatedBuildings(siteConfig.defaultCity, slug),
    getServiceSchedule(),
  ])
  if (!building) notFound()

  const pois = await fetchNearbyPois(building.id, building.coordinates)
  const mapEnabled = building.coordinates != null && hasAmapJsKey()

  const jsonLd = buildBuildingJsonLd(building, supply, siteConfig.siteOrigin)

  // OPT-053：合规声明来自「站点设置」。与 layout 那次读取在同一请求内由
  // unstable_cache 去重，不多打一次库；缺省时各子组件用自己的字面量兜底。
  const siteSettings = await getCachedSiteSettings()
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <BuildingDetailLayout
        disclaimers={{ price: siteSettings.priceDisclaimer, image: siteSettings.imageDisclaimer }}
        building={building}
        supply={supply}
        relatedBuildings={relatedBuildings}
        serviceSchedule={serviceSchedule}
        pois={pois}
        mapEnabled={mapEnabled}
        supplyCurrentSearch={buildBuildingSupplyCanonicalSearchParams(supplyInput).toString()}
      />
    </>
  )
}
