import React from 'react'

/**
 * 详情页白底面板 —— 与 `.sf-card`（列表/首页卡片）刻意不同的独立表面。
 *
 * 设计依据：docs/SBH设计任务讨论/{房源详情,楼盘详情}.dc.html specRows「面板」：
 * 底 #fff · 圆角 18 · 通栏 padding 40 / 决策卡 32 · 零边框零阴影。
 *
 * 为什么不复用 `.sf-card`：`.sf-card` 是「可点击进入」的列表卡片语义——它有
 * hover 抬升与阴影反馈，因为整张卡是一个链接。详情页的面板只是纯粹的分组
 * 容器（画廊、tab 内容、周边地图、决策卡……），本身不可点，套用 hover/阴影
 * 会给用户一个「这块能点」的错误提示。padding 也不同：列表卡 **14/16px** 的
 * 密度服务浏览效率（`list.css`：`.ls-card__body` 14/16、`.ls-rowcard` 16；
 * 18–24 是**首页**卡，别引错），详情页面板 40/32px 服务的是「已经决定看这一套，
 * 需要从容读完」。**不要为了「统一」把两者合并**——密度需求方向相反，合并只会
 * 两头不讨好。
 */
export default function DetailPanel({ variant, children, className }: Readonly<{
  /** full：通栏面板（画廊、tab 内容等），padding 40。side：侧栏面板（决策卡/信息面板），padding 32。 */
  variant: 'full' | 'side'
  children: React.ReactNode
  className?: string
}>) {
  const variantClass = variant === 'full' ? 'dt-panel--full' : 'dt-panel--side'
  return (
    <div className={className ? `dt-panel ${variantClass} ${className}` : `dt-panel ${variantClass}`}>
      {children}
    </div>
  )
}
