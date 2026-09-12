// NavLink 而不是 next/link：点击结果卡后到详情页到达之间（线上冷开 2–4 秒）
// 需要即时反馈——被点的卡自己转圈、结果区压暗。详情路由**不能**用 loading.tsx
// 补这个反馈：那会把 404 / 307 变成 200（见 tests/opt068-listing-navigation.test.ts）。
import { NavLink } from '@/components/frontend/listing/ListingNavigation'
import { listAnalyticsAttrs, type ListResultAnalytics } from '@/components/frontend/listing/list-analytics'
import React from 'react'
import { getBuildingGradeLabel } from '@/components/frontend/building-grade'
import type { BuildingSummaryViewModel } from '@/domain/public-catalog/contracts'
import { CardMediaPlaceholder } from '@/components/frontend/ui/Media'
import { cardCoverProps } from '@/lib/frontend/media-srcset'

/**
 * OPT-081 楼盘结果行（楼盘列表页「横向列表」版式，`?view=row`）
 *
 * 与 `BuildingResultCard` 的分工，照抄房源页 `ListingResultRow` / `ListingResultCard`
 * 那一对的既有约定：**同一份 DTO、同一批字段、同一套格式化口径，差别只有排布方向
 * 与右侧数值列的宽度**。网格是横向扫读（同一行的卡片并排比较），横向行是纵向扫读
 * ——「N 套在租」全部落在最右侧同一列上，从上往下一眼比完。房源页那一列放的是
 * 价格，楼盘页没有报价（报价属于楼内各房源），这一页可比的数就是在租套数。
 *
 * ## 为什么这个组件现在才出现（以及它如何回答「楼盘页刻意没有视图切换」）
 *
 * `CityBuildingsView` 顶部曾写明楼盘页不做 `?view=`，理由是：横向紧凑行已经被
 * 用作「暂无在租」组的降权表达，高度反差**就是降权本身**，再给用户一个把有在租组
 * 也切成横向行的开关，会让两组的高度反差**消失**、分组语义随之失效。
 *
 * 那条理由成立的前提是「切成横向行 = 复用紧凑行 `BuildingCompactRow`」——那样两组
 * 确实会变成同一种东西。本组件不是那个前提：它是 182 高的**整宽**横排卡（padding
 * 16 + 图 150，与 `.ls-rowcard` 逐条同构），而**暂无在租组恒定不受 `view` 影响**，
 * 仍是紧凑行、仍是两列。
 *
 * 实测（1440 视口，本地夹具，2026-09-09）：
 *   grid 版式：有在租卡 340 高 · 四列      ｜ 暂无在租行 72 高 · 两列（664 宽）
 *   row  版式：有在租行 182 高 · 整宽 1344 ｜ 暂无在租行 72 高 · 两列（664 宽）
 *
 * 即：反差从 4.7x 收窄到 2.5x，但**没有消失**，而且 row 版式补上了一条 grid 版式
 * 没有的区分——整宽 vs 半宽。两组之间本就还有 48px 外边距 + 1px 分隔线 + 分组标题，
 * 降权是几条信号并列，不是只剩高度一条。旧决定要防的是「两组长得一样」，没有发生。
 *
 * 注：仓库多处注释把这个反差写成「182 : 64」——那是 OPT-036 按设计稿标称值写的，
 * 与实际渲染对不上（`.bd-card` 没有任何 height 约束，实际由内容撑到 340；`.bd-row`
 * 是 `min-height: 64`，实际 72）。本文件用实测值，不沿用那两个数。
 *
 * ## 与 `BuildingCompactRow` 不是同一个东西（名字都带 Row，别混）
 *
 *   - 本组件：`?view=row` 下**有在租**楼盘的结果卡，182 高、整宽，`.sf-card` 表面，
 *     渲染在租套数与在租面积——和 `BuildingResultCard` 是同一批字段。
 *   - `BuildingCompactRow`：**暂无在租**分组的降权行，min-height 64（实测 72）、两列、
 *     不用 `.sf-card`，渲染等级 / 竣工年份 / 标准层面积（在租面积对那类楼盘恒为空）。
 *
 * 守护不变量（与卡片版一致，逐条对齐 `BuildingResultCard`）：
 *   - Server Component，只消费 `BuildingSummaryViewModel` DTO，不接收 Payload 文档；
 *   - 缺图：`.sf-media--16x10` 撑住 240×150 不塌陷，内部渲染共享缺省占位的 compact
 *     变体（240 宽下副文案会折三行，只留主文案——同 `ListingResultRow`）；
 *   - 缺等级：整个标签省略，不渲染空 pill；
 *   - 缺地址 / 缺地铁：对应行整行省略，不渲染空行；
 *   - 套数与面积各自独立判空，不印 0；套数缺失时右列渲染「暂无在租」纯文本，
 *     不渲染空的数值盒（对齐 `ListingResultRow` 缺价格时的「价格面议」处置）。
 *     正常产品流程下不会走到——暂无在租的楼盘归在另一组、走紧凑行，这里同
 *     `BuildingResultCard` 一样只做防御；
 *   - 楼名 / 地址超长：单行省略号，不换行、不挤压右侧数值列。
 */

