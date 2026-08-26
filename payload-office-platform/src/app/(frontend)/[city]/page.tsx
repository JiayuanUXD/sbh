import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import CityHomeView from '@/components/frontend/city/CityHomeView'
import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'
import { listPublicCityOptions, listPublicCityProfiles, resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { getCachedHomepage } from '@/lib/frontend/cached-queries'
import { buildCityPageMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled } from '@/lib/frontend/site-config'
import { isPublicCitySlug } from '@/lib/frontend/city-routes'
import { getCachedSiteSettings } from '@/lib/frontend/site-settings'

export const dynamicParams = true
export const revalidate = 300

export async function generateStaticParams(): Promise<{ city: string }[]> {
  let profiles: Awaited<ReturnType<typeof listPublicCityProfiles>>
  try {
    profiles = await listPublicCityProfiles()
  } catch {
    console.error('city_static_params_unavailable')
    return []
  }
  return profiles
    .filter((profile) => isPublicCitySlug(profile.citySlug))
    .map((profile) => ({ city: profile.citySlug }))
}

export async function generateMetadata({ params }: Readonly<{ params: Promise<{ city: string }> }>): Promise<Metadata> {
  const { city: slug } = await params
  const city = await resolveCityContext(slug)
  if (!city) return { title: '页面未找到', robots: { index: false, follow: false } }
  return buildCityPageMetadata({
    city,
    pageType: 'home',
    multiCityRoutingEnabled: getMultiCityRoutingEnabled(),
  })
}

export default async function CityHomePage({ params }: Readonly<{ params: Promise<{ city: string }> }>) {
  const { city: slug } = await params
  const city = await resolveCityContext(slug)
  if (!city) notFound()
  if (city.serviceStatus === 'coming-soon') {
    return <ComingSoonCityView city={city} />
  }
  // OPT-053：站点设置与首页数据并发拉；CityHomeView 保持同步纯编排层，
  // 由路由层负责取数（与 layout 那次读取在同一请求内由 unstable_cache 去重）。
  const [homepage, siteSettings] = await Promise.all([
    getCachedHomepage(city.slug),
    getCachedSiteSettings(),
  ])
  return <CityHomeView city={city} homepage={homepage} routeMode="prefixed" bandStats={homepage.stats} siteSettings={siteSettings} />
}
