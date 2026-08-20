import React from 'react'
import HorizontalRail from './HorizontalRail'
import HomeSupplyCard from './HomeSupplyCard'
import { formatArea } from '@/lib/frontend/format'
import { LISTING_TYPE_LABEL, listingWhereLine, splitPriceText } from '@/lib/frontend/listing-display'
import type { ListingCardViewModel } from '@/domain/public-catalog/contracts'

export default function HomeListingsRail({ listings, citySlug, totalCount }: Readonly<{
  listings: readonly ListingCardViewModel[]
  citySlug?: string
  totalCount: number
}>) {
  if (listings.length === 0) return null
  const prefix = citySlug ? `/${citySlug}` : ''
  return (
    <section className="hm-section" aria-labelledby="hm-listings-title">
      <div className="hm-container hm-section-head">
        <h2 className="hm-h2" id="hm-listings-title">精选房源</h2>
        <a className="hm-section-link" href={`${prefix}/listings`} data-event-name="home_browse_all_listings">
          查看 <span className="sf-num">{totalCount.toLocaleString('en-US')}</span> 套在租
        </a>
      </div>
      <HorizontalRail ariaLabel="精选房源">
        {listings.map((l) => (
          <div className="hm-rail__item" role="listitem" key={l.slug}>
            <HomeSupplyCard
              href={`${prefix}/listings/${l.slug}`}
              image={l.coverImage}
              photoTags={[
                { text: LISTING_TYPE_LABEL[l.listingType] },
                ...(l.isFeatured ? [{ text: '精选' }] : []),
              ]}
              title={l.title}
              whereLine={listingWhereLine(l.building)}
              metaLine={l.area != null ? `面积 ${formatArea(l.area)}` : null}
              price={splitPriceText(l.price)}
            />
          </div>
        ))}
      </HorizontalRail>
    </section>
  )
}
