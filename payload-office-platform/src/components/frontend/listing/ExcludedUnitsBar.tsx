import Link from 'next/link'
import React from 'react'
import type { PriceDisplayUnit } from '@/domain/public-catalog'
import { buildPriceUnitHref } from '@/lib/frontend/listing-url'

/**
 * 被排除单位提示条 —— Server Component。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html specRows「被排除的单位」+
 * 正文「另有 536 套按 元/月 报价、418 套按 元/工位/月 报价，因单位不可换算未
 * 计入本结果集。」（房源列表.dc.html:376）。
 *
 * 这不是可选装饰，是本页北极星（「能横向比价」）附带的诚实义务：结果集只含
 * 一种单位，意味着其余单位的房源被悄悄挡在外面。没有这条提示，机制就从
 * 「帮用户比价」变成「藏起大部分库存」——见 `PriceUnitSegment.tsx` 顶部注释、
 * 及本次任务的 brief。
 *
 * 守护不变量：
 *   - `excluded` 为空（或过滤掉零计数后为空）时返回 `null`，不留一条空白条；
 *   - 计数为 0 的单位不出现在提示条里——0 套「另有」毫无信息量，且与「缺失显示
 *     — 不显示 0」的项目数字规则同源（见 payload-office-platform/.agent/frontend.md）；
 *     调用方按理应已过滤好非零 excluded，这里再次防御性过滤，不假设调用方守规矩；
 *   - href 由 `lib/frontend/listing-url.ts` 的 `buildPriceUnitHref` 统一构造：
 *     与 `PriceUnitSegment` 共用同一份契约——只写 `priceUnit`、删除 `page` 与
 *     残留的旧名 `rentUnit`，其余参数原样保留（该函数曾在两个组件里各自内联
 *     一份逐字节相同的实现，Task 7 code review 时收敛过去，理由见其顶部注释）。
 */

export type ExcludedUnitOption = Readonly<{
  value: PriceDisplayUnit
  label: string
  count: number
}>

export default function ExcludedUnitsBar(props: Readonly<{
  excluded: ReadonlyArray<ExcludedUnitOption>
  basePath: string
  currentParams: URLSearchParams
}>): React.JSX.Element | null {
  const { excluded, basePath, currentParams } = props
  const visible = excluded.filter((unit) => unit.count > 0)
  if (visible.length === 0) return null

  return (
    <div className="ls-excludedbar">
      <span className="ls-excludedbar__text">
        另有{' '}
        {visible.map((unit, index) => (
          <React.Fragment key={unit.value}>
            {index > 0 ? '、' : ''}
            <Link href={buildPriceUnitHref(basePath, currentParams, unit.value)} className="ls-excludedbar__link">
              <span className="ls-excludedbar__count">{unit.count}</span> 套按 {unit.label} 报价
            </Link>
          </React.Fragment>
        ))}
        ，因单位不可换算未计入本结果集。
      </span>
    </div>
  )
}
