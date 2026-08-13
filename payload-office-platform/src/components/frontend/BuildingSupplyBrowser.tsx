'use client'

import { useEffect, useState } from 'react'
import type {
  BuildingSupplyGroupViewModel,
  BuildingSupplySnapshot,
  ListingCardViewModel,
} from '@/domain/public-catalog'
import ListingCard from '@/components/frontend/ListingCard'
import { Media, Tag } from '@/components/frontend/ui'
import { estimateMonthlyTotal, formatMonthlyTotal } from '@/components/frontend/building-detail/supply-summary'

type BuildingSupplyBrowserProps = Readonly<{
  snapshot: BuildingSupplySnapshot
  /** Immutable public DTO ID used for anonymous analytics only. */
  buildingId?: number
  citySlug?: string
}>

/** 特色标签着色：地铁/交通类→forest，装修/配套类→copper，其他→default */
function tagVariantFor(text: string): 'default' | 'forest' | 'copper' {
  if (/地铁|交通|直达|枢纽/.test(text)) return 'forest'
  if (/装修|配套|家具|精装|配齐/.test(text)) return 'copper'
  return 'default'
}

/**
 * 面积分桶（评审 P0-4）。区间为左闭右开 [min, max)，最后一档无上限。
 * null area 的房源仅在「全部」桶中可见，不参与具体面积桶筛选。
 */
const AREA_BUCKETS = [
  { key: 'all', label: '全部', min: null, max: null },
  { key: '0-100', label: '0–100 ㎡', min: 0, max: 100 },
  { key: '100-300', label: '100–300 ㎡', min: 100, max: 300 },
  { key: '300-500', label: '300–500 ㎡', min: 300, max: 500 },
  { key: '500-1000', label: '500–1000 ㎡', min: 500, max: 1000 },
  { key: '1000+', label: '1000 ㎡ 以上', min: 1000, max: null },
] as const

type AreaBucketKey = (typeof AREA_BUCKETS)[number]['key']

function listingMatchesAreaBucket(area: number | null, bucket: (typeof AREA_BUCKETS)[number]): boolean {
  if (bucket.key === 'all') return true
  if (area == null) return false
  if (bucket.min != null && area < bucket.min) return false
  if (bucket.max != null && area >= bucket.max) return false
  return true
}

/**
 * 价格分桶（元/㎡/天）。区间为左闭右开 [min, max)，最后一档无上限。
 * 仅对按面积计价的日租价参与分桶；其他计价单位（元/月、元/工位/月、总价）
 * 的房源只在「全部」桶中可见，避免跨单位混比。
 */
const PRICE_BUCKETS = [
  { key: 'all', label: '全部', min: null, max: null },
  { key: 'u-8', label: '8 元以下', min: null, max: 8 },
  { key: '8-9', label: '8–9 元', min: 8, max: 9 },
  { key: '9-10', label: '9–10 元', min: 9, max: 10 },
  { key: '10+', label: '10 元以上', min: 10, max: null },
] as const

type PriceBucketKey = (typeof PRICE_BUCKETS)[number]['key']

/** 列表默认展示条数，超出部分由「查看更多」入口展开。 */
const DEFAULT_VISIBLE_COUNT = 5

function listingMatchesPriceBucket(listing: ListingCardViewModel, bucket: (typeof PRICE_BUCKETS)[number]): boolean {
  if (bucket.key === 'all') return true
  const { price } = listing
  if (!price || price.displayUnit !== 'rmb-sqm-day') return false
  const amount = price.amount
  if (bucket.min != null && amount < bucket.min) return false
  if (bucket.max != null && amount >= bucket.max) return false
  return true
}

/**
 * A progressively enhanced supply browser. Filtering is client-side via
 * segmented bucket buttons (面积 / 价格); the active bucket is plain component
 * state so the listing list stays in sync without a URL round-trip.
 */
