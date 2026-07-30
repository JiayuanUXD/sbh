import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import DetailAnchorNav from '@/components/frontend/DetailAnchorNav'
import DetailFacts from '@/components/frontend/DetailFacts'
import DetailGallery from '@/components/frontend/DetailGallery'
import ListingCard from '@/components/frontend/ListingCard'
import { Breadcrumb } from '@/components/frontend/ui/Breadcrumb'
import { formatArea, formatAvailableDate } from '@/lib/frontend/format'
import { siteConfig } from '@/lib/frontend/site-config'
import {
  defaultSearchContext,
  getListingBySlug,
  getRelatedListings,
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
  const title = listing.title
  const description = `${listing.title}，${listing.price?.text ?? '待面议'}，${formatArea(listing.area)}，${TYPE_LABEL[listing.listingType] ?? '办公'}`
  return {
    title,
    description,
    alternates: {
      canonical: `/listings/${slug}`,
    },
    openGraph: {
      title,
      description,
      url: `${siteConfig.siteOrigin}/listings/${slug}`,
      type: 'website',
    },
    robots: {
      index: true,
      follow: true,
    },
  }
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
  const related = await getRelatedListings(slug, ctx, { limit: 6 })
  const relatedFiltered = related.filter((r) => r.id !== listing.id).slice(0, 5)

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
  const canonicalUrl = `${siteConfig.siteOrigin}/listings/${slug}`
  const hasAmenities = listing.amenityGroups.some((group) => group.items.length > 0)
  const anchors = [
    { id: 'overview', label: '房源概况', visible: true },
    { id: 'amenities', label: '配套设施', visible: hasAmenities },
    { id: 'description', label: '房源描述', visible: listing.description != null },
    { id: 'building', label: '所在楼盘', visible: building != null },
    { id: 'related', label: '其他房源', visible: relatedFiltered.length > 0 },
  ]

  // F4.6：schema.org 结构化数据（仅声明后台可保证的字段，不伪造库存/作者/发布日期）
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: listing.title,
    url: canonicalUrl,
    description: `${listing.title}，${rentText}，${formatArea(listing.area)}`,
  }
  if (listing.coverImage) {
    jsonLd.image = listing.coverImage.src
  }
  if (listing.price) {
    jsonLd.offers = {
      '@type': 'Offer',
      priceCurrency: 'CNY',
      price: listing.price.amount,
      url: canonicalUrl,
      // 不声明 availability 与 availabilityStarts：后台数据不能保证
    }
  }
  if (building) {
    jsonLd.brand = {
      '@type': 'Place',
      name: building.name,
      address: building.address || undefined,
    }
  }

  return (
    <div className="detail">
      <script
        type="application/ld+json"
        // JSON-LD 由服务端生成；CMS 字段（标题/摘要）由管理员维护。
        // 转义 </script> 防止存储型 XSS：JSON.stringify 不会转义 <，
        // 若 CMS 字段含 "</script><script>..." 可闭合当前标签注入。
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
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
        <DetailGallery media={media} title={listing.title} />
        <div className="detail__summary">
          <div className="detail__rent">{rentText}</div>
          <dl className="detail__specs">
            <div>
              <dt>面积</dt>
              <dd>{formatArea(listing.area)}</dd>
            </div>
            <div>
              <dt>工位</dt>
              <dd>{listing.seats ?? '咨询确认'}</dd>
            </div>
            <div>
              <dt>可入驻</dt>
              <dd>{formatAvailableDate(listing.availableFrom)}</dd>
            </div>
            <div>
              <dt>楼盘</dt>
              <dd>{building?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>区域</dt>
              <dd>{building?.district?.name ?? '—'}</dd>
            </div>
          </dl>
          <div className="detail__decision">
            <div className="detail__decision-row">
              <span className="detail__rent">{rentText}</span>
              <span className="detail__type">{TYPE_LABEL[listing.listingType]}</span>
            </div>
            <div className="detail__decision-cta">
              <InquiryModal
                pageType="listing"
                targetListingSlug={listing.slug}
                targetBuildingSlug={building?.slug}
                targetSummary={listing.title}
                triggerLabel="询价 / 预约看房"
                sourceSection="hero"
              />
            </div>
          </div>
        </div>
      </section>
      <DetailAnchorNav items={anchors} />
      <section id="overview" className="detail__section">
        <h2>房源概况</h2>
        <DetailFacts groups={listing.factGroups} />
      </section>
      {hasAmenities && (
        <section id="amenities" className="detail__section">
          <h2>配套设施</h2>
          {listing.amenityGroups.filter((group) => group.items.length > 0).map((group) => (
            <div key={group.id}>
              <h3>{group.title}</h3>
              <ul className="detail__amenities">
                {group.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          ))}
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
          <p>
            {building.name}
            {building.address ? ` · ${building.address}` : ''}
          </p>
          {building.summary && <p className="detail__building-summary">{building.summary}</p>}
          <Link
            href={`/buildings/${building.slug}`}
            className="btn btn--ghost"
            data-event-name="listing_building_link_click"
          >
            查看楼盘
          </Link>
        </section>
      )}
      {relatedFiltered.length > 0 && (
        <section id="related" className="detail__section">
          <h2>同楼盘其他房源</h2>
          <div className="card-grid">
            {relatedFiltered.map((r) => <ListingCard key={r.id} listing={r} />)}
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
        />
      </div>
    </div>
  )
}
