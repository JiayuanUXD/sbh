import Link from 'next/link'
import React from 'react'
import type { PriceDisplayUnit } from '@/domain/public-catalog'
import { buildPriceUnitHref } from '@/lib/frontend/listing-url'

/**
 * 租金单位分段切换 —— Server Component。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「租金单位机制 · 方案 1：常驻
 * 分段切换」+ specRows「单位分段」：外壳 `#e9e9ed` radius 980 padding 4 · 段高
 * 32 · 选中白底 600。
 *
 * 为什么这个组件存在（不是可选装饰）：
 *   商办报价天然有三种彼此不可换算的单位（元/月 整租 / 元/㎡/天 按面积 /
 *   元/工位/月 联合办公）——缺面积或工位数就换算不了，因此也没法跨单位排序
 *   或比价。产品选择是「先选单位，结果集只含该单位」，这样列表页才能真正
 *   横向比价。但这个选择带来一个诚实义务：用户必须随时看清「现在在看哪一类
 *   价格」——本组件就是那个持续可见的状态展示，配合 `ExcludedUnitsBar` 说明
 *   「还有多少被换算掉的库存没显示」。
 *
 * 交互与 URL：
 *   - 切换即导航，写入 `?priceUnit=<value>`，href 由 `lib/frontend/listing-url.ts`
 *     的 `buildPriceUnitHref` 统一构造（与 `ExcludedUnitsBar` 共用同一份契约：
 *     只 `set priceUnit`、删 `page`、清掉旧名 `rentUnit` 残留、排序参数原样
 *     透传不需要特殊处理——理由见该函数顶部注释）。
 *   - 当前单位渲染为纯文本（非链接）——再点一次没有意义，且与 comp 稿一致
 *     （房源列表.dc.html:113 当前项是 `<span>`，其余是 `<a>`）。
 *
 * 计数为 0 的处理（Task 7 code review Minor 1）：
 *   - **非当前单位**：计数为 0 时整项不渲染——不能让用户点开一个写着「0」的
 *     可点击分段，这与批次统一的「数字缺失显示 —、不显示 0」规则同源，
 *     `ExcludedUnitsBar` 已经这样处理零计数单位，本组件补齐同一口径。
 *   - **当前单位（activeUnit）**：永远保留，不参与这次过滤——它代表「现在
 *     正在看哪一类」，即使叠加了其它筛选后这个单位下恰好 0 套，用户仍需要
 *     一个可见的落点去理解自己选中的是哪个分段；此时只隐藏它自己的数字（不
 *     渲染「0」，也不伪造成「—」——分段标签本身已经是完整信息，数字只是
 *     补充，缺了就不补）。
 *   - **尚未选定任何单位**（`activeUnit` 省略，Task 11 接线时加宽）：URL 上没有
 *     `priceUnit` 时结果集里本来就混着多种单位，此时把任何一项画成「当前项」
 *     都是在撒谎——那一项并没有过滤结果集。因此 `activeUnit` 可省略，省略时
 *     全部有货单位都渲染成可点链接、无当前项，用户点任意一项即进入「选定单位」
 *     状态。列表页默认不强制单位（不改变 `/[city]/listings` 既有的结果集口径），
 *     这个「未选定」态因此是真实存在的主路径，不是边角情形。
 *   - **一个有货单位都没有**：返回 `null`，不渲染空壳（仅在未选定单位且结果集
 *     完全无价格时可能出现）。
 *   - **过滤后不足 2 项**（只剩当前单位一项，其余全为 0）：一个只有一个选项
 *     的「分段切换控件」名不副实——没有第二个单位可切，继续渲染成看起来能点
 *     的胶囊分段反而误导用户去点。这种情况下退化为一行非交互文本标签，只保留
 *     「现在看的是哪一类价格」这条最基本的诚实义务；不渲染分段外壳
 *     （`#e9e9ed` 胶囊）与横向说明句——说明句讲的是「三种单位如何互斥切换」，
 *     此刻没有第二个单位可切，讲了也是噪音。
 */

export type PriceUnitOption = Readonly<{
  value: PriceDisplayUnit
  label: string
  count: number
}>

export default function PriceUnitSegment(props: Readonly<{
  units: ReadonlyArray<PriceUnitOption>
  /** 当前选定单位；省略表示「尚未选定」（URL 上没有 priceUnit），见上方注释。 */
  activeUnit?: PriceDisplayUnit
  basePath: string
  currentParams: URLSearchParams
  /** 行首标签，如「租金单位」（租）/「计价单位」（售）。 */
  label?: string
}>): React.JSX.Element | null {
  const { units, activeUnit, basePath, currentParams, label = '租金单位' } = props

  const visible = units.filter((unit) => unit.value === activeUnit || unit.count > 0)

  if (visible.length === 0) return null

  if (visible.length < 2) {
    const only = visible[0]
    const isActive = only.value === activeUnit
    // 只剩一项时不再是「分段切换」：没有第二个单位可切，渲染成可点胶囊只会
    // 误导用户去点。未选定单位时同样退化为纯文本——点它得到的结果集与现在
    // 完全相同（这一个单位本来就是全部有货的单位）。
    return (
      <div className="ls-unitrow">
        <span className="ls-unitrow__label">{label}</span>
        <span
          className="ls-unitseg__item ls-unitseg__item--active ls-unitseg__item--solo"
          {...(isActive ? { 'aria-current': 'true' as const } : {})}
        >
          {only.label}
          {only.count > 0 ? <span className="ls-unitseg__count">{only.count}</span> : null}
        </span>
      </div>
    )
  }

  return (
    <div className="ls-unitrow">
      <span className="ls-unitrow__label">{label}</span>
      <div className="ls-unitseg">
        {visible.map((unit) => {
          const isActive = unit.value === activeUnit
          if (isActive) {
            return (
              <span key={unit.value} className="ls-unitseg__item ls-unitseg__item--active" aria-current="true">
                {unit.label}
                {unit.count > 0 ? <span className="ls-unitseg__count">{unit.count}</span> : null}
              </span>
            )
          }
          return (
            <Link
              key={unit.value}
              href={buildPriceUnitHref(basePath, currentParams, unit.value)}
              className="ls-unitseg__item"
            >
              {unit.label}
              {/* 非当前单位已被上方过滤为 count > 0，这里不需要再判空 */}
              <span className="ls-unitseg__count">{unit.count}</span>
            </Link>
          )
        })}
      </div>
      <span className="ls-unitrow__hint">
        三种报价单位之间缺少面积或工位数，无法换算，因此不合并排序。切换单位会更换整个结果集。
      </span>
    </div>
  )
}
