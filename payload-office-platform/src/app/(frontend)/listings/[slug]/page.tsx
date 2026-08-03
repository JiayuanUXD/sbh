import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import AdvisorCard from '@/components/frontend/AdvisorCard'
import BackToTop from '@/components/frontend/BackToTop'
import AmenityList from '@/components/frontend/AmenityList'
import BuildingSummaryCard from '@/components/frontend/BuildingSummaryCard'
import DetailAnchorNav from '@/components/frontend/DetailAnchorNav'
import DetailClickAnalytics from '@/components/frontend/DetailClickAnalytics'
import DetailFacts from '@/components/frontend/DetailFacts'
import DetailGallery from '@/components/frontend/DetailGallery'
import ListingCard from '@/components/frontend/ListingCard'
import LocationPanel from '@/components/frontend/LocationPanel'
import RecommendationReason from '@/components/frontend/RecommendationReason'
import CorrectionModal from '@/components/frontend/CorrectionModal'
import ShareSaveActions from '@/components/frontend/ShareSaveActions'
import { Breadcrumb } from '@/components/frontend/ui/Breadcrumb'
import { formatArea, formatAvailableDate } from '@/lib/frontend/format'
import { fetchNearbyPois } from '@/lib/frontend/location-pois'
import { buildListingJsonLd, buildListingMetadata, serializeJsonLd } from '@/lib/frontend/detail-metadata'
import { siteConfig } from '@/lib/frontend/site-config'
import {
  defaultSearchContext,
  getBuildingBySlug,
  getListingBySlug,
  getDetailRecommendations,
} from '@/domain/public-catalog'

export const dynamic = 'force-dynamic'

