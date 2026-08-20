import Link from 'next/link'
import React from 'react'
import type { PriceDisplayUnit } from '@/domain/public-catalog'

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
 *   - 切换即导航，写入 `?priceUnit=<value>`；`priceUnit` 是域层已收敛的唯一
 *     单位参数（见 `domain/public-catalog/search-params.ts`），旧名 `rentUnit`
 *     仍被解析层接受但 canonical 只输出 `priceUnit`——本组件写 href 时一并
 *     删除残留的 `rentUnit`，不让非 canonical 参数组合流回地址栏。
 *   - 必须删除 `page`：换单位就是换结果集（`findEffectiveListings` 对
 *     `priceUnit` 做的是 `where.rentUnit = { equals }` 精确过滤，不是排序内
 *     重排），停在旧页码会看到空结果或跳过前面的房源。
 *   - 排序参数原样保留、不需要特殊处理：`normalizeSort` 只在 `priceUnit`
 *     缺失时把 `price-asc/desc` 降级为 `recommended`（见 search-params.ts
 *     `normalizeSort`）；本组件的 href 永远带着一个 `priceUnit` 值（只是换了
 *     取值，不会清空该参数），所以降级分支不会被触发，`sort=price-asc` 之类
 *     的参数原样透传到新单位下依然合法。
 *   - 当前单位渲染为纯文本（非链接）——再点一次没有意义，且与 comp 稿一致
 *     （房源列表.dc.html:113 当前项是 `<span>`，其余是 `<a>`）。
 */

/** 克隆并归一 currentParams：统一改一个参数、删 page、清掉旧名 rentUnit 残留。 */
function buildUnitHref(
  basePath: string,
  currentParams: URLSearchParams,
  unit: PriceDisplayUnit,
): string {
  const sp = new URLSearchParams(currentParams)
  sp.delete('page')
  sp.delete('rentUnit')
  sp.set('priceUnit', unit)
  const qs = sp.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

export type PriceUnitOption = Readonly<{
  value: PriceDisplayUnit
  label: string
  count: number
}>

export default function PriceUnitSegment(props: Readonly<{
  units: ReadonlyArray<PriceUnitOption>
  activeUnit: PriceDisplayUnit
  basePath: string
  currentParams: URLSearchParams
}>): React.JSX.Element {
  const { units, activeUnit, basePath, currentParams } = props

  return (
    <div className="ls-unitrow">
      <span className="ls-unitrow__label">租金单位</span>
      <div className="ls-unitseg">
        {units.map((unit) => {
          const isActive = unit.value === activeUnit
          if (isActive) {
            return (
              <span key={unit.value} className="ls-unitseg__item ls-unitseg__item--active">
                {unit.label}
                <span className="ls-unitseg__count">{unit.count}</span>
              </span>
            )
          }
          return (
            <Link
              key={unit.value}
              href={buildUnitHref(basePath, currentParams, unit.value)}
              className="ls-unitseg__item"
            >
              {unit.label}
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
