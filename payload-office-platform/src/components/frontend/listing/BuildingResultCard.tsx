import Link from 'next/link'
import React from 'react'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'

/**
 * OPT-036 楼盘结果卡（列表页网格「当前有在租」分组）
 *
 * 设计依据：docs/SBH设计任务讨论/楼盘列表.dc.html specRows（16:10 封面——楼盘封面多为
 * 横向街景，这与房源卡 4:3 是刻意差异 / 等级标签无色相 / 卡底数据行 19/600 定宽右对齐
 * tabular-nums 的「N 套在租」+ 13px 的「合计 xxx ㎡」）；卡片表面复用 styles/surface.css
 * 的 .sf-card / .sf-media / .sf-scrim / .sf-phototag（跨批次统一口径，见
 * .superpowers/sdd/cross-batch-design-decisions.md）。
 *
 * 定宽盒实测从设计稿的 26px 放宽到 36px：dev-story 三位数套数 fixture（128）在
 * 19px/600 tabular-nums 下 scrollWidth 35px，26px 会让数字和「套在租」单位粘在
 * 一起（无空格观感），36px 留 1px 余量；两位数场景只是盒内多一点右侧留白，
 * text-align:right 仍保证同列数字右边缘对齐，跨卡纵向对齐机制不受影响。
 *
 * 历史注记：本组件早先版本曾因 BuildingSummaryViewModel 缺「在租套数」字段，把这个
 * 定宽盒改成显示在租面积（设计稿的 noStockNum 降级变体）。域层现已补上真实的
 * `listingCount`（SupplyAdapter.aggregateEffectiveSupplyByBuildings 与 SUM(area) 同一次
 * SQL 聚合出的 COUNT(*)，参见 supply-adapter.ts / facade.ts attachSupplyAggregates），
 * 卡片改回设计稿原版：套数走 19/600 定宽右对齐盒（读到的是用户最想知道的「这栋楼现在有
 * 几套在租」），面积仍以「合计 xxx ㎡」小字展示在同一行——两者是不同的数，不是互相替代。
 *
 * 守护不变量：
 *   - Server Component，只消费 BuildingSummaryViewModel DTO，不接收 Payload 文档；
 *   - 缺图：.sf-media 靠 aspect-ratio 撑住 16:10，不塌陷（不渲染 <img>，留灰底）；
 *   - 缺等级：整个标签省略，不渲染空 pill；
 *   - 缺地址 / 缺地铁：对应行整行省略，不渲染空行；
 *   - 套数与面积各自独立判空——listingCount 与 leasableArea 理论上总是同时出现
 *     （同一次聚合、同一批有效供给行），但组件不假设这一点：任一个缺失就只省略
 *     那一段，不印 0；两个都缺失（正常产品流程下不会发生——按设计只有「暂无在租」
 *     楼盘才会缺，而那类楼盘走 BuildingCompactRow 不走这张卡；这里仍防御性处理）
 *     则整个卡底数据行省略；
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
  const { coverImage, grade, address, nearestMetro, leasableArea, listingCount, name, slug } = building
  const gradeLabel = getBuildingGradeLabel(grade)
  const hasCount = listingCount != null && listingCount > 0
  const hasArea = leasableArea != null && leasableArea > 0

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
        {hasCount || hasArea ? (
          <span className="bd-card__stats">
            {hasCount ? (
              <span className="bd-card__stock-group">
                <span className="bd-card__stock sf-num">{listingCount}</span>
                <span className="bd-card__stock-unit">套在租</span>
              </span>
            ) : null}
            {hasArea ? (
              <span className="bd-card__area-total sf-num">合计 {formatLeasableArea(leasableArea!)} ㎡</span>
            ) : null}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
