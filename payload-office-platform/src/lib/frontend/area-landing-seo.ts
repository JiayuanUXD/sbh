import type { Metadata } from 'next'
import { areaLandingPath } from '@/domain/public-catalog/area-landing'
import type { AreaLandingCopy } from '@/domain/public-catalog/area-landing'
import type { AreaLandingEntry } from '@/domain/public-catalog/area-landing-facade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'
import { validateSiteOrigin } from '@/lib/frontend/detail-metadata'
import { buildPageMetadata } from '@/lib/frontend/metadata'

/**
 * 区域 / 商圈落地页的 Metadata 与 JSON-LD（OPT-119）。
 *
 * - JSON-LD 的 URL 一律绝对（沿 OPT-118 的规则），origin 经 `validateSiteOrigin` 校验；
 * - 只输出 BreadcrumbList 与 ItemList（热门楼盘）。**不输出**价格 / 评分 / FAQPage：
 *   区域不是商品，租金中位数不是任何一条 Offer；FAQPage 富结果已被 Google 限制，只增加维护面。
 */

type BuildAreaLandingMetadataInput = Readonly<{
  entry: Pick<AreaLandingEntry, 'slug' | 'indexable'>
  copy: Pick<AreaLandingCopy, 'title' | 'description'>
  citySlug: string
  serviceStatus: 'live' | 'coming-soon'
  multiCityRoutingEnabled: boolean
}>

export function buildAreaLandingMetadata(input: BuildAreaLandingMetadataInput): Metadata {
  // 多城开关关闭时带前缀的路径整体 noindex（与 buildCityPageMetadata 同一取舍）；
  // 薄页（在租房源不足门槛）与未开通城市同样不收录，但 follow，让权重继续往下传。
  const indexable = input.entry.indexable && input.multiCityRoutingEnabled && input.serviceStatus === 'live'
  return buildPageMetadata({
    title: input.copy.title,
    description: input.copy.description,
    canonicalPath: areaLandingPath(input.citySlug, input.entry.slug),
    robots: indexable ? 'index' : 'noindex',
  })
}

type JsonLdListItem = Readonly<{ '@type': 'ListItem'; position: number; name: string; item: string }>
type BreadcrumbJsonLd = Readonly<{ '@context': 'https://schema.org'; '@type': 'BreadcrumbList'; itemListElement: readonly JsonLdListItem[] }>
type ItemListJsonLd = Readonly<{
  '@context': 'https://schema.org'
  '@type': 'ItemList'
  numberOfItems: number
  itemListElement: readonly Readonly<{ '@type': 'ListItem'; position: number; name: string; url: string }>[]
}>

export type AreaLandingJsonLd = BreadcrumbJsonLd | ItemListJsonLd

export function buildAreaLandingJsonLd(input: Readonly<{
  origin: string
  city: Readonly<{ slug: string; name: string }>
  entry: Pick<AreaLandingEntry, 'slug' | 'name'>
  /** 商圈所属行政区（本身可见才传，否则面包屑直接从城市接到本页）。 */
  parent: Pick<AreaLandingEntry, 'slug' | 'name'> | null
  topBuildings: readonly Pick<BuildingSummaryViewModel, 'slug' | 'name'>[]
}>): AreaLandingJsonLd[] {
  const origin = validateSiteOrigin(input.origin)
  const crumbs: Array<Readonly<{ name: string; path: string }>> = [
    { name: '首页', path: '/' },
    { name: input.city.name, path: `/${input.city.slug}` },
  ]
  if (input.parent) crumbs.push({ name: input.parent.name, path: areaLandingPath(input.city.slug, input.parent.slug) })
  crumbs.push({ name: input.entry.name, path: areaLandingPath(input.city.slug, input.entry.slug) })

  const documents: AreaLandingJsonLd[] = [{
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: `${origin}${crumb.path}`,
    })),
  }]

  if (input.topBuildings.length > 0) {
    documents.push({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      numberOfItems: input.topBuildings.length,
      itemListElement: input.topBuildings.map((building, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: building.name,
        url: `${origin}/${input.city.slug}/buildings/${encodeURIComponent(building.slug)}`,
      })),
    })
  }
  return documents
}
