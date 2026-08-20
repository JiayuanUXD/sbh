import Link from 'next/link'
import React from 'react'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'

/**
 * OPT-036 楼盘结果卡（列表页网格「当前有在租」分组）
 *
 * 设计依据：docs/SBH设计任务讨论/楼盘列表.dc.html specRows（16:10 封面——楼盘封面多为
 * 横向街景，这与房源卡 4:3 是刻意差异 / 等级标签无色相 / 卡底数据行 19/600 定宽右对齐
 * tabular-nums）；卡片表面复用 styles/surface.css 的 .sf-card / .sf-media / .sf-scrim /
 * .sf-phototag（跨批次统一口径，见 .superpowers/sdd/cross-batch-design-decisions.md）。
 *
 * 已验证偏差（读之前先看这条，别被下面「19/600 定宽盒」字面误导成套数）：
 * 设计稿卡底数据行原是「{{b.stock}} 套在租」（套数，26px 定宽两位数）+「合计 {{b.area}} ㎡」
 * 两段。但 BuildingSummaryViewModel 至今没有真实的「在租套数」计数字段——
 * building-search.ts 的 sort='stock-desc' / partitionByStock 本身就是拿 leasableArea>0
 * 当「有在租」的代理，从未统计过套数（facade.ts attachLeasableArea 只用一次 SQL 聚合
 * 补在租面积，不聚合套数）。设计稿自己也预留了 showStock=false 时的降级变体（同文件
 * 255-257 行 noStockNum 分支：只显示「在租面积 {area} ㎡」一行），本实现就是采用这个
 * 降级变体——19/600 定宽右对齐盒里放的是格式化后的在租面积数值（Math.round + 千分位，
 * 与 HomeBuildingsRail「在租 {area} ㎡」phototag 同一惯例），不是编造的套数；定宽也从
 * 26px（两位数）放宽到 64px 以容纳面积的位数，右对齐 + tabular-nums 的跨卡纵向对齐
 * 机制不变。若未来有人把「在租套数」聚合补进 domain 层，这里要换回设计稿原版双段布局，
 * 而不是继续用面积顶替。
 *
 * 守护不变量：
 *   - Server Component，只消费 BuildingSummaryViewModel DTO，不接收 Payload 文档；
 *   - 缺图：.sf-media 靠 aspect-ratio 撑住 16:10，不塌陷（不渲染 <img>，留灰底）；
 *   - 缺等级：整个标签省略，不渲染空 pill；
 *   - 缺地址 / 缺地铁：对应行整行省略，不渲染空行；
 *   - 缺在租面积（正常产品流程下不会发生——按设计只有「暂无在租」楼盘才会缺此字段，
 *     而那类楼盘走 BuildingCompactRow 不走这张卡；这里仍防御性处理，整行省略不显示 0）；
 *   - 楼名超长：单行省略号，不换行。
 */

/** 与 HomeBuildingsRail 的「在租 {area} ㎡」同一惯例：取整 + 千分位，不带小数。 */
function formatLeasableArea(area: number): string {
  return Math.round(area).toLocaleString('en-US')
}

export default function BuildingResultCard({ building, citySlug }: Readonly<{
  building: BuildingSummaryViewModel
  citySlug?: string
}>) {
  const { coverImage, grade, address, nearestMetro, leasableArea, name, slug } = building
  const gradeLabel = getBuildingGradeLabel(grade)
  const hasStock = leasableArea != null && leasableArea > 0

  return (
    <Link
      href={citySlug ? `/${citySlug}/buildings/${slug}` : `/buildings/${slug}`}
      className="sf-card bd-card"
      aria-label={name}
    >
      <span className="sf-media sf-media--16x10">
        {coverImage ? (
          <img
            src={coverImage.src}
            alt={coverImage.alt || name}
            loading="lazy"
            decoding="async"
            width={coverImage.width}
            height={coverImage.height}
          />
        ) : null}
        <span className="sf-scrim" aria-hidden="true" />
        {gradeLabel ? <span className="sf-phototag bd-card__grade-tag">{gradeLabel}</span> : null}
      </span>
      <span className="bd-card__body">
        <span className="bd-card__title">{name}</span>
        {address ? <span className="bd-card__line">{address}</span> : null}
        {nearestMetro?.name ? <span className="bd-card__line">近{nearestMetro.name}</span> : null}
        {hasStock ? (
          <span className="bd-card__stats">
            <span className="bd-card__stock sf-num">{formatLeasableArea(leasableArea!)}</span>
            <span className="bd-card__stock-unit">㎡在租</span>
          </span>
        ) : null}
      </span>
    </Link>
  )
}
