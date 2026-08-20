import Link from 'next/link'
import React from 'react'

/**
 * OPT-036 空态 ② · 筛选后无结果 —— Server Component。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「三种空态 · ② 筛选后无结果 ·
 * 逐条给出放宽后的命中数（最重要的一种）」区块 + specRows「空态 ②（筛选后）」：
 * 逐条退路行 56 高 · 命中数 15/600 tabular-nums · 点击只改一个参数。
 *
 * 为什么这是三态里最重要的一个（brief 原话）：用户自己把条件收得太紧，是
 * 唯一「用户可以自己解决」的空态——只说「没有符合条件的房源」是失败的实现，
 * 必须给可操作的退路。每条退路只放宽调用方指定的那一个条件，并显示放宽后
 * 的真实命中数（不是估算），点击直接落地到那个已放宽的结果页——href 由
 * 调用方按当前 URL 只改一个参数构造好传入（与 FilterFormC/PriceUnitSegment
 * 的既有约定一致，本组件不持有筛选逻辑）。
 *
 * `relaxations` 为空数组时仍必须可用（brief 明确要求，防止死胡同）：
 *   - 页头的「清除全部条件」按钮不依赖 relaxations，任何情况下都渲染；
 *   - `visible`（见下方）在为空时把说明句换成「没有可单独放宽的条件」，
 *     不渲染逐条退路区块与其下方的操作提示——避免出现一个空的退路列表容器。
 *
 * `hitCount<=0` 的退路项不渲染（`visible` 同时过滤该情形）：与批次统一的
 * 「数字缺失不显示 0」规则同源——一条放宽后命中数仍是 0 的"退路"名不副实，
 * 展示出来只会让用户再点一次空手而归。调用方理应只传命中数 >0 的退路，这里
 * 是防御性兜底，不是本组件预期的主路径。过滤后为空同样落入上面的空数组分支，
 * 不需要第二套「全部过滤完」的文案。
 */
export type Relaxation = Readonly<{ label: string; hitCount: number; href: string }>

export default function EmptyFiltered(props: Readonly<{
  relaxations: readonly Relaxation[]
  clearAllHref: string
}>): React.JSX.Element {
  const { relaxations, clearAllHref } = props
  const visible = relaxations.filter((r) => r.hitCount > 0)
  const hasRelaxations = visible.length > 0

  return (
    <div className="ls-emptyfiltered">
      <div className="ls-emptyfiltered__head">
        <span className="ls-emptyfiltered__intro">
          <span className="ls-emptyfiltered__title">当前筛选组合下没有符合条件的房源</span>
          <span className="ls-emptyfiltered__desc">
            {hasRelaxations
              ? '放宽下面任一条件，就能立刻看到结果——数字是放宽后的真实命中数，不是估算。'
              : '没有可单独放宽的条件，清除全部筛选，看看完整结果。'}
          </span>
        </span>
        <Link href={clearAllHref} className="ls-emptyfiltered__clear-all">清除全部条件</Link>
      </div>

      {hasRelaxations ? (
        <>
          <div className="ls-emptyfiltered__rows">
            {visible.map((r) => (
              <Link key={r.href} href={r.href} className="ls-emptyfiltered__row">
                <span className="ls-emptyfiltered__row-label">{r.label}</span>
                <span className="ls-emptyfiltered__row-hit">{r.hitCount}</span>
                <svg width="8" height="13" viewBox="0 0 10 16" fill="none" aria-hidden="true" className="ls-emptyfiltered__row-chevron">
                  <path d="M2 1l6 7-6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            ))}
          </div>
          <span className="ls-emptyfiltered__hint">点任一行只改那一个参数，其余条件与排序保留在地址栏里</span>
        </>
      ) : null}
    </div>
  )
}
