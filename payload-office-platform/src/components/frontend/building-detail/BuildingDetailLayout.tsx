import { RichText } from '@payloadcms/richtext-lexical/react'
import React from 'react'
import AdvisorCard from '@/components/frontend/AdvisorCard'
import BackToTop from '@/components/frontend/BackToTop'
import BuildingCardMini from '@/components/frontend/BuildingCardMini'
import BuildingKeyMetrics from '@/components/frontend/BuildingKeyMetrics'
import BuildingSupplyBrowser from '@/components/frontend/BuildingSupplyBrowser'
import CorrectionModal from '@/components/frontend/CorrectionModal'
import DetailAnchorNav from '@/components/frontend/DetailAnchorNav'
import DetailClickAnalytics from '@/components/frontend/DetailClickAnalytics'
import DetailFacts from '@/components/frontend/DetailFacts'
import DetailGallery from '@/components/frontend/DetailGallery'
import InquiryModal from '@/components/frontend/InquiryModal'
import LocationPanel from '@/components/frontend/LocationPanel'
import ShareSaveActions from '@/components/frontend/ShareSaveActions'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import { Breadcrumb } from '@/components/frontend/ui/Breadcrumb'
import { rentUnitLabel } from '@/lib/frontend/format'
import { siteConfig } from '@/lib/frontend/site-config'
import type {
  BuildingDetailViewModel,
  BuildingSummaryViewModel,
  BuildingSupplyGroupAvailability,
  BuildingSupplyPriceRange,
  BuildingSupplySnapshot,
  DistrictViewModel,
} from '@/domain/public-catalog'
import type { PoiByCategory } from '@/lib/frontend/location-pois'
import type { ServiceSchedule } from '@/domain/advisor-availability'

type BuildingDetailLayoutProps = Readonly<{
  building: BuildingDetailViewModel
  supply: BuildingSupplySnapshot
  relatedBuildings: readonly BuildingSummaryViewModel[]
  serviceSchedule?: ServiceSchedule
  pois: PoiByCategory
  mapEnabled: boolean
}>

const SUPPLY_GROUP_LABEL: Record<BuildingSupplyGroupAvailability['key'], string> = {
  lease: '出租',
  sale: '出售',
  coworking: '联合办公',
}

type PriceDisplayUnit = BuildingSupplyPriceRange['displayUnit']

const DISPLAY_UNIT_LABELS: Readonly<Record<PriceDisplayUnit, string>> = {
  'rmb-sqm-day': '元/㎡/天',
  'rmb-month': '元/月',
  'rmb-seat-month': '元/工位/月',
  'rmb-total': '元',
}

function findLowestPrice(groups: readonly BuildingSupplyGroupAvailability[]): {
  min: number
  displayUnit: PriceDisplayUnit
} | null {
  let result: { min: number; displayUnit: PriceDisplayUnit } | null = null
  for (const group of groups) {
    for (const range of group.priceRanges) {
      if (!result || range.min < result.min) {
        result = { min: range.min, displayUnit: range.displayUnit }
      }
    }
  }
  return result
}

