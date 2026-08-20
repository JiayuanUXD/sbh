import React from 'react'
import HorizontalRail from './HorizontalRail'
import HomeSupplyCard from './HomeSupplyCard'
import { LISTING_TYPE_LABEL, listingWhereLine, splitPriceText } from './HomeListingsRail'
import { formatArea } from '@/lib/frontend/format'
import type { NearbyListingViewModel } from '@/domain/public-catalog/contracts'

/**
 * OPT-035 首页「核心商圈房源」通栏横滑：与精选房源同一张供给卡，
 * 图上左下第一个标签替换为到城市中心的直线距离。
 *
 * 与设计稿（`docs/SBH设计任务讨论/首页.dc.html` 的「附近房源」）的有意偏差：
 * 距离基于城市中心坐标计算，不是用户实时定位，因此不提供「重新定位」链接，
 * 副标题明确写「以{cityName}市中心起算」以免误导为真实定位。
 */
export default function HomeNearbyRail({ listings, cityName, citySlug }: Readonly<{
  listings: readonly NearbyListingViewModel[]
  cityName: string
  citySlug?: string
}>) {
  if (listings.length === 0) return null
  const prefix = citySlug ? `/${citySlug}` : ''
  return (
    <section className="hm-section" aria-labelledby="hm-nearby-title">
      <div className="hm-container hm-section-head hm-section-head--stack">
        <h2 className="hm-h2" id="hm-nearby-title">核心商圈房源</h2>
        <p className="hm-section-sub">
          以{cityName}市中心起算 · 最近 <span className="sf-num">{listings.length}</span> 套在租
        </p>
      </div>
      <HorizontalRail ariaLabel="核心商圈房源">
        {listings.map((l) => (
          <div className="hm-rail__item" role="listitem" key={l.slug}>
            <HomeSupplyCard
              href={`${prefix}/listings/${l.slug}`}
              image={l.coverImage}
              photoTags={[
                { text: `${l.distanceKm} km`, numeric: true },
                { text: LISTING_TYPE_LABEL[l.listingType] },
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
