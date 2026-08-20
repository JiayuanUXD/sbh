import React from 'react'
import HorizontalRail from './HorizontalRail'
import HomeSupplyCard from './HomeSupplyCard'
import { formatArea } from '@/lib/frontend/format'
import type { ListingCardViewModel, PriceViewModel } from '@/domain/public-catalog/contracts'

/** 房源类型中文名（与 ListingCard 的 TYPE_LABEL 同口径）。 */
export const LISTING_TYPE_LABEL: Record<ListingCardViewModel['listingType'], string> = {
  'traditional-office': '传统办公',
  coworking: '共享办公',
  'full-floor': '整层办公',
  'serviced-office': '独栋办公',
}

/**
 * 把 PriceViewModel.text（如「8.5 元/㎡/天」「18000 元/月」）拆成数值段和单位段，
 * 供 HomeSupplyCard 的大字号数值 + 小字号单位两段式展示。
 *
 * 不重新计算价格——PriceViewModel.text 由 domain 侧按
 * `${amount} ${unitLabel}` 拼出（见 mappers.ts formatPriceText / detail-values.ts），
 * 这里只做纯文本切分，单位始终跟随价格本身（元/月 vs 元/㎡/天 vs 元/工位/月 等）。
 */
export function splitPriceText(price: PriceViewModel | null): Readonly<{ value: string; unit: string }> | null {
  if (!price) return null
  const spaceIndex = price.text.indexOf(' ')
  if (spaceIndex === -1) return { value: price.text, unit: '' }
  return { value: price.text.slice(0, spaceIndex), unit: price.text.slice(spaceIndex + 1) }
}

/** 房源卡片 whereLine（行政区 · 近地铁站），与 ListingCard 的 locationLine 同口径。 */
export function listingWhereLine(building: ListingCardViewModel['building']): string | null {
  const parts: string[] = []
  if (building?.district?.name) parts.push(building.district.name)
  else if (building?.address) parts.push(building.address)
  if (building?.nearestMetro?.name) parts.push(`近${building.nearestMetro.name}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

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
