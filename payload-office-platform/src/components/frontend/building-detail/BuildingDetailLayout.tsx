import { RichText } from '@payloadcms/richtext-lexical/react'
import React from 'react'
import BackToTop from '@/components/frontend/BackToTop'
import BuildingCardMini from '@/components/frontend/BuildingCardMini'
import BuildingSupplyBrowser from '@/components/frontend/BuildingSupplyBrowser'
import CorrectionModal from '@/components/frontend/CorrectionModal'
import DetailClickAnalytics from '@/components/frontend/DetailClickAnalytics'
import DetailFacts from '@/components/frontend/DetailFacts'
import DetailGallery from '@/components/frontend/DetailGallery'
import InquiryModal from '@/components/frontend/InquiryModal'
import LocationPanel from '@/components/frontend/LocationPanel'
import ShareSaveActions from '@/components/frontend/ShareSaveActions'
import { Breadcrumb } from '@/components/frontend/ui/Breadcrumb'
import { rentUnitLabel } from '@/lib/frontend/format'
import { siteConfig } from '@/lib/frontend/site-config'
import DetailSideRail from './DetailSideRail'
import HeroSummaryPanel from './HeroSummaryPanel'
import NearbyBuildingsStrip from './NearbyBuildingsStrip'
import {
  aggregateAreaRange,
  DISPLAY_UNIT_LABELS,
  findLowestPrice,
  formatAreaRange,
} from './supply-summary'
import type {
  BuildingDetailViewModel,
  BuildingSummaryViewModel,
  BuildingSupplySnapshot,
} from '@/domain/public-catalog'
import type { PoiByCategory } from '@/lib/frontend/location-pois'
import type { ServiceSchedule } from '@/domain/advisor-availability'

/**
 * 楼盘详情布局：对标 58 商办详情结构。
 * 首屏画廊+决策面板，房源区主列+粘性右栏，参数/特色合并，位置灰底成带。
 */
type BuildingDetailLayoutProps = Readonly<{
  building: BuildingDetailViewModel
  supply: BuildingSupplySnapshot
  relatedBuildings: readonly BuildingSummaryViewModel[]
  serviceSchedule?: ServiceSchedule
  pois: PoiByCategory
  mapEnabled: boolean
  citySlug?: string
}>

function SupplySectionSummary({
  totalEffectiveListings,
  availableGroups,
}: Readonly<{
  totalEffectiveListings: number
  availableGroups: BuildingSupplySnapshot['availableGroups']
}>) {
  if (totalEffectiveListings === 0) {
    return <p className="detail-section__summary">当前暂无公开可选空间</p>
  }

  const areaRange = aggregateAreaRange(availableGroups)
  const lowest = findLowestPrice(availableGroups)

  const parts: string[] = [`当前在租 ${totalEffectiveListings} 套`]
  if (areaRange) parts.push(`可租面积 ${formatAreaRange(areaRange)}`)
  if (lowest)
    parts.push(
      `起价 ${lowest.min} ${rentUnitLabel(lowest.displayUnit) || DISPLAY_UNIT_LABELS[lowest.displayUnit]}`,
    )

  return <p className="detail-section__summary">{parts.join(' · ')}</p>
}

function BuildingAmenityTags({ amenities }: Readonly<{ amenities: readonly string[] }>) {
  if (amenities.length === 0) return null
  return (
    <ul className="detail__amenities">
      {amenities.map((amenity) => (
        <li key={amenity}>{amenity}</li>
      ))}
    </ul>
  )
}

export default function BuildingDetailLayout({
  building,
  supply,
  relatedBuildings,
  serviceSchedule,
  pois,
  mapEnabled,
  citySlug,
}: BuildingDetailLayoutProps) {
  const visibleRelatedBuildings = relatedBuildings.filter((item) => item.id !== building.id)
  const hasDescription = Boolean(building.description)
  const hasRelated = visibleRelatedBuildings.length > 0
  const hasFacts = building.factGroups.length > 0
  const hasAmenities = building.amenities.length > 0
  const hasParams = hasFacts || hasAmenities || hasDescription

  const basePath = citySlug ? `/${citySlug}` : ''
  const canonicalUrl = `${siteConfig.siteOrigin}${basePath}/buildings/${encodeURIComponent(building.slug)}`

  return (
    <div className="detail detail--v2">
      <Breadcrumb
        items={[
          { label: '首页', href: basePath || '/' },
          { label: '办公选址', href: `${basePath}/listings` },
          ...(building.district ? [{ label: building.district.name }] : []),
          { label: building.name },
        ]}
      />

      <header className="detail-v2__titlebar">
        <div>
          <h1 className="detail__title">{building.name}</h1>
        </div>
        <div className="detail-v2__titlebar-actions">
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
      </header>

      <section className="detail-v2__hero" aria-label="楼盘核心信息">
        <DetailGallery media={building.mediaItems} title={building.name} pageType="building" />
        <HeroSummaryPanel
          building={building}
          supply={supply}
          serviceSchedule={serviceSchedule}
        />
      </section>

      <section id="supply" className="detail-v2__supply" data-supply-as-of={supply.asOf}>
        <div className="detail-v2__supply-main">
          <div className="detail-section__header">
            <h2>在租房源</h2>
            <SupplySectionSummary
              totalEffectiveListings={supply.totalEffectiveListings}
              availableGroups={supply.availableGroups}
            />
          </div>
          <BuildingSupplyBrowser snapshot={supply} buildingId={building.id} citySlug={citySlug} />
        </div>
        <DetailSideRail
          building={building}
          supply={supply}
          relatedBuildings={relatedBuildings}
          serviceSchedule={serviceSchedule}
          citySlug={citySlug}
        />
      </section>

      {hasParams && (
        <section id="params" className="detail__section">
          <h2>楼盘参数</h2>
          {hasFacts && <DetailFacts groups={building.factGroups} />}
          <BuildingAmenityTags amenities={building.amenities} />
          {building.description && (
            <>
              <h3 className="detail-v2__subsection-title">楼盘特色</h3>
              <div className="richtext detail-v2__features-body">
                <RichText data={building.description} />
              </div>
            </>
          )}
        </section>
      )}

      {/* 不在这层重复 id="location"——LocationPanel 自己的 <section> 已经带这个
          id（CityListingDetailView 里 LocationPanel 是顶层用法，没有外层 section
          包着，id 必须留在组件自身上）。两层都挂 id 会产生同页重复 id，
          `#location` 选择器虽然仍能命中第一个（Playwright/CSS 的 .first()
          语义），但是无效 HTML；这里去掉外层这份是唯一安全的修法——反过来
          从组件里摘掉会破坏 CityListingDetailView 的顶层锚点。
          Task 5 起 LocationPanel 无坐标时返回 null，本 section 仍可能只剩
          NearbyBuildingsStrip（该组件不需要独立锚点，仓库内没有指向
          #location 的其它导航引用）。 */}
      <section className="detail-v2__location-band">
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
        <NearbyBuildingsStrip buildings={visibleRelatedBuildings} citySlug={citySlug} />
      </section>

      {hasRelated && (
        <section id="related" className="detail__section">
          <h2>猜你喜欢</h2>
          <div className="card-grid">
            {visibleRelatedBuildings.map((item, index) => (
              <BuildingCardMini
                key={item.id}
                building={item}
                parentId={building.id}
                rank={index + 1}
                citySlug={citySlug}
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
