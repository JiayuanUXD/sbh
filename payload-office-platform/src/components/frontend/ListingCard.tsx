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
 *   - 媒体比例：grid 视图 4:3，list 视图 16:10（由 CSS 覆盖）；
 *   - 卡片整体可点击，保留语义化 <a>（Cmd/Ctrl+click / 中键支持）；
 *   - alt 缺失时由"楼盘名 + 类型"生成可读替代；
 *   - 价格使用 tabular-nums，标签分类着色。
 */

type Props = Readonly<{
  listing: ListingCardViewModel
  /** Compact semantic variation for cards embedded in a building supply group. */
  variant?: 'default' | 'building-supply'
  /** 视图模式：grid 竖卡 / list 横卡（左图右文，高信息密度） */
  view?: 'grid' | 'list'
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

const DECORATION_LABEL: Record<NonNullable<ListingCardViewModel['decorationStatus']>, string> = {
  rough: '毛坯',
  simple: '简装',
  furnished: '精装修',
  fully_fitted: '全配齐',
}

const GRADE_LABEL: Record<string, string> = {
  'grade-a': '甲级',
  'super-grade-a': '超甲级',
  'creative-park': '创意园',
  'serviced-office': '服务式办公',
}

/** 标签分类着色：地铁/交通类→forest，装修/配套类→copper，其他→default */
function tagVariantFor(text: string): 'default' | 'forest' | 'copper' {
  if (/地铁|交通|直达|枢纽/.test(text)) return 'forest'
  if (/装修|配套|家具|精装|配齐/.test(text)) return 'copper'
  return 'default'
}

export default function ListingCard({ listing, variant = 'default', view = 'grid', detailAnalytics }: Props) {
  const { coverImage, price, area, building, highlights, listingType, title, slug, decorationStatus, isFeatured } = listing
  const areaText = area != null ? formatArea(area) : null
  const fallbackAlt = `${building?.name ?? ''} ${TYPE_LABEL[listingType]}`.trim()

  // 地址行：地址 + 最近地铁
  const addressParts: string[] = []
  if (building?.address) addressParts.push(building.address)
  if (building?.nearestMetro?.name) addressParts.push(`近${building.nearestMetro.name}`)
  const addressLine = addressParts.join(' · ')

  // 标签：highlights + 装修状态 + 楼盘级别（去重，受 maxTags 上限）
  const maxTags = view === 'list' ? 5 : 3
  const tags: string[] = []
  const pushTag = (t: string | null | undefined) => {
    if (t && !tags.includes(t) && tags.length < maxTags) tags.push(t)
  }
  highlights.forEach(pushTag)
  if (decorationStatus) pushTag(DECORATION_LABEL[decorationStatus])
  if (building?.grade) pushTag(GRADE_LABEL[building.grade])

  const viewClass = view === 'list' ? ' listing-card--list' : ' listing-card--grid'
  const variantClass = variant === 'building-supply' ? ' listing-card--building-supply' : ''

  return (
    <Link
      href={`/listings/${slug}`}
      className={`listing-card${viewClass}${variantClass}`}
      data-listing-card-variant={variant}
      data-listing-card-view={view}
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
        <span className="listing-card__type-badge">{TYPE_LABEL[listingType]}</span>
        {isFeatured && <span className="listing-card__featured-tag">必看好房</span>}
      </div>
      <div className="listing-card__body">
        <div className="listing-card__price-row">
          {variant === 'building-supply' && price == null ? (
            <span className="price tabular price--md">价格面议</span>
          ) : (
            <Price price={price} size="lg" />
          )}
          {areaText && <span className="listing-card__area">{areaText}</span>}
        </div>
        <h3 className="listing-card__title">{title}</h3>
        {addressLine && (
          <span className="listing-card__address" title={addressLine}>
            {addressLine}
          </span>
        )}
        {tags.length > 0 && (
          <div className="listing-card__tags">
            {tags.map((text, i) => (
              <Tag key={`${i}-${text}`} variant={tagVariantFor(text)}>
                {text}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
