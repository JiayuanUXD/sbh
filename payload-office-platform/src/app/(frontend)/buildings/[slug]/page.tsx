import Link from 'next/link'
import { notFound } from 'next/navigation'
import React from 'react'
import ListingCard from '@/components/frontend/ListingCard'
import { getBuildingBySlug, getListingsByBuilding } from '@/lib/frontend/queries'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const building = await getBuildingBySlug(slug)
  if (!building) return { title: '楼盘未找到' }
  return { title: building.name, description: building.summary }
}

export default async function BuildingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const building = await getBuildingBySlug(slug)
  if (!building) notFound()

  const listings = await getListingsByBuilding(building.id, 50)
  const coverImage = building.coverImage as any
  const district = building.district as any

  return (
    <div className="detail">
      <div className="detail__top">
        {coverImage?.url ? (
          <div className="gallery__main">
            <img src={coverImage.url} alt={building.name} />
          </div>
        ) : (
          <div className="gallery__main gallery__empty" />
        )}
        <div className="detail__summary">
          <span className="detail__type">
            {building.grade} · {district?.name}
          </span>
          <h1 className="detail__title">{building.name}</h1>
          <p className="detail__building-summary">{building.address}</p>
          {building.summary && <p>{building.summary}</p>}
          {Array.isArray(building.amenities) && building.amenities.length > 0 && (
            <div className="detail__tags">
              {building.amenities.map((a: any) => (
                <span key={a.id} className="tag">
                  {a.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <section className="detail__section">
        <h2>在租房源</h2>
        {listings.length === 0 ? (
          <p className="empty">该楼盘暂无在租房源。</p>
        ) : (
          <div className="card-grid">
            {listings.map((l: any) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
