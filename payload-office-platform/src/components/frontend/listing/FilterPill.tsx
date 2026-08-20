import Link from 'next/link'
import React from 'react'

/**
 * 筛选 pill —— 跨表单复用的选中态原语。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html specRows「筛选 pill」「筛选
 * 激活态」：高 36 · padding 0 14 · radius 980 · 13/500；**激活态零色相**——
 * 底 #1d1d1f 文字 #fff，未选底 #fff 文字 --ink-2，不借助任何有色相的强调色。
 * 全批次唯一被批准打破此规则的是楼盘列表「仅看有在租」toggle（另一任务的产物），
 * 与本组件无关。
 *
 * 不要把它当成 FilterFormC 行内选项的实现基础——那些是纯文本 <a>（选中态用
 * --accent-link/500，未选 --ink），配色规则与本组件刻意不同，两条规则分别服务
 * 「行内单选文本」与「实体 pill 筛选入口」（形态 A 常驻横条 / 移动筛选摘要等）
 * 两种不同的 UI 语境，混用会让其中一种失去自己的视觉含义。
 *
 * Server Component：点击即导航，href 由调用方按当前状态构造好传入
 * （是否切换、是否清除，均由 href 语义决定，本组件不持有筛选逻辑）。
 */
export default function FilterPill({ href, label, active, count }: Readonly<{
  href: string
  label: string
  active: boolean
  count?: number
}>) {
  return (
    <Link href={href} aria-current={active ? 'true' : undefined} className={active ? 'ls-pill ls-pill--active' : 'ls-pill'}>
      <span>{label}</span>
      {count != null ? <span className="ls-pill__count">{count}</span> : null}
    </Link>
  )
}