function aggregateAreaRange(groups: readonly BuildingSupplyGroupAvailability[]): {
  min: number
  max: number
} | null {
  let min = Infinity
  let max = -Infinity
  for (const group of groups) {
    if (!group.areaRange) continue
    min = Math.min(min, group.areaRange.min)
    max = Math.max(max, group.areaRange.max)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

function formatAreaRange(range: { min: number; max: number }): string {
  if (range.min === range.max) return `${range.min} ㎡`
  return `${range.min}–${range.max} ㎡`
}

function SupplySectionSummary({
  totalEffectiveListings,
  availableGroups,
}: Readonly<{
  totalEffectiveListings: number
  availableGroups: readonly BuildingSupplyGroupAvailability[]
}>) {
  if (totalEffectiveListings === 0) {
    return <p className="detail-section__summary">当前暂无公开可选空间</p>
  }

  const areaRange = aggregateAreaRange(availableGroups)
  const lowest = findLowestPrice(availableGroups)

  const parts: string[] = [`当前在租 ${totalEffectiveListings} 套`]
  if (areaRange) parts.push(`可租面积 ${formatAreaRange(areaRange)}`)
  if (lowest) parts.push(`起价 ${lowest.min} ${DISPLAY_UNIT_LABELS[lowest.displayUnit]}`)

  return <p className="detail-section__summary">{parts.join(' · ')}</p>
}

export function BuildingSupplyPriceRanges({
  groups,
}: Readonly<{
  groups: readonly Pick<BuildingSupplyGroupAvailability, 'key' | 'priceRanges'>[]
}>) {
  const groupsWithRanges = groups.filter((group) => group.priceRanges.length > 0)
  if (groupsWithRanges.length === 0) return null

  return (
    <div className="price-range-group price-range-group--compact">
      {groupsWithRanges.map((group) => (
        <div key={group.key} className="price-range-group__supply" data-supply-group={group.key}>
          <h4 className="price-range-group__title">{SUPPLY_GROUP_LABEL[group.key]}</h4>
          <div className="price-range-group__list">
            {group.priceRanges.map((range) => {
              const unitLabel = rentUnitLabel(range.displayUnit) || range.displayUnit
              const rangeText =
                range.min === range.max
                  ? `${range.min} ${unitLabel}`
                  : `${range.min}–${range.max} ${unitLabel}`
              return (
                <div
                  key={`${group.key}:${range.key}`}
                  className="price-range-group__item"
                  data-price-range-key={`${group.key}:${range.key}`}
                >
                  <span className="price-range-group__unit">
                    {unitLabel}（{range.count} 套）
                  </span>
                  <span className="price-range-group__range">{rangeText}</span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function BuildingAmenities({ amenities }: Readonly<{ amenities: readonly string[] }>) {
  if (amenities.length === 0) return null
  return (
    <section className="detail__section" aria-labelledby="building-amenities-title">
      <h2 id="building-amenities-title">楼宇配套</h2>
      <ul className="detail__amenities">
        {amenities.map((amenity) => (
          <li key={amenity}>{amenity}</li>
        ))}
      </ul>
    </section>
  )
}

export default function BuildingDetailLayout({
  building,
  supply,
  relatedBuildings,
  serviceSchedule,
  pois,
  mapEnabled,
}: BuildingDetailLayoutProps) {
  const visibleRelatedBuildings = relatedBuildings.filter((item) => item.id !== building.id)
  const hasDescription = Boolean(building.description)
  const hasRelated = visibleRelatedBuildings.length > 0
  const hasFacts = building.factGroups.length > 0
  const hasAmenities = building.amenities.length > 0
  const hasSupply = supply.totalEffectiveListings > 0

  const anchors = [
    { id: 'overview', label: '楼盘参数', visible: hasFacts || hasAmenities },
    { id: 'supply', label: '在租房源', visible: true },
    { id: 'description', label: '楼盘说明', visible: hasDescription },
    { id: 'location', label: '位置交通', visible: true },
    { id: 'related', label: '相关楼盘', visible: hasRelated },
  ]

  const canonicalUrl = `${siteConfig.siteOrigin}/buildings/${building.slug}`

  return (
    <div className="detail">
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
              <span className="detail__grade-badge" data-grade={building.grade}>
                {gradeLabel}
              </span>
            ) : null
          })()}
        </div>
        <h1 className="detail__title">{building.name}</h1>
        {building.address && <p className="detail__building-summary">{building.address}</p>}
      </header>

      <BuildingKeyMetrics
        availableGroups={supply.availableGroups}
        totalEffectiveListings={supply.totalEffectiveListings}
        nearestMetro={building.nearestMetro ? { name: building.nearestMetro.name } : undefined}
        coordinates={building.coordinates}
      />

      <DetailAnchorNav items={anchors} />

      <section className="detail-hero" aria-label="楼盘核心信息">
        <DetailGallery media={building.mediaItems} title={building.name} pageType="building" />

        <aside className="detail__summary" aria-label="楼盘决策信息">
          <div className="detail__decision">
            <p className="detail__decision-title">
              {hasSupply
                ? `${supply.totalEffectiveListings} 套当前有效供给`
                : '暂无公开供给，也可登记找房需求'}
            </p>
            <AdvisorCard />
            <InquiryModal
              pageType="building"
              targetBuildingSlug={building.slug}
              targetSummary={building.name}
              triggerLabel={hasSupply ? '询价 / 预约看房' : '登记找房需求'}
              triggerClassName="btn--lg detail__decision-inquiry"
              sourceSection="hero"
              serviceSchedule={serviceSchedule}
            />
            <ShareSaveActions
              canonicalUrl={canonicalUrl}
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

      {(hasFacts || hasAmenities) && (
        <section id="overview" className="detail__section">
          <h2>楼盘参数</h2>
          {hasFacts && <DetailFacts groups={building.factGroups} />}
          <BuildingAmenities amenities={building.amenities} />
        </section>
      )}

      <section id="supply" className="detail__section" data-supply-as-of={supply.asOf}>
        <div className="detail-section__header">
          <h2>在租房源</h2>
          <SupplySectionSummary
            totalEffectiveListings={supply.totalEffectiveListings}
            availableGroups={supply.availableGroups}
          />
        </div>
        <BuildingSupplyPriceRanges groups={supply.availableGroups} />
        <BuildingSupplyBrowser snapshot={supply} buildingId={building.id} />
      </section>

      {building.description && (
        <section id="description" className="detail__section">
          <h2>楼盘说明</h2>
          <div className="richtext">
            <RichText data={building.description} />
          </div>
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
          serviceSchedule={serviceSchedule}
        />
      </div>

      <BackToTop />
      <DetailClickAnalytics />
    </div>
  )
}
