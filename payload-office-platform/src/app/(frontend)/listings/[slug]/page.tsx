import { RichText } from '@payloadcms/richtext-lexical/react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'
import InquiryModal from '@/components/frontend/InquiryModal'
import ListingGallery from '@/components/frontend/ListingGallery'
import { formatArea, formatRent } from '@/lib/frontend/format'
import { getListingBySlug, getListingsByBuilding } from '@/lib/frontend/queries'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const listing = await getListingBySlug(slug)
  if (!listing) return { title: '房源未找到' }
  return { title: listing.title, description: listing.title }
}

const typeLabel: Record<string, string> = {
  'traditional-office': '传统办公',
  'serviced-office': '服务式办公',
  coworking: '共享办公',
  'full-floor': '整层办公',
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const listing = await getListingBySlug(slug)
  if (!listing) notFound()

  const building = listing.building as any
  const related = building?.id ? await getListingsByBuilding(building.id, 6) : []

  const coverImage = listing.coverImage as any
  const images = [
    ...(coverImage?.url ? [{ url: coverImage.url, alt: listing.title }] : []),
    ...(Array.isArray(building?.gallery)
      ? building.gallery.map((g: any) => ({ url: g.image?.url, alt: building.name }))
      : []),
  ].filter((i: any) => i.url)

  return (
    <div className="detail">
      <div className="detail__top">
        <ListingGallery images={images} />
        <div className="detail__summary">
          <span className="detail__type">{typeLabel[listing.listingType]}</span>
          <h1 className="detail__title">{listing.title}</h1>
          <div className="detail__rent">{formatRent(listing.rent, listing.rentUnit ?? undefined)}</div>
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
              <dd>{listing.availableFrom || '面议'}</dd>
            </div>
            <div>
              <dt>楼盘</dt>
              <dd>{building?.name}</dd>
            </div>
            <div>
              <dt>区域</dt>
              <dd>{building?.district?.name}</dd>
            </div>
            <div>
              <dt>地址</dt>
              <dd>{building?.address}</dd>
            </div>
          </dl>
          {Array.isArray(listing.highlights) && listing.highlights.length > 0 && (
            <div className="detail__tags">
              {listing.highlights.map((h: any, i: number) => (
                <span key={i} className="tag">
                  {h.text}
                </span>
              ))}
            </div>
          )}
          <InquiryModal listingTitle={listing.title} />
        </div>
      </div>
      {listing.description && (
        <section className="detail__section">
          <h2>房源说明</h2>
          <div className="richtext">
            <RichText data={listing.description} />
          </div>
        </section>
      )}
      {building && (
        <section className="detail__section">
          <h2>所在楼盘</h2>
          <p>
            {building.name} · {building.address}
          </p>
          {building.summary && <p className="detail__building-summary">{building.summary}</p>}
          {building.slug && (
            <Link href={`/buildings/${building.slug}`} className="btn btn--ghost">
              查看楼盘
            </Link>
          )}
        </section>
      )}
      {related.length > 1 && (
        <section className="detail__section">
          <h2>同楼盘其他房源</h2>
          <div className="card-grid">
            {related
              .filter((r: any) => r.id !== listing.id)
              .map((r: any) => (
                <Link key={r.id} href={`/listings/${r.slug}`} className="listing-card">
                  <div className="listing-card__body">
                    <span className="listing-card__rent">{formatRent(r.rent, r.rentUnit)}</span>
                    <span className="listing-card__title">{r.title}</span>
                  </div>
                </Link>
              ))}
          </div>
        </section>
      )}
    </div>
  )
}
