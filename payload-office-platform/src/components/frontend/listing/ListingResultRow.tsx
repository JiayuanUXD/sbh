import Link from 'next/link'
import React from 'react'
import { formatArea } from '@/lib/frontend/format'
import type { ListingCardViewModel } from '@/domain/public-catalog'
import { listAnalyticsAttrs, type ListResultAnalytics } from '@/components/frontend/listing/list-analytics'
import { LISTING_TYPE_LABEL, listingWhereLine, splitPriceText } from '@/lib/frontend/listing-display'

/**
 * OPT-036 房源结果行（列表页「横向列表」版式，comp 稿的布局 B）。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「布局 B：横向列表行」+
 * specRows「横向行 / 横向行图 / 横向行价格列 / 横向行比价优势」：整宽 · 高 182 ·
 * padding 16 · 行间 gap 12 · radius 18；图 240×150（16:10）· radius 14 · 类型压
 * 在图上；价格列定宽 176 右对齐 · 左侧 1px 分隔线 · 价格 26/600。
 *
 * 为什么这个组件在「接线任务」里才出现：`ResultToolbar`（Task 8）定义了
 * `?view=grid|row` 这个查询参数，但整个组件批次没有为 `row` 造过承载组件。
 * 接线时若只渲染网格、却仍把视图切换画出来，就正好落进 Task 8 顶部注释明令
 * 禁止的那一类——「点了没反应的死控件，比它根本不出现更误导用户」。反过来
 * 直接砍掉视图切换，则是拿掉 comp 稿里明确存在的能力去迁就现有组件清单。
 * 两条都不可取，因此补齐这一个组件，让参数、控件与渲染三者一致。
 *
 * 与 `ListingResultCard` 的分工：同一份 DTO、同一套价格切分与位置行 helper，
 * 差别只有排布方向与价格盒宽度。网格是横向扫读（同一行的卡片并排比较），
 * 横向行是纵向扫读（价格全部落在最右侧同一列上，从上往下一眼比完）——这是
 * comp 稿 specRows「横向行比价优势」写明的产品意图，不是两种随意的皮肤。
 *
 * 守护不变量（与卡片版一致）：
 *   - Server Component，只消费 `ListingCardViewModel`，不接触 Payload 文档；
 *   - 缺图：`.sf-media--16x10` 靠 aspect-ratio 撑住 240×150 不塌陷；
 *   - 缺价格：省略定宽数值盒，渲染「价格面议」纯文本，不渲染 0 或空盒；
 *   - 标题/位置超长：单行省略号，不换行、不挤压右侧价格列。
 */

/** 数值段格式化：与卡片版同一口径——day 周期两位小数，其余周期取整加千分位。 */
function formatPriceAmount(listing: ListingCardViewModel): string {
  const price = listing.price
  if (!price) return ''
  return price.period === 'day'
    ? price.amount.toFixed(2)
    : Math.round(price.amount).toLocaleString('en-US')
}

export default function ListingResultRow({ listing, citySlug, analytics }: Readonly<{
  listing: ListingCardViewModel
  citySlug?: string
  /** 列表页埋点上下文；不传则该行不产生点击事件 */
  analytics?: ListResultAnalytics
}>) {
  const { coverImage, price, area, building, listingType, title, slug } = listing
  const typeLabel = LISTING_TYPE_LABEL[listingType]
  const fallbackAlt = `${building?.name ?? ''} ${typeLabel}`.trim()
  const locationLine = listingWhereLine(building)
  const areaText = area != null ? formatArea(area) : null
  const priceUnitText = price ? (splitPriceText(price)?.unit ?? '') : ''

  return (
    <Link
      href={citySlug ? `/${citySlug}/listings/${slug}` : `/listings/${slug}`}
      // prefetch={false}：与 `ListingResultCard` 同一条判据、同一个页面、同一批 URL，
      // 只是版式不同（`?view=row`）。①高基数：实测 `/listings?view=row` 同样渲染 10 条
      // 互不相同的房源链接并逐条预取；②内容驱动：URL 由房源 slug 决定；③常驻渲染：
      // 是该视图下的列表正文，不是交互后才出现的内容。
      // 注意「③常驻」判的是「在本视图里是否常驻」，不是「本视图是否默认」——横向行
      // 一旦被选中就是整页正文，若因为它不是默认版式而不关预取，等于让同一批 URL
      // 的预取成本取决于用户选了哪个版式，那不是判据，是漏网。
      prefetch={false}
      {...listAnalyticsAttrs(analytics)}
      className="sf-card ls-rowcard"
      aria-label={`${title}，${price?.text ?? '待面议'}`}
    >
      <span className="sf-media sf-media--16x10 ls-rowcard__media">
        {coverImage ? (
          <img
            src={coverImage.src}
            alt={coverImage.alt || fallbackAlt || title}
            loading="lazy"
            decoding="async"
            width={coverImage.width}
            height={coverImage.height}
          />
        ) : null}
        <span className="sf-scrim" aria-hidden="true" />
        <span className="sf-phototag ls-rowcard__type-tag">{typeLabel}</span>
      </span>
      <span className="ls-rowcard__body">
        <span className="ls-rowcard__title">{title}</span>
        {locationLine ? (
          <span className="ls-rowcard__location" title={locationLine}>
            {locationLine}
          </span>
        ) : null}
        {areaText ? <span className="ls-rowcard__area">{areaText}</span> : null}
      </span>
      <span className="ls-rowcard__pricecol">
        {price ? (
          <span className="ls-rowcard__price">
            <span className="ls-rowcard__price-value">{formatPriceAmount(listing)}</span>
            <span className="ls-rowcard__price-unit">{priceUnitText}</span>
          </span>
        ) : (
          <span className="ls-rowcard__price ls-rowcard__price--muted">价格面议</span>
        )}
      </span>
    </Link>
  )
}
