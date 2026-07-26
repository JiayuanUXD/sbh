import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import ListingCard from '@/components/frontend/ListingCard'
import ListingGallery from '@/components/frontend/ListingGallery'
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

  const images = listing.gallery.map((m) => ({
    src: m.src,
    alt: m.alt,
    width: m.width,
    height: m.height,
  }))
  if (listing.coverImage && !images.some((m) => m.src === listing.coverImage?.src)) {
    images.unshift({
      src: listing.coverImage.src,
      alt: listing.coverImage.alt,
      width: listing.coverImage.width,
      height: listing.coverImage.height,
    })
  }

  const rentText = listing.price?.text ?? '待面议'
  const canonicalUrl = `${siteConfig.siteOrigin}/listings/${slug}`

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
      <div className="detail__top">
        <ListingGallery images={images} />
        <div className="detail__summary">
          <span className="detail__type">{TYPE_LABEL[listing.listingType]}</span>
          <h1 className="detail__title">{listing.title}</h1>
          <div className="detail__rent">{rentText}</div>
          <dl className="detail__specs">
            <div>
              <dt>面积</dt>
              <dd>{formatArea(listing.area)}</dd>
            </div>
            <div>
              <dt>工位</dt>
              <dd>{listing.seats ?? '面议'}</dd>
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
            <div>
              <dt>地址</dt>
              <dd>{building?.address ?? '—'}</dd>
            </div>
          </dl>
          {listing.highlights.length > 0 && (
            <div className="detail__tags">
              {listing.highlights.map((text, i) => (
                <span key={i} className="tag">
                  {text}
                </span>
              ))}
            </div>
          )}
          <div className="detail__decision">
            <div className="detail__decision-row">
              <span className="detail__rent">{rentText}</span>
              <span className="detail__type">{TYPE_LABEL[listing.listingType]}</span>
            </div>
            <div className="detail__decision-cta">
              <InquiryModal
                pageType="listing"
                targetListingSlug={slug}
                targetSummary={listing.title}
                triggerLabel="询价 / 预约看房"
              />
            </div>
          </div>
        </div>
      </div>
      {listing.description && (
        <section className="detail__section">
          <h2>详细介绍</h2>
          <div className="richtext">
            <RichText data={listing.description} />
          </div>
        </section>
      )}
      {building && (
        <section className="detail__section">
          <h2>所在楼盘</h2>
          <p>
            {building.name}
            {building.address ? ` · ${building.address}` : ''}
          </p>
          {building.summary && (
            <p className="detail__building-summary">{building.summary}</p>
          )}
          {building.slug && (
            <Link
              href={`/buildings/${building.slug}`}
              className="btn btn--ghost"
              data-event-name="listing_building_link_click"
            >
              查看楼盘
            </Link>
          )}
        </section>
      )}
      {relatedFiltered.length > 0 && (
        <section className="detail__section">
          <h2>同楼盘其他房源</h2>
          <div className="card-grid">
            {relatedFiltered.map((r) => (
              <ListingCard key={r.id} listing={r} />
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
          targetListingSlug={slug}
          targetSummary={listing.title}
          triggerLabel="询价 / 预约看房"
        />
      </div>
    </div>
  )
}
