import Link from 'next/link'
import { listAnalyticsAttrs, type ListResultAnalytics } from '@/components/frontend/listing/list-analytics'
import React from 'react'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'
import { CardMediaPlaceholder } from '@/components/frontend/ui/Media'

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
 *   - 缺图：.sf-media 靠 aspect-ratio 撑住 16:10，不塌陷；内部渲染共享缺省占位
 *     （CardMediaPlaceholder：图标 +「图片拍摄中」），不再留裸灰底；
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

export default function BuildingResultCard({ building, citySlug, analytics }: Readonly<{
  building: BuildingSummaryViewModel
  citySlug?: string
  /** 列表页埋点上下文；不传则不产生点击事件 */
  analytics?: ListResultAnalytics
}>) {
  const { coverImage, grade, address, nearestMetro, leasableArea, listingCount, name, slug } = building
  const gradeLabel = getBuildingGradeLabel(grade)
  const hasCount = listingCount != null && listingCount > 0
  // 用局部 const 承接窄化结果，而不是在 JSX 里对 leasableArea 做非空断言——
  // areaText 本身就是「已判空」的字符串，读到它的地方不需要再相信调用方没传错。
  const areaText = leasableArea != null && leasableArea > 0 ? formatLeasableArea(leasableArea) : null
  // 与 ListingResultCard 的 aria-label（把价格带进可访问名）同一惯例：
  // 「这栋楼现在有几套在租」是用户最想知道的数，可访问名不能把它漏掉。
  const ariaLabel = hasCount ? `${name}，${listingCount} 套在租` : name

  return (
    <Link
      href={citySlug ? `/${citySlug}/buildings/${slug}` : `/buildings/${slug}`}
      // prefetch={false}：三条件并列成立，判据同 `ListingResultCard`。
      // ①高基数：本组件是 `/buildings`「当前有在租」分组的唯一卡片实现，一页 N 张
      //    （实测 fixture 上 5 张 + 紧凑行 2 行 = 7 条楼盘 URL 被逐条预取，见
      //    `artifacts/verification/OPT-037/task11c-prefetch-before.json`；生产楼盘量
      //    远大于房源以外的任何目录）；②内容驱动：URL 由楼盘 slug 决定；
      // ③常驻渲染：列表页正文，进视口即预取。
      prefetch={false}
      // .bd-card 本身无样式声明，只作 BEM 块名锚点（下面的 __ 子元素依它命名）；
      // 卡片表面属性全部来自 .sf-card，与 home.css 的 .hm-supply-card 同一惯例。
      {...listAnalyticsAttrs(analytics)}
      className="sf-card bd-card"
      aria-label={ariaLabel}
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
        ) : (
          <CardMediaPlaceholder />
        )}
        <span className="sf-scrim" aria-hidden="true" />
        {gradeLabel ? <span className="sf-phototag bd-card__grade-tag">{gradeLabel}</span> : null}
      </span>
      <span className="bd-card__body">
        <span className="bd-card__title">{name}</span>
        {address ? <span className="bd-card__line">{address}</span> : null}
        {nearestMetro?.name ? <span className="bd-card__line">近{nearestMetro.name}</span> : null}
        {hasCount || areaText ? (
          <span className="bd-card__stats">
            {hasCount ? (
              <span className="bd-card__stock-group">
                <span className="bd-card__stock sf-num">{listingCount}</span>
                <span className="bd-card__stock-unit">套在租</span>
              </span>
            ) : null}
            {areaText ? <span className="bd-card__area-total sf-num">合计 {areaText} ㎡</span> : null}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
