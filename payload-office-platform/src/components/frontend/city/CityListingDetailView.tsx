import { RichText } from '@payloadcms/richtext-lexical/react'
import React from 'react'
import AdvisorCard from '@/components/frontend/AdvisorCard'
import AmenityList from '@/components/frontend/AmenityList'
import BackToTop from '@/components/frontend/BackToTop'
import BuildingSummaryCard from '@/components/frontend/BuildingSummaryCard'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import CorrectionModal from '@/components/frontend/CorrectionModal'
import DetailClickAnalytics from '@/components/frontend/DetailClickAnalytics'
import type { SpecRow } from '@/components/frontend/detail/SpecTable'
import DetailFacts from '@/components/frontend/DetailFacts'
import DetailGallery from '@/components/frontend/DetailGallery'
import DetailMobileBarPrice from '@/components/frontend/DetailMobileBarPrice'
import InquiryModal from '@/components/frontend/InquiryModal'
import ListingCard from '@/components/frontend/ListingCard'
import LocationPanel from '@/components/frontend/LocationPanel'
import RecommendationReason from '@/components/frontend/RecommendationReason'
import ShareSaveActions from '@/components/frontend/ShareSaveActions'
import { Breadcrumb } from '@/components/frontend/ui/Breadcrumb'
import type { CityContext } from '@/domain/city-site-profile/resolver'
import type { ListingDetailViewModel } from '@/domain/public-catalog/contracts'
import { DECORATION_STATUS_LABELS } from '@/domain/review/listing-fields'
import { buildListingJsonLd, serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { formatArea, formatAvailableDate } from '@/lib/frontend/format'
import { LISTING_TYPE_LABEL } from '@/lib/frontend/listing-display'
import { siteConfig } from '@/lib/frontend/site-config'
import type { PoiByCategory } from '@/lib/frontend/location-pois'
import type { ServiceSchedule } from '@/domain/advisor-availability'
import type { getCachedBuildingBySlug, getCachedDetailRecommendations } from '@/lib/frontend/cached-queries'

type RouteMode = 'legacy' | 'prefixed'
type BuildingDetail = Awaited<ReturnType<typeof getCachedBuildingBySlug>>
type Recommendations = Awaited<ReturnType<typeof getCachedDetailRecommendations>>

/**
 * Shared DTO-only detail presentation. Both the legacy default-city page and
 * the prefixed city page supply their route-owned data to this component.
 */
export default function CityListingDetailView({
  city,
  listing,
  buildingDetail,
  recommendations,
  pois,
  serviceSchedule,
  mapEnabled,
  routeMode,
}: Readonly<{
  city: CityContext
  listing: ListingDetailViewModel
  buildingDetail: BuildingDetail
  recommendations: Recommendations
  pois: PoiByCategory
  serviceSchedule?: ServiceSchedule
  mapEnabled: boolean
  routeMode: RouteMode
}>) {
  const basePath = routeMode === 'prefixed' ? `/${city.slug}` : ''
  const listingPath = `${basePath}/listings/${encodeURIComponent(listing.slug)}`
  const building = listing.building
  const media = listing.mediaItems.length > 0
    ? listing.mediaItems
    : listing.gallery.map((resource, index) => ({
        id: `legacy-gallery-${index}-${resource.src}`,
        kind: 'image' as const,
        category: '图片',
        resource,
        capturedAt: null,
        isSchematic: false,
      }))
  // 无图替代构图（OPT-037 Task 2）：六项关键规格逐一核实可达——全部取自
  // ListingDetailViewModel 顶层字段或其 building 子对象，不解析 factGroups
  // 里已拼好 suffix 的字符串（那些是「值嵌单位的键值行」格式，不是这里
  // 要的「大数值 + 独立单位」格式）。地址取 building.address；「交通」
  // comp 原稿要的是「地铁站 + 距离 + 步行时间」，但距离/步行时间只有
  // LocationPanel 消费的 pois（POI 检索结果）里才有，DetailGallery 这一层
  // 拿不到，也不该为了六个字段把整个 POI 依赖搭进来——因此换成可达的
  // 「近 {地铁站名}」，不编造距离与步行时间。
  const noMediaKeySpecs: readonly SpecRow[] = [
    { label: '建筑面积', value: listing.area != null ? String(listing.area) : null, unit: '㎡' },
    { label: '工位数', value: listing.seats != null ? String(listing.seats) : null, unit: '个' },
    {
      label: '装修状态',
      value: listing.decorationStatus ? DECORATION_STATUS_LABELS[listing.decorationStatus] : null,
    },
    { label: '房源类型', value: LISTING_TYPE_LABEL[listing.listingType] },
    { label: '可入驻', value: formatAvailableDate(listing.availableFrom) },
    { label: '楼盘等级', value: getBuildingGradeLabel(building?.grade) ?? null },
  ]
  const noMediaAddress = building?.address ?? null
  const noMediaTransit = building?.nearestMetro?.name ? `近${building.nearestMetro.name}` : null

  const rentText = listing.price?.text ?? '价格面议'
  const inquirySupplyGroup: 'lease' | 'sale' | 'coworking' =
    listing.listingType === 'coworking' ? 'coworking' : listing.businessType
  const inquiryPriceSnapshot = listing.price
    ? {
        amount: listing.price.amount,
        currency: listing.price.currency,
        period: listing.price.period,
        unit: listing.price.displayUnit,
      } as const
    : undefined
  const inquiryCurrentFilters = {
    group: inquirySupplyGroup,
    ...(listing.price ? { priceUnit: listing.price.displayUnit } : {}),
  } as const
  const headerHighlights = listing.highlights.slice(0, 3)
  const seenAmenities = new Set<string>(headerHighlights)
  const dedupedAmenityGroups = [
    ...listing.amenityGroups,
    ...(buildingDetail?.amenityGroups.filter((group) => group.items.length > 0) ?? []),
  ].map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (seenAmenities.has(item)) return false
      seenAmenities.add(item)
      return true
    }),
  }))
  const hasAmenities = dedupedAmenityGroups.some((group) => group.items.length > 0)
  const citySlug = routeMode === 'prefixed' ? city.slug : undefined

  return (
    <div className="detail">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildListingJsonLd(listing, siteConfig.siteOrigin, { citySlug })) }}
      />
      <Breadcrumb
        items={[
          { label: '首页', href: basePath || '/' },
          { label: '办公选址', href: `${basePath}/listings` },
          ...(building?.district ? [{ label: building.district.name }] : []),
          ...(building ? [{ label: building.name, href: `${basePath}/buildings/${encodeURIComponent(building.slug)}` }] : []),
          { label: listing.title },
        ]}
      />
      <header className="detail__header">
        <h1 className="detail__title">{listing.title}</h1>
        {headerHighlights.length > 0 && <div className="detail__tags" aria-label="房源亮点">
          {headerHighlights.map((text) => <span key={text} className="tag">{text}</span>)}
        </div>}
      </header>
      <section className="detail-hero" aria-label="房源核心信息">
        <DetailGallery
          media={media}
          title={listing.title}
          pageType="listing"
          noMediaFallback={{ keySpecs: noMediaKeySpecs, address: noMediaAddress, transit: noMediaTransit }}
        />
        <div className="detail__summary">
          <div className="detail__rent">{rentText}</div>
          <dl className="detail__specs">
            <div><dt><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9h16M4 9v8h16V9M4 9l3-4h10l3 4M9 17v-4h6v4" /></svg>面积</dt><dd>{formatArea(listing.area)}</dd></div>
            <div><dt><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="6" rx="1" /><rect x="5" y="13" width="14" height="6" rx="1" /><path d="M9 7h.01M9 16h.01" /></svg>工位</dt><dd>{listing.seats ?? '咨询确认'}</dd></div>
            <div><dt><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="1" /><path d="M4 9h16M9 3v4M15 3v4M9 14l2 2 4-4" /></svg>可入驻</dt><dd>{formatAvailableDate(listing.availableFrom)}</dd></div>
            <div><dt><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6" /></svg>楼盘</dt><dd>{building?.name ?? '—'}</dd></div>
            <div><dt><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>区域</dt><dd>{building?.district?.name ?? '—'}</dd></div>
          </dl>
          <div className="detail__decision">
            <AdvisorCard />
            <div className="detail__decision-cta">
              <InquiryModal pageType="listing" targetListingSlug={listing.slug} targetBuildingSlug={building?.slug}
                targetSummary={listing.title} triggerLabel="询价 / 预约看房" triggerClassName="btn--lg detail__decision-inquiry"
                sourceSection="hero" priceSnapshot={inquiryPriceSnapshot} activeSupplyGroup={inquirySupplyGroup}
                currentFilters={inquiryCurrentFilters} serviceSchedule={serviceSchedule} />
              <ShareSaveActions canonicalUrl={`${siteConfig.siteOrigin}${listingPath}`}
                savedDetail={{ type: 'listing', id: listing.id, slug: listing.slug }} />
              <CorrectionModal targetType="listing" targetSlug={listing.slug} targetSummary={listing.title} />
            </div>
          </div>
        </div>
        <section id="overview" className="detail__overview"><h2>房源概况</h2><DetailFacts groups={listing.factGroups} /></section>
      </section>
      {hasAmenities && <section id="amenities" className="detail__section"><h2>配套设施</h2><AmenityList groups={dedupedAmenityGroups} /></section>}
      {listing.description && <section id="description" className="detail__section"><h2>房源描述</h2><div className="richtext"><RichText data={listing.description} /></div></section>}
      {building && <section id="building" className="detail__section"><h2>所在楼盘</h2><BuildingSummaryCard building={building} listingId={listing.id} citySlug={citySlug} /></section>}
      {building && <LocationPanel building={{ id: building.id, name: building.name, address: building.address,
        coordinates: building.coordinates, nearestMetro: building.nearestMetro ? { name: building.nearestMetro.name } : undefined }}
        pois={pois} mapEnabled={mapEnabled} />}
      {recommendations.length > 0 && <section id="related" className="detail__section"><h2>相关推荐</h2><div className="card-grid">
        {recommendations.map((rec, index) => <div key={rec.card.id} className="recommendation-card-wrapper">
          <ListingCard listing={rec.card} citySlug={citySlug} detailAnalytics={{ event: 'recommendation_click', parentId: listing.id,
            rank: index + 1, section: 'related', recommendationType: 'contextual' }} />
          <RecommendationReason reasonCodes={rec.reasonCodes} />
        </div>)}
      </div></section>}
      <div className="detail__mobile-bar" role="region" aria-label="询价操作栏">
        <div className="detail__mobile-bar-info"><DetailMobileBarPrice rentText={rentText} /><span className="detail__mobile-bar-title">{listing.title}</span></div>
        <InquiryModal pageType="listing" targetListingSlug={listing.slug} targetBuildingSlug={building?.slug} targetSummary={listing.title}
          triggerLabel="询价 / 预约看房" sourceSection="mobile-bar" priceSnapshot={inquiryPriceSnapshot}
          activeSupplyGroup={inquirySupplyGroup} currentFilters={inquiryCurrentFilters} serviceSchedule={serviceSchedule} />
      </div>
      <BackToTop />
      <DetailClickAnalytics />
    </div>
  )
}
