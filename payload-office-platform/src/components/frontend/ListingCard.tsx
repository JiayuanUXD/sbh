import Link from 'next/link'
import React from 'react'
import { formatArea, formatRent } from '@/lib/frontend/format'

type Props = { listing: any }

export default function ListingCard({ listing }: Props) {
  const cover = listing.coverImage?.url || listing.building?.coverImage?.url
  const rent = formatRent(listing.rent, listing.rentUnit)
  const area = formatArea(listing.area)
  const district = listing.building?.district?.name
  const typeLabel: Record<string, string> = {
    'traditional-office': '传统办公',
    'serviced-office': '服务式办公',
    'coworking': '共享办公',
    'full-floor': '整层办公',
  }
  return (
    <Link href={`/listings/${listing.slug}`} className="listing-card">
      {cover ? (
        <img src={cover} alt={listing.title} className="listing-card__media" />
      ) : (
        <div className="listing-card__media" />
      )}
      <div className="listing-card__body">
        <span className="listing-card__rent">{rent}</span>
        <span className="listing-card__title">{listing.title}</span>
        <span className="listing-card__meta">{[district, area, typeLabel[listing.listingType]].filter(Boolean).join(' · ')}</span>
        {Array.isArray(listing.highlights) && listing.highlights.length > 0 && (
          <div className="listing-card__tags">
            {listing.highlights.slice(0, 3).map((h: any, i: number) => (
              <span key={i} className="tag">{h.text}</span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
