import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'
import BuildingSupplyBrowser from '@/components/frontend/BuildingSupplyBrowser'
import DetailAnchorNav from '@/components/frontend/DetailAnchorNav'
import DetailClickAnalytics from '@/components/frontend/DetailClickAnalytics'
import DetailFacts from '@/components/frontend/DetailFacts'
import DetailGallery from '@/components/frontend/DetailGallery'
import InquiryModal from '@/components/frontend/InquiryModal'
import { rentUnitLabel } from '@/lib/frontend/format'
import { buildBuildingJsonLd, buildBuildingMetadata, serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { siteConfig } from '@/lib/frontend/site-config'
import {
  defaultSearchContext,
  getBuildingDetail,
  getRelatedBuildings,
  parseBuildingSupplySearchParams,
  type BuildingSupplyGroupViewModel,
  type BuildingSupplyInput,
} from '@/domain/public-catalog'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const ctx = defaultSearchContext()
  const { building } = await getBuildingDetail(slug, ctx)
  if (!building) {
    return {
      title: '楼盘未找到',
      robots: { index: false, follow: false },
    }
  }
  return buildBuildingMetadata(building, siteConfig.siteOrigin)
}

const SUPPLY_GROUP_LABEL: Record<BuildingSupplyGroupViewModel['key'], string> = {
  lease: '出租',
  sale: '出售',
  coworking: '联合办公',
}

/** Keeps price ranges visibly scoped to their supply group. */
export function BuildingSupplyPriceRanges({
  groups,
}: Readonly<{ groups: readonly BuildingSupplyGroupViewModel[] }>) {
  const groupsWithRanges = groups.filter((group) => group.priceRanges.length > 0)
  if (groupsWithRanges.length === 0) return null

  return (
    <div className="price-range-group">
      <h3 className="building-stats__label">按供给类型和计价单位分组的价格区间</h3>
      {groupsWithRanges.map((group) => (
        <div key={group.key} className="price-range-group__supply" data-supply-group={group.key}>
          <h4 className="building-stats__label">{SUPPLY_GROUP_LABEL[group.key]}</h4>
          {group.priceRanges.map((range) => {
            const unitLabel = rentUnitLabel(range.displayUnit) || range.displayUnit
            const rangeText = range.min === range.max
              ? `${range.min} ${unitLabel}`
              : `${range.min}–${range.max} ${unitLabel}`
            return (
              <div
                key={`${group.key}:${range.key}`}
                className="price-range-group__item"
                data-price-range-key={`${group.key}:${range.key}`}
              >
                <span className="price-range-group__unit">{unitLabel}（{range.count} 套）</span>
                <span className="price-range-group__range">{rangeText}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
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
  const [{ building, supply }, relatedBuildings] = await Promise.all([
    getBuildingDetail(slug, ctx, supplyInput),
    getRelatedBuildings(slug, ctx),
  ])
  if (!building) notFound()

  const visibleRelatedBuildings = relatedBuildings.filter((item) => item.id !== building.id)
  const hasDescription = Boolean(building.description)
  const hasRelated = visibleRelatedBuildings.length > 0
  const hasSupply = supply.totalEffectiveListings > 0
  const anchors = [
    { id: 'overview', label: '楼盘概况', visible: building.factGroups.length > 0 },
    { id: 'supply', label: '当前有效供给', visible: true },
    { id: 'description', label: '楼盘说明', visible: hasDescription },
    { id: 'related', label: '相关楼盘', visible: hasRelated },
  ]
  const jsonLd = buildBuildingJsonLd(building, supply, siteConfig.siteOrigin)

  return (
    <div className="detail">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <header className="detail__header">
        {building.district && <span className="detail__type">{building.district.name}</span>}
        <h1 className="detail__title">{building.name}</h1>
        {building.address && <p className="detail__building-summary">{building.address}</p>}
        {building.summary && <p className="detail__building-summary">{building.summary}</p>}
      </header>

      <section className="detail-hero" aria-label="楼盘核心信息">
        <DetailGallery media={building.mediaItems} title={building.name} pageType="building" />
        <section id="overview" className="detail__overview">
          <DetailFacts groups={building.factGroups} />
        </section>
      </section>

      <DetailAnchorNav items={anchors} />

      <section id="supply" className="detail__section" data-supply-as-of={supply.asOf}>
        <h2>当前有效供给</h2>
        {hasSupply && <BuildingSupplyPriceRanges groups={supply.groups} />}
        <BuildingSupplyBrowser snapshot={supply} buildingId={building.id} input={supplyInput} />
      </section>

      {building.description && (
        <section id="description" className="detail__section">
          <h2>楼盘说明</h2>
          <div className="richtext"><RichText data={building.description} /></div>
        </section>
      )}

      {hasRelated && (
        <section id="related" className="detail__section">
          <h2>相关楼盘</h2>
          <ul className="detail__related-buildings">
            {visibleRelatedBuildings.map((item, index) => (
              <li key={item.id}>
                <Link
                  href={`/buildings/${item.slug}`}
                  data-detail-analytics-event="related_building_click"
                  data-analytics-parent-id={building.id}
                  data-analytics-building-id={item.id}
                  data-analytics-rank={index + 1}
                  data-analytics-section="related"
                  data-analytics-recommendation-type="similar_building"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="detail__mobile-bar" role="region" aria-label="询价操作栏">
        <div className="detail__mobile-bar-info">
          <span className="detail__mobile-bar-title">{building.name}</span>
        </div>
        <InquiryModal
          pageType="building"
          targetBuildingSlug={building.slug}
          targetSummary={building.name}
          triggerLabel="咨询该楼盘"
          sourceSection="mobile-bar"
        />
      </div>
      <DetailClickAnalytics />
    </div>
  )
}