export default function BuildingSupplyBrowser({ snapshot, buildingId, citySlug }: BuildingSupplyBrowserProps) {
  const groups = snapshot.groups.filter((group) => group.listings.length > 0)
  const availableGroups = snapshot.availableGroups.filter((group) => group.totalEffectiveListings > 0)
  const [isMobile, setIsMobile] = useState(false)
  const [activeAreaBucket, setActiveAreaBucket] = useState<AreaBucketKey>('all')
  const [activePriceBucket, setActivePriceBucket] = useState<PriceBucketKey>('all')
  const [expanded, setExpanded] = useState(false)

  // Narrow screens always render cards.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const syncViewport = () => setIsMobile(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  const isTableView = !isMobile

  const allListings = groups.flatMap((group) =>
    group.listings.map((listing) => ({ listing, groupKey: group.key })),
  )
  const areaBucket = AREA_BUCKETS.find((b) => b.key === activeAreaBucket) ?? AREA_BUCKETS[0]
  const priceBucket = PRICE_BUCKETS.find((b) => b.key === activePriceBucket) ?? PRICE_BUCKETS[0]
  const filteredListings = allListings.filter(
    (entry) =>
      listingMatchesAreaBucket(entry.listing.area, areaBucket) &&
      listingMatchesPriceBucket(entry.listing, priceBucket),
  )
  const visibleListings = expanded ? filteredListings : filteredListings.slice(0, DEFAULT_VISIBLE_COUNT)
  const hiddenCount = filteredListings.length - visibleListings.length

  return (
    <section
      className="building-supply-browser"
      aria-label="楼盘房源"
      data-supply-as-of={snapshot.asOf}
    >
      {groups.length === 0 ? (
        <p className="building-supply-browser__empty">
          {availableGroups.length === 0 ? '当前暂无公开可选空间' : '当前筛选下暂无匹配空间'}
        </p>
      ) : (
        <>
          <div className="building-supply-browser__filters" role="group" aria-label="房源筛选">
            <div className="building-supply-browser__bucket-group" role="group" aria-label="按面积筛选">
              <span className="building-supply-browser__bucket-label">面积</span>
              {AREA_BUCKETS.map((bucket) => {
                const count = allListings.filter((entry) =>
                  listingMatchesAreaBucket(entry.listing.area, bucket),
                ).length
                if (bucket.key !== 'all' && count === 0) return null
                const isActive = activeAreaBucket === bucket.key
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    aria-pressed={isActive}
                    className="building-supply-browser__bucket"
                    data-active={isActive || undefined}
                    onClick={() => {
                      setActiveAreaBucket(bucket.key)
                      setExpanded(false)
                    }}
                  >
                    {bucket.label}
                    <span className="building-supply-browser__bucket-count">{count}</span>
                  </button>
                )
              })}
            </div>
            <div className="building-supply-browser__bucket-group" role="group" aria-label="按价格筛选">
              <span className="building-supply-browser__bucket-label">价格</span>
              {PRICE_BUCKETS.map((bucket) => {
                const count = allListings.filter((entry) =>
                  listingMatchesPriceBucket(entry.listing, bucket),
                ).length
                if (bucket.key !== 'all' && count === 0) return null
                const isActive = activePriceBucket === bucket.key
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    aria-pressed={isActive}
                    className="building-supply-browser__bucket"
                    data-active={isActive || undefined}
                    onClick={() => {
                      setActivePriceBucket(bucket.key)
                      setExpanded(false)
                    }}
                  >
                    {bucket.label}
                    <span className="building-supply-browser__bucket-count">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {filteredListings.length === 0 ? (
            <p className="building-supply-browser__empty">当前筛选下暂无匹配空间</p>
          ) : isTableView ? (
            <div className="building-supply-browser__table-wrap">
              <table className="building-supply-browser__table">
                <caption className="visually-hidden">在租房源列表</caption>
                <thead>
                  <tr>
                    <th scope="col">图</th>
                    <th scope="col">面积</th>
                    <th scope="col">单价</th>
                    <th scope="col">总价</th>
                    <th scope="col">特色</th>
                    <th scope="col">详情</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleListings.map(({ listing, groupKey }, index) => {
                    const total = estimateMonthlyTotal(listing.price, listing.area)
                    return (
                      <tr key={`${groupKey}:${listing.id}`}>
                        <td className="building-supply-browser__table-thumb">
                          <Media media={listing.coverImage} ratio="4/3" fallbackAlt={listing.title} />
                        </td>
                        <td className="building-supply-browser__table-area">
                          {listing.area == null ? '—' : `${listing.area} ㎡`}
                        </td>
                        <td className="building-supply-browser__table-price">
                          {listing.price?.text ?? '价格面议'}
                        </td>
                        <td className="tabular building-supply-browser__table-total">
                          {total != null ? formatMonthlyTotal(total) : '—'}
                        </td>
                        <td>
                          {listing.highlights.length > 0 && (
                            <div className="building-supply-browser__table-tags">
                              {listing.highlights.map((text, i) => (
                                <Tag key={`${i}-${text}`} variant={tagVariantFor(text)}>{text}</Tag>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <a
                            href={`${citySlug ? `/${citySlug}` : ''}/listings/${encodeURIComponent(listing.slug)}`}
                            className="building-supply-browser__table-link"
                            data-detail-analytics-event={buildingId ? 'building_listing_click' : undefined}
                            data-analytics-parent-id={buildingId}
                            data-analytics-listing-id={buildingId ? listing.id : undefined}
                            data-analytics-supply-group={buildingId ? groupKey : undefined}
                            data-analytics-rank={buildingId ? index + 1 : undefined}
                            data-analytics-section={buildingId ? 'supply' : undefined}
                          >
                            查看详情
                          </a>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="building-supply-browser__more"
                  onClick={() => setExpanded(true)}
                >
                  查看更多 {hiddenCount} 套房源
                </button>
              )}
            </div>
          ) : (
            <div className="building-supply-browser__cards">
              {visibleListings.map(({ listing, groupKey }, index) => (
                <ListingCard
                  key={`${groupKey}:${listing.id}`}
                  listing={listing}
                  citySlug={citySlug}
                  variant="building-supply"
                  detailAnalytics={
                    buildingId
                      ? {
                          event: 'building_listing_click',
                          parentId: buildingId,
                          rank: index + 1,
                          section: 'supply',
                          supplyGroup: groupKey,
                        }
                      : undefined
                  }
                />
              ))}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="building-supply-browser__more"
                  onClick={() => setExpanded(true)}
                >
                  查看更多 {hiddenCount} 套房源
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