const TYPE_LABEL: Record<string, string> = {
  'traditional-office': '传统办公',
  'serviced-office': '服务式办公',
  coworking: '共享办公',
  'full-floor': '整层办公',
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const ctx = defaultSearchContext()
  const listing = await getListingBySlug(slug, ctx)
  if (!listing) {
    return {
      title: '房源未找到',
      robots: { index: false, follow: false },
    }
  }
  return buildListingMetadata(listing, siteConfig.siteOrigin)
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const ctx = defaultSearchContext()
  const listing = await getListingBySlug(slug, ctx)
  if (!listing) notFound()

  const building = listing.building
  const buildingDetail = building ? await getBuildingBySlug(building.slug, ctx) : null
  const recommendations = await getDetailRecommendations(slug, ctx, { limit: 6 })
  const pois = await fetchNearbyPois(building?.id ?? 0, building?.coordinates)
  const mapEnabled = building?.coordinates != null

  // `gallery` is a legacy public DTO fallback, never a Payload document.
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
  const amenityGroups = [
    ...listing.amenityGroups,
    ...(buildingDetail?.amenityGroups.filter((group) => group.items.length > 0) ?? []),
  ]
  const hasAmenities = amenityGroups.some((group) => group.items.length > 0)
  const anchors = [
    { id: 'overview', label: '房源概况', visible: true },
    { id: 'amenities', label: '配套设施', visible: hasAmenities },
    { id: 'description', label: '房源描述', visible: listing.description != null },
    { id: 'building', label: '所在楼盘', visible: building != null },
    { id: 'location', label: '位置交通', visible: building != null },
    { id: 'related', label: '相关推荐', visible: recommendations.length > 0 },
  ]

  const jsonLd = buildListingJsonLd(listing, siteConfig.siteOrigin)

  return (
    <div className="detail">
      <script
        type="application/ld+json"
        // JSON-LD 由服务端生成；CMS 字段（标题/摘要）由管理员维护。
        // 转义 </script> 防止存储型 XSS：JSON.stringify 不会转义 <，
        // 若 CMS 字段含 "</script><script>..." 可闭合当前标签注入。
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(jsonLd),
        }}
      />
      <Breadcrumb
        items={[
          { label: '首页', href: '/' },
          { label: '办公选址', href: '/listings' },
          ...(building?.district ? [{ label: building.district.name }] : []),
          ...(building ? [{ label: building.name, href: `/buildings/${building.slug}` }] : []),
          { label: listing.title },
        ]}
      />
      <header className="detail__header">
        <span className="detail__type">{TYPE_LABEL[listing.listingType]}</span>
        <h1 className="detail__title">{listing.title}</h1>
        {listing.highlights.length > 0 && (
          <div className="detail__tags" aria-label="房源亮点">
            {listing.highlights.slice(0, 3).map((text, i) => (
              <span key={i} className="tag">{text}</span>
            ))}
          </div>
        )}
      </header>
      <section className="detail-hero" aria-label="房源核心信息">
        <DetailGallery media={media} title={listing.title} pageType="listing" />
        <div className="detail__summary">
          <div className="detail__rent">{rentText}</div>
          <dl className="detail__specs">
            <div>
              <dt>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9h16M4 9v8h16V9M4 9l3-4h10l3 4M9 17v-4h6v4" /></svg>
                面积
              </dt>
              <dd>{formatArea(listing.area)}</dd>
            </div>
            <div>
              <dt>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="6" rx="1" /><rect x="5" y="13" width="14" height="6" rx="1" /><path d="M9 7h.01M9 16h.01" /></svg>
                工位
              </dt>
              <dd>{listing.seats ?? '咨询确认'}</dd>
            </div>
            <div>
              <dt>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="1" /><path d="M4 9h16M9 3v4M15 3v4M9 14l2 2 4-4" /></svg>
                可入驻
              </dt>
              <dd>{formatAvailableDate(listing.availableFrom)}</dd>
            </div>
            <div>
              <dt>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6" /></svg>
                楼盘
              </dt>
              <dd>{building?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-7-5.5-7-11a7 7 0 0114 0c0 5.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
                区域
              </dt>
              <dd>{building?.district?.name ?? '—'}</dd>
            </div>
          </dl>
          <div className="detail__decision">
            <AdvisorCard />
            <div className="detail__decision-cta">
              <InquiryModal
                pageType="listing"
                targetListingSlug={listing.slug}
                targetBuildingSlug={building?.slug}
                targetSummary={listing.title}
                triggerLabel="询价 / 预约看房"
                triggerClassName="btn--lg detail__decision-inquiry"
                sourceSection="hero"
                priceSnapshot={inquiryPriceSnapshot}
                activeSupplyGroup={inquirySupplyGroup}
                currentFilters={inquiryCurrentFilters}
              />
              <ShareSaveActions
                canonicalUrl={`${siteConfig.siteOrigin}/listings/${listing.slug}`}
                savedDetail={{ type: 'listing', id: listing.id, slug: listing.slug }}
              />
              <CorrectionModal
                targetType="listing"
                targetSlug={listing.slug}
                targetSummary={listing.title}
              />
            </div>
          </div>
        </div>
        <section id="overview" className="detail__overview">
          <h2>房源概况</h2>
          <DetailFacts groups={listing.factGroups} />
        </section>
      </section>
      <DetailAnchorNav items={anchors} />
      {hasAmenities && (
        <section id="amenities" className="detail__section">
          <h2>配套设施</h2>
          <AmenityList groups={amenityGroups} />
        </section>
      )}
      {listing.description && (
        <section id="description" className="detail__section">
          <h2>房源描述</h2>
          <div className="richtext">
            <RichText data={listing.description} />
          </div>
        </section>
      )}
      {building && (
        <section id="building" className="detail__section">
          <h2>所在楼盘</h2>
          <BuildingSummaryCard building={building} listingId={listing.id} />
        </section>
      )}
      {building && (
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
      )}
      {recommendations.length > 0 && (
        <section id="related" className="detail__section">
          <h2>相关推荐</h2>
          <div className="card-grid">
            {recommendations.map((rec, index) => (
              <div key={rec.card.id} className="recommendation-card-wrapper">
                <ListingCard
                  listing={rec.card}
                  detailAnalytics={{
                    event: 'recommendation_click',
                    parentId: listing.id,
                    rank: index + 1,
                    section: 'related',
                    recommendationType: 'contextual',
                  }}
                />
                <RecommendationReason reasonCodes={rec.reasonCodes} />
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="detail__mobile-bar" role="region" aria-label="询价操作栏">
        <div className="detail__mobile-bar-info">
          <span className="detail__mobile-bar-rent">{rentText}</span>
          <span className="detail__mobile-bar-title">{listing.title}</span>
        </div>
        <InquiryModal
          pageType="listing"
          targetListingSlug={listing.slug}
          targetBuildingSlug={building?.slug}
          targetSummary={listing.title}
          triggerLabel="询价 / 预约看房"
          sourceSection="mobile-bar"
          priceSnapshot={inquiryPriceSnapshot}
          activeSupplyGroup={inquirySupplyGroup}
          currentFilters={inquiryCurrentFilters}
        />
      </div>
      <BackToTop />
      <DetailClickAnalytics />
    </div>
  )
}
