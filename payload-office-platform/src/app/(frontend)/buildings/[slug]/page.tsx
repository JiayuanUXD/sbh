import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import BuildingDetailLayout from '@/components/frontend/building-detail/BuildingDetailLayout'
import { getServiceSchedule } from '@/lib/frontend/service-schedule'
import { fetchNearbyPois } from '@/lib/frontend/location-pois'
import { buildBuildingJsonLd, buildBuildingMetadata, serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { siteConfig } from '@/lib/frontend/site-config'
import {
  getCachedBuildingDetail,
  getCachedRelatedBuildings,
} from '@/lib/frontend/cached-queries'
import {
  defaultSearchContext,
  getBuildingDetail,
  parseBuildingSupplySearchParams,
  type BuildingSupplyInput,
} from '@/domain/public-catalog'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const { building } = await getCachedBuildingDetail(slug)
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
  const supplyInput: BuildingSupplyInput = parseBuildingSupplySearchParams(await searchParams)
  const ctx = defaultSearchContext()
  const [{ building, supply }, relatedBuildings, serviceSchedule] = await Promise.all([
    getBuildingDetail(slug, ctx, supplyInput),
    getCachedRelatedBuildings(slug),
    getServiceSchedule(),
  ])
  if (!building) notFound()

  const pois = await fetchNearbyPois(building.id, building.coordinates)
  const mapEnabled =
    building.coordinates != null && Boolean(process.env.NEXT_PUBLIC_AMAP_JS_KEY)

  const jsonLd = buildBuildingJsonLd(building, supply, siteConfig.siteOrigin)

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <BuildingDetailLayout
        building={building}
        supply={supply}
        relatedBuildings={relatedBuildings}
        serviceSchedule={serviceSchedule}
        pois={pois}
        mapEnabled={mapEnabled}
      />
    </>
  )
}
