import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import ListingCard from '@/components/frontend/ListingCard'
import { rentUnitLabel } from '@/lib/frontend/format'
import { siteConfig } from '@/lib/frontend/site-config'
import {
  defaultSearchContext,
  getBuildingDetail,
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
  const title = building.name
  const description =
    building.summary ||
    `${building.name}，${building.address}${building.district ? `，${building.district.name}` : ''}`
  return {
    title,
    description,
    alternates: {
      canonical: `/buildings/${slug}`,
    },
    openGraph: {
      title,
      description,
      url: `${siteConfig.siteOrigin}/buildings/${slug}`,
      type: 'website',
    },
    robots: {
      index: true,
      follow: true,
    },
  }
}

const GRADE_LABEL: Record<string, string> = {
  'grade-a': '甲级',
  'super-grade-a': '超甲级',
  'creative-park': '创意园',
  'serviced-office': '服务式办公',
}

export default async function BuildingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const ctx = defaultSearchContext()
  const { building, listings, priceRanges } = await getBuildingDetail(slug, ctx)
  if (!building) notFound()

  const district = building.district
  const coverImage = building.coverImage
  const galleryImages = building.gallery

  // 聚合统计
  const totalListings = listings.length
  const areas = listings.map((l) => l.area).filter((a): a is number => a != null)
  const areaMin = areas.length > 0 ? Math.min(...areas) : null
  const areaMax = areas.length > 0 ? Math.max(...areas) : null
  const availableNow = listings.filter((l) => !l.availableFrom).length

  // 优先用 coverImage；若有 gallery 但没有 coverImage，则用 gallery 首图
  const heroImage = coverImage ?? (galleryImages.length > 0 ? galleryImages[0] : null)

  const gradeLabel = building.grade ? GRADE_LABEL[building.grade] ?? building.grade : null
  const typeParts = [gradeLabel, district?.name].filter(Boolean)

  // F4.6：schema.org 结构化数据（Place 类型，仅声明后台可保证字段）
  const canonicalUrl = `${siteConfig.siteOrigin}/buildings/${slug}`
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: building.name,
    url: canonicalUrl,
    address: building.address || undefined,
  }
  if (building.summary) {
    jsonLd.description = building.summary
  }
  if (heroImage) {
    jsonLd.image = heroImage.src
  }
  if (totalListings > 0 && priceRanges.length > 0) {
    // 仅当存在有效房源时声明聚合报价；不伪造评分或库存
    jsonLd.offers = priceRanges.map((r) => ({
      '@type': 'AggregateOffer',
      priceCurrency: 'CNY',
      lowPrice: r.min,
      highPrice: r.max,
      offerCount: r.count,
    }))
  }

  return (
    <div className="detail">
      <script
        type="application/ld+json"
        // 转义 </script> 防止存储型 XSS：JSON.stringify 不会转义 <。
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <div className="detail__top">
        {heroImage ? (
          <div className="gallery__main">
            <img src={heroImage.src} alt={heroImage.alt} />
          </div>
        ) : (
          <div className="gallery__main gallery__empty">暂无图片</div>
        )}
        <div className="detail__summary">
          {typeParts.length > 0 && (
            <span className="detail__type">{typeParts.join(' · ')}</span>
          )}
          <h1 className="detail__title">{building.name}</h1>
          <p className="detail__building-summary">{building.address}</p>
          {building.summary && <p>{building.summary}</p>}
          {building.amenities.length > 0 && (
            <div className="detail__tags">
              {building.amenities.map((name) => (
                <span key={name} className="tag">
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* F4.5：楼盘有效供给聚合统计 */}
      <section className="detail__section">
        <h2>楼盘概览</h2>
        <div className="building-stats">
          <div className="building-stats__item">
            <span className="building-stats__label">在租房源</span>
            <span className="building-stats__value">{totalListings}</span>
          </div>
          <div className="building-stats__item">
            <span className="building-stats__label">面积区间</span>
            <span className="building-stats__value">
              {areaMin != null && areaMax != null
                ? areaMin === areaMax
                  ? `${areaMin} ㎡`
                  : `${areaMin}–${areaMax} ㎡`
                : '—'}
            </span>
          </div>
          <div className="building-stats__item">
            <span className="building-stats__label">价格区间组</span>
            <span className="building-stats__value">{priceRanges.length}</span>
          </div>
          <div className="building-stats__item">
            <span className="building-stats__label">立即可入驻</span>
            <span className="building-stats__value">{availableNow}</span>
          </div>
        </div>

        {priceRanges.length > 0 && (
          <div className="price-range-group">
            <h3 className="building-stats__label">按计价单位分组的价格区间</h3>
            {priceRanges.map((range) => {
              const unitLabel = rentUnitLabel(range.unit) || range.unit
              const rangeText =
                range.min === range.max
                  ? `${range.min} ${unitLabel}`
                  : `${range.min}–${range.max} ${unitLabel}`
              return (
                <div key={range.unit} className="price-range-group__item">
                  <span className="price-range-group__unit">
                    {unitLabel}（{range.count} 套）
                  </span>
                  <span className="price-range-group__range">{rangeText}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {building.description && (
        <section className="detail__section">
          <h2>楼盘说明</h2>
          <div className="richtext">
            <RichText data={building.description} />
          </div>
        </section>
      )}

      <section className="detail__section">
        <h2>在租房源</h2>
        {listings.length === 0 ? (
          <p className="empty">该楼盘暂无在租房源。</p>
        ) : (
          <div className="card-grid">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>

      <div className="detail__mobile-bar" role="region" aria-label="询价操作栏">
        <div className="detail__mobile-bar-info">
          <span className="detail__mobile-bar-rent">
            {totalListings} 套在租
          </span>
          <span className="detail__mobile-bar-title">{building.name}</span>
        </div>
        <InquiryModal
          pageType="building"
          targetBuildingSlug={slug}
          targetSummary={building.name}
          triggerLabel="咨询该楼盘"
        />
      </div>
    </div>
  )
}
