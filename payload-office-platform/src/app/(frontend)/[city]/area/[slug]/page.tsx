import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import AreaLandingView from '@/components/frontend/city/AreaLandingView'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { buildAreaLandingCopy } from '@/domain/public-catalog/area-landing'
import type { AreaLandingPage } from '@/domain/public-catalog/area-landing-facade'
import { getCachedAreaLanding } from '@/lib/frontend/cached-queries'
import { buildAreaLandingJsonLd, buildAreaLandingMetadata } from '@/lib/frontend/area-landing-seo'
import { serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { buildNotFoundMetadata } from '@/lib/frontend/metadata'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'

/**
 * 区域 / 商圈落地页 `/{city}/area/{slug}`（OPT-119）。
 *
 * 行政区与商圈共用本路由：`locations.slug` 全局唯一，类型由地点表决定。不用
 * `/{city}/buildings/{区slug}`——那一段已经是楼盘详情，两种实体共用一个动态段需要在详情页
 * 404 之前再兜一层区域查询，且楼盘 slug 与区域 slug 之间没有任何唯一性约束。
 *
 * 只对已开通城市、前台可见的地点生成；其余一律 404。是否收录由 `entry.indexable` 决定
 * （在租房源 ≥ 门槛），薄页照常渲染诚实空态但 noindex。
 */

export const dynamic = 'force-dynamic'

type Props = Readonly<{ params: Promise<{ city: string; slug: string }> }>

/** Next 给的动态段可能仍是百分号编码；畸形编码按 404 处理而不是抛 500。 */
function decodeSlug(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

function copyFor(cityName: string, page: AreaLandingPage) {
  const { entry, parent, topBuildings, childAreas } = page
  return buildAreaLandingCopy({
    cityName,
    location: { kind: entry.kind, name: entry.name, description: entry.description },
    parentName: parent?.name ?? entry.parentName,
    stats: entry,
    topBuildings: topBuildings.map((building) => ({ name: building.name, listingCount: building.listingCount ?? 0 })),
    childAreas: childAreas.map((area) => ({ name: area.name, listingCount: area.listingCount })),
  })
}

async function load(params: Props['params']) {
  const resolved = await params
  const slug = decodeSlug(resolved.slug)
  if (slug === null) return null
  const city = await resolveCityContext(resolved.city)
  // 未开通城市没有供给统计，也没有这类页面：不查库直接 404。
  if (!city || city.serviceStatus !== 'live') return null
  const page = await getCachedAreaLanding(city.slug, slug)
  return page ? { city, page } : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load(params)
  if (!loaded) return buildNotFoundMetadata('区域未找到')
  const { city, page } = loaded
  return buildAreaLandingMetadata({
    entry: page.entry,
    copy: copyFor(city.name, page),
    citySlug: city.slug,
    serviceStatus: city.serviceStatus,
    multiCityRoutingEnabled: getMultiCityRoutingEnabled(),
  })
}

export default async function AreaLandingRoute({ params }: Props) {
  const loaded = await load(params)
  if (!loaded) notFound()
  const { city, page } = loaded
  const jsonLd = buildAreaLandingJsonLd({
    origin: siteConfig.siteOrigin,
    city: { slug: city.slug, name: city.name },
    entry: page.entry,
    parent: page.parent,
    topBuildings: page.topBuildings,
  })
  return (
    <>
      {jsonLd.map((document) => (
        <script
          key={document['@type']}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(document) }}
        />
      ))}
      <AreaLandingView city={{ slug: city.slug, name: city.name }} page={page} />
    </>
  )
}
