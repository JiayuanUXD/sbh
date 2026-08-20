import Link from 'next/link'
import React from 'react'
import { formatArea } from '@/lib/frontend/format'
import type { ListingCardViewModel, PriceViewModel } from '@/domain/public-catalog'
import { LISTING_TYPE_LABEL, listingWhereLine, splitPriceText } from '@/components/frontend/home/HomeListingsRail'

/**
 * OPT-036 房源结果卡（列表页 / 楼盘供给网格共用）
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
 * 守护不变量：
 *   - Server Component，只消费 ListingCardViewModel DTO，不接收 Payload 文档；
 *   - 缺图：.sf-media 靠 aspect-ratio 撑住 4:3，不塌陷（不渲染 <img>，留灰底）；
 *   - 缺价格：整行省略定宽盒，渲染「价格面议」纯文本，不渲染 0 或空盒；
 *   - 标题超长：单行省略号，不换行、不挤压价格行。
 */

/** 价格定宽盒按计价周期二选一：day→58px（两位小数），其余周期→88px（整数+千分位）。 */
function priceBoxModifier(period: PriceViewModel['period']): 'day' | 'month' {
  return period === 'day' ? 'day' : 'month'
}

/** 数值段格式化：day 周期固定两位小数，其余周期取整并加千分位，避免小数增加位宽。 */
function formatPriceAmount(price: PriceViewModel): string {
  return price.period === 'day'
    ? price.amount.toFixed(2)
    : Math.round(price.amount).toLocaleString('en-US')
}

export default function ListingResultCard({ listing, citySlug }: Readonly<{
  listing: ListingCardViewModel
  citySlug?: string
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
        ) : null}
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