/** 与 `BuildingResultCard.formatLeasableArea` 同一惯例：取整 + 千分位，不带小数。 */
function formatLeasableArea(area: number): string {
  return Math.round(area).toLocaleString('en-US')
}

export default function BuildingResultRow({ building, citySlug, analytics, stockUnitLabel = '套在租' }: Readonly<{
  building: BuildingSummaryViewModel
  citySlug?: string
  /** 列表页埋点上下文；不传则不产生点击事件 */
  analytics?: ListResultAnalytics
  /** 套数量词（OPT-096）：租赁口径「套在租」，出售口径「套在售」；由页面 scope 决定 */
  stockUnitLabel?: string
}>) {
  const { coverImage, grade, address, nearestMetro, leasableArea, listingCount, name, slug } = building
  const gradeLabel = getBuildingGradeLabel(grade)
  const hasCount = listingCount != null && listingCount > 0
  const areaText = leasableArea != null && leasableArea > 0 ? formatLeasableArea(leasableArea) : null
  // 与 `BuildingResultCard` 同一条可访问名口径：「这栋楼现在有几套在租」是用户最想
  // 知道的数，换个版式不该把它从可访问名里丢掉。
  const ariaLabel = hasCount ? `${name}，${listingCount} ${stockUnitLabel}` : name

  return (
    <NavLink
      href={citySlug ? `/${citySlug}/buildings/${slug}` : `/buildings/${slug}`}
      // prefetch={false}：与 `BuildingResultCard` 同一条判据、同一个页面、同一批 URL，
      // 只是版式不同（`?view=row`）。①高基数：本组件是 `?view=row` 下「当前有在租」
      // 分组的唯一卡片实现，一页 N 张，URL 与网格版逐条相同；②内容驱动：URL 由楼盘
      // slug 决定；③常驻渲染：是该视图下的列表正文。
      // 「③常驻」判的是「在本视图里是否常驻」，不是「本视图是否默认」——同
      // `ListingResultRow` 顶部那段：若因为它不是默认版式而不关预取，等于让同一批
      // URL 的预取成本取决于用户选了哪个版式，那不是判据，是漏网。
      prefetch={false}
      {...listAnalyticsAttrs(analytics)}
      className="sf-card bd-rowcard"
      aria-label={ariaLabel}
    >
      <span className="sf-media sf-media--16x10 bd-rowcard__media">
        {coverImage ? (
          <img
            // 桌面 240 定宽、≤767 收敛回整宽竖排卡（见 list.css 移动端一节），
            // 因此 sizes 的两段与 `BuildingResultCard` 只差桌面那一档的宽度。
            {...cardCoverProps(coverImage, '(max-width: 767px) 100vw, 240px')}
            alt={coverImage.alt || name}
            loading="lazy"
            decoding="async"
            width={coverImage.width}
            height={coverImage.height}
          />
        ) : (
          <CardMediaPlaceholder compact />
        )}
        <span className="sf-scrim" aria-hidden="true" />
        {gradeLabel ? <span className="sf-phototag bd-rowcard__grade-tag">{gradeLabel}</span> : null}
      </span>
      <span className="bd-rowcard__body">
        <span className="bd-rowcard__title">{name}</span>
        {address ? (
          <span className="bd-rowcard__line" title={address}>
            {address}
          </span>
        ) : null}
        {nearestMetro?.name ? <span className="bd-rowcard__line">近{nearestMetro.name}</span> : null}
      </span>
      <span className="bd-rowcard__statcol">
        {hasCount ? (
          <span className="bd-rowcard__stock">
            <span className="bd-rowcard__stock-value sf-num">{listingCount}</span>
            <span className="bd-rowcard__stock-unit">{stockUnitLabel}</span>
          </span>
        ) : (
          <span className="bd-rowcard__stock bd-rowcard__stock--muted">暂无在租</span>
        )}
        {areaText ? <span className="bd-rowcard__area-total sf-num">合计 {areaText} ㎡</span> : null}
      </span>
    </NavLink>
  )
}
