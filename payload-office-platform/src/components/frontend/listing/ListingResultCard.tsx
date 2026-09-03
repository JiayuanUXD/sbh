import Link from 'next/link'
import React from 'react'
import { formatArea } from '@/lib/frontend/format'
import type { ListingCardViewModel, PriceViewModel } from '@/domain/public-catalog'
import { listAnalyticsAttrs, type ListResultAnalytics } from '@/components/frontend/listing/list-analytics'
import { LISTING_TYPE_LABEL, listingWhereLine, splitPriceText } from '@/lib/frontend/listing-display'
import { CardMediaPlaceholder } from '@/components/frontend/ui/Media'

/**
 * OPT-036 房源结果卡（列表页网格）
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html specRows（卡片信息六项排布 /
 * 卡片字号 / 价格对齐 / 元/月 报价的定宽盒）；卡片表面复用 styles/surface.css
 * 的 .sf-card / .sf-media / .sf-scrim / .sf-phototag（跨批次统一口径，见
 * .superpowers/sdd/cross-batch-design-decisions.md）。
 *
 * 北极星（能横向比价）落点：价格数值放进定宽右对齐盒（.ls-price__value--day
 * 58px / --month 88px），tabular-nums 保证同单位下各卡小数点竖直对齐——按天
 * 计价用两位小数，其余周期取整+千分位（月租六位数 316,200 不挤占小数位）。
 * 单位文本永远从 PriceViewModel.text 里切分取用，不新增第二份文案、不硬编码。
 *
 * 已验证范围仅限**租赁**语境（day / month / seat-month 三种单位，fixture 见
 * dev-story/opt036）。`priceBoxModifier` 把 period='year'/'one-time' 也归进
 * --month 的 88px 盒，但 one-time 一次性总价（sale，见 contracts.ts 的
 * "38000000 元" 示例）格式化后是 "38,000,000"，10 个字符装不进 88px——这条路径
 * 零覆盖，是待办而非已验证行为。楼盘供给网格确实含 sale（building-supply.ts
 * GROUP_ORDER），若未来把本卡复用到那里或出售频道，需要先给 one-time 单独定宽
 * 并补 fixture，而不是假设现有 --month 盒够用。
 *
 * 守护不变量：
 *   - Server Component，只消费 ListingCardViewModel DTO，不接收 Payload 文档；
 *   - 缺图：.sf-media 靠 aspect-ratio 撑住 4:3，不塌陷；内部渲染共享缺省占位
 *     （CardMediaPlaceholder：图标 +「图片拍摄中」）。2026-09-04 前这里是留一块裸灰底，
 *     用户侧读不出「这套房还没拍照」还是「图挂了」；
 *   - 缺价格：整行省略定宽盒，渲染「价格面议」纯文本，不渲染 0 或空盒；
 *   - 标题超长：单行省略号，不换行、不挤压价格行。
 */

/**
 * 价格定宽盒按计价周期二选一：day→58px（两位小数），其余周期→88px（整数+千分位）。
 * 仅 day/month/seat-month 三种周期在本任务验证过；'year'/'one-time' 落进 --month
 * 只是当前唯一可选的宽盒，不代表 88px 对它们够用（见上方文档注释的显式待办）。
 */
function priceBoxModifier(period: PriceViewModel['period']): 'day' | 'month' {
  return period === 'day' ? 'day' : 'month'
}

/** 数值段格式化：day 周期固定两位小数，其余周期取整并加千分位，避免小数增加位宽。 */
function formatPriceAmount(price: PriceViewModel): string {
  return price.period === 'day'
    ? price.amount.toFixed(2)
    : Math.round(price.amount).toLocaleString('en-US')
}

export default function ListingResultCard({ listing, citySlug, analytics }: Readonly<{
  listing: ListingCardViewModel
  citySlug?: string
  /** 列表页埋点上下文；不传则该卡不产生点击事件（详情页推荐位复用时即如此） */
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
      // prefetch={false}：三条件并列成立（①高基数 ②内容驱动 ③常驻渲染），判据同
      // `ListingCard` / `BuildingSummaryCard`，反例见 `ui/Breadcrumb.tsx`。
      // ①：本组件是 `/listings` 默认网格视图的唯一卡片实现，一页 10 条起（实测
      //    `artifacts/verification/OPT-037/task11c-prefetch-before.json`：一次加载
      //    预取 10 条互不相同的房源 URL），翻页/放宽筛选只会更多；
      // ②：URL 由房源 slug 决定，随内容增长而无上限；
      // ③：列表页正文，进视口即预取，不需要任何交互。
      // 预取结果几乎不会被复用（用户最终只点开一两条），是净成本。
      // Task 11 曾以为改 `ListingCard` 就覆盖了列表页——`ListingCard` 不在 `/listings`
      // 上，真正的高基数入口是这里；Task 11c 补齐。
      prefetch={false}
      {...listAnalyticsAttrs(analytics)}
      className="sf-card ls-card"
      aria-label={`${title}，${price?.text ?? '待面议'}`}
    >
      <span className="sf-media sf-media--4x3">
        {coverImage ? (
          <img
            src={coverImage.src}
            alt={coverImage.alt || fallbackAlt || title}
            loading="lazy"
            decoding="async"
            width={coverImage.width}
            height={coverImage.height}
          />
        ) : (
          <CardMediaPlaceholder />
        )}
        <span className="sf-scrim" aria-hidden="true" />
        <span className="sf-phototag ls-card__type-tag">{typeLabel}</span>
      </span>
      <span className="ls-card__body">
        <span className="ls-card__title">{title}</span>
        {locationLine ? (
          <span className="ls-card__location" title={locationLine}>
            {locationLine}
          </span>
        ) : null}
        <span className="ls-card__meta">
          {price ? (
            <span className="ls-price">
              <span className={`ls-price__value ls-price__value--${priceBoxModifier(price.period)}`}>
                {formatPriceAmount(price)}
              </span>
              <span className="ls-price__unit">{priceUnitText}</span>
            </span>
          ) : (
            <span className="ls-price ls-price--muted">价格面议</span>
          )}
          {areaText ? <span className="ls-card__area">{areaText}</span> : null}
        </span>
      </span>
    </Link>
  )
}
