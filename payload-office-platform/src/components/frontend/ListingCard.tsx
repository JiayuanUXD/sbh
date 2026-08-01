import Link from 'next/link'
import React from 'react'
import { formatArea } from '@/lib/frontend/format'
import type { ListingCardViewModel } from '@/domain/public-catalog'
import { Media, Price, Tag } from '@/components/frontend/ui'

/**
 * 房源卡片
 *
 * 设计依据：specs/frontend-mvp/design.md §6.5、§7.2；FP-02 §4.1
 * 守护不变量：
 *   - 只消费 ListingCardViewModel DTO，不接收 Payload 文档；
 *   - 4:3 固定比例媒体，图片失败回退占位；
 *   - 卡片整体可点击，保留语义化 <a>（Cmd/Ctrl+click / 中键支持）；
 *   - alt 缺失时由"楼盘名 + 类型"生成可读替代；
 *   - 价格使用 tabular-nums，最多三项亮点。
 */

type Props = Readonly<{
  listing: ListingCardViewModel
  /** Compact semantic variation for cards embedded in a building supply group. */
  variant?: 'default' | 'building-supply'
  /** Public IDs and fixed enums for a page-scoped delegated analytics listener. */
  detailAnalytics?: Readonly<{
    event: 'recommendation_click' | 'building_listing_click'
    parentId: number
    rank: number
    section: 'related' | 'supply'
    recommendationType?: 'same_building' | 'contextual'
    supplyGroup?: 'lease' | 'sale' | 'coworking'
  }>
}>

const TYPE_LABEL: Record<ListingCardViewModel['listingType'], string> = {
  'traditional-office': '传统办公',
  'serviced-office': '服务式办公',
  'coworking': '共享办公',
  'full-floor': '整层办公',
}

export default function ListingCard({ listing, variant = 'default', detailAnalytics }: Props) {
  const { coverImage, price, area, building, highlights, listingType, title, slug } = listing
  const district = building?.district?.name
  const areaText = area != null ? formatArea(area) : null
  const metaParts = [district, areaText, TYPE_LABEL[listingType]].filter(Boolean)
  const fallbackAlt = `${building?.name ?? ''} ${TYPE_LABEL[listingType]}`.trim()

  return (
    <Link
      href={`/listings/${slug}`}
      className={`listing-card${variant === 'building-supply' ? ' listing-card--building-supply' : ''}`}
      data-listing-card-variant={variant}
      aria-label={`${title}，${price?.text ?? '待面议'}`}
      data-detail-analytics-event={detailAnalytics?.event}
      data-analytics-parent-id={detailAnalytics?.parentId}
      data-analytics-listing-id={detailAnalytics ? listing.id : undefined}
      data-analytics-rank={detailAnalytics?.rank}
      data-analytics-section={detailAnalytics?.section}
      data-analytics-recommendation-type={detailAnalytics?.recommendationType}
      data-analytics-supply-group={detailAnalytics?.supplyGroup}
    >
      <div className="listing-card__media">
        <Media
          media={coverImage}
          ratio="4/3"
          fallbackAlt={fallbackAlt || title}
        />
      </div>
      <div className="listing-card__body">
        {variant === 'building-supply' && price == null ? (
          <span className="price tabular price--md">价格面议</span>
        ) : (
          <Price price={price} size="md" />
        )}
        <span className="listing-card__title">{title}</span>
        {metaParts.length > 0 && (
          <span className="listing-card__meta">{metaParts.join(' · ')}</span>
        )}
        {highlights.length > 0 && (
          <div className="listing-card__tags">
            {highlights.slice(0, 3).map((text, i) => (
              <Tag key={`${i}-${text}`} variant="default">
                {text}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
