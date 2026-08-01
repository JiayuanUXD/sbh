import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import AdvisorCard from '@/components/frontend/AdvisorCard'
import BuildingKeyMetrics from '@/components/frontend/BuildingKeyMetrics'
import BuildingSupplyBrowser from '@/components/frontend/BuildingSupplyBrowser'
import BuildingCardMini from '@/components/frontend/BuildingCardMini'
import CorrectionModal from '@/components/frontend/CorrectionModal'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import DetailAnchorNav from '@/components/frontend/DetailAnchorNav'
import DetailClickAnalytics from '@/components/frontend/DetailClickAnalytics'
import DetailFacts from '@/components/frontend/DetailFacts'
import DetailGallery from '@/components/frontend/DetailGallery'
import InquiryModal from '@/components/frontend/InquiryModal'
import LocationPanel from '@/components/frontend/LocationPanel'
import ShareSaveActions from '@/components/frontend/ShareSaveActions'
import { Breadcrumb } from '@/components/frontend/ui/Breadcrumb'
import { rentUnitLabel } from '@/lib/frontend/format'
import { fetchNearbyPois } from '@/lib/frontend/location-pois'
import { buildBuildingJsonLd, buildBuildingMetadata, serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { siteConfig } from '@/lib/frontend/site-config'
import {
  defaultSearchContext,
  getBuildingDetail,
  getRelatedBuildings,
  parseBuildingSupplySearchParams,
  type BuildingSupplyGroupAvailability,
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
}: Readonly<{ groups: readonly Pick<BuildingSupplyGroupViewModel, 'key' | 'priceRanges'>[] }>) {
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

function areaRangeLabel(range: BuildingSupplyGroupAvailability['areaRange']): string {
  if (!range) return '面积待确认'
  return range.min === range.max ? `${range.min} ㎡` : `${range.min}–${range.max} ㎡`
}

/** Canonical, query-independent supply overview generated from the same public snapshot. */
export function BuildingSupplyOverview({
  groups,
}: Readonly<{ groups: readonly BuildingSupplyGroupAvailability[] }>) {
  if (groups.length === 0) return null

  return (
    <section className="building-supply-overview" aria-labelledby="building-supply-overview-title">
      <h2 id="building-supply-overview-title">供给概览</h2>
      <div className="building-supply-overview__groups">
        {groups.map((group) => (
          <article key={group.key} className="building-supply-overview__group">
            <h3>{SUPPLY_GROUP_LABEL[group.key]}</h3>
            <dl>
              <div>
                <dt>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                  有效供给
                </dt>
                <dd><strong>{group.totalEffectiveListings}</strong> 套</dd>
              </div>
              <div>
                <dt>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M9 3v18M3 9h18" /></svg>
                  可选面积
                </dt>
                <dd>{areaRangeLabel(group.areaRange)}</dd>
              </div>
              <div>
                <dt>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11l3 3 8-8M5 12a7 7 0 1014 0 7 7 0 00-14 0z" /></svg>
                  立即可入驻
                </dt>
                <dd><strong>{group.immediateAvailabilityCount}</strong> 套</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
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

  const pois = await fetchNearbyPois(building.id, building.coordinates)
  const mapEnabled =
    building.coordinates != null && Boolean(process.env.NEXT_PUBLIC_AMAP_JS_KEY)

  const visibleRelatedBuildings = relatedBuildings.filter((item) => item.id !== building.id)
  const hasDescription = Boolean(building.description)
  const hasRelated = visibleRelatedBuildings.length > 0
  const hasSupply = supply.totalEffectiveListings > 0
  const anchors = [
    { id: 'overview', label: '楼盘概况', visible: building.factGroups.length > 0 },
    { id: 'supply', label: '当前有效供给', visible: true },
    { id: 'description', label: '楼盘说明', visible: hasDescription },
    { id: 'location', label: '位置交通', visible: true },
    { id: 'related', label: '相关楼盘', visible: hasRelated },
  ]
  const jsonLd = buildBuildingJsonLd(building, supply, siteConfig.siteOrigin)

  return (
    <div className="detail">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <Breadcrumb
        items={[
          { label: '首页', href: '/' },
          { label: '办公选址', href: '/listings' },
          ...(building.district ? [{ label: building.district.name }] : []),
          { label: building.name },
        ]}
      />
      <header className="detail__header">
        <div className="detail__header-tags">
          {building.district && <span className="detail__type">{building.district.name}</span>}
          {(() => {
            const gradeLabel = getBuildingGradeLabel(building.grade)
            return gradeLabel ? (
              <span className="detail__grade-badge" data-grade={building.grade}>{gradeLabel}</span>
            ) : null
          })()}
        </div>
        <h1 className="detail__title">{building.name}</h1>
        {building.address && <p className="detail__building-summary">{building.address}</p>}
        {building.summary && <p className="detail__building-summary">{building.summary}</p>}
      </header>

      <BuildingKeyMetrics
        availableGroups={supply.availableGroups}
        totalEffectiveListings={supply.totalEffectiveListings}
        nearestMetro={building.nearestMetro ? { name: building.nearestMetro.name } : undefined}
        coordinates={building.coordinates}
      />

      <section className="detail-hero" aria-label="楼盘核心信息">
        <DetailGallery media={building.mediaItems} title={building.name} pageType="building" />
        <aside className="detail__summary" aria-label="楼盘决策信息">
          <section id="overview" className="detail__overview">
            <DetailFacts groups={building.factGroups} />
          </section>
          <BuildingSupplyOverview groups={supply.availableGroups} />
          <div className="detail__decision">
            <p className="detail__decision-title">
              {hasSupply ? `${supply.totalEffectiveListings} 套当前有效供给` : '暂无公开供给，也可登记找房需求'}
            </p>
            <AdvisorCard />
            <InquiryModal
              pageType="building"
              targetBuildingSlug={building.slug}
              targetSummary={building.name}
              triggerLabel={hasSupply ? '询价 / 预约看房' : '登记找房需求'}
              triggerClassName="btn--lg detail__decision-inquiry"
              sourceSection="hero"
            />
            <ShareSaveActions
              canonicalUrl={`${siteConfig.siteOrigin}/buildings/${building.slug}`}
              savedDetail={{ type: 'building', id: building.id, slug: building.slug }}
            />
            <CorrectionModal
              targetType="building"
              targetSlug={building.slug}
              targetSummary={building.name}
            />
          </div>
        </aside>
      </section>

      <DetailAnchorNav items={anchors} />

      <section id="supply" className="detail__section" data-supply-as-of={supply.asOf}>
        <h2>当前有效供给</h2>
        {hasSupply && <BuildingSupplyPriceRanges groups={supply.availableGroups} />}
        <BuildingSupplyBrowser snapshot={supply} buildingId={building.id} input={supplyInput} />
      </section>

      {building.description && (
        <section id="description" className="detail__section">
          <h2>楼盘说明</h2>
          <div className="richtext"><RichText data={building.description} /></div>
        </section>
      )}

      <LocationPanel
        building={{
          id: building.id,
          name: building.name,
          address: building.address,
          coordinates: building.coordinates,
          nearestMetro: building.nearestMetro
            ? { name: building.nearestMetro.name }
            : undefined,
        }}
        pois={pois}
        mapEnabled={mapEnabled}
      />

      {hasRelated && (
        <section id="related" className="detail__section">
          <h2>相关楼盘</h2>
          <div className="card-grid">
            {visibleRelatedBuildings.map((item, index) => (
              <BuildingCardMini
                key={item.id}
                building={item}
                parentId={building.id}
                rank={index + 1}
              />
            ))}
          </div>
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
