import Link from 'next/link'
import React from 'react'

/**
 * OPT-036 空态 ① · 该条件本身无货 —— Server Component。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「三种空态 · ① 无结果 · 这类房源
 * 本身还没有」区块 + specRows「空态 ①」：标题 22/600 · 主按钮 40 高 accent · 次
 * 按钮 40 高 `#f5f5f7`。
 *
 * 与②③刻意不同的含义（brief 强调「不得共用一套样式」）：这一态下用户没有做错
 * 任何事——不是筛选收得太紧，是这个城市/频道这一类目前就是一套都没有。因此
 * 文案不提"放宽条件"（那是②的责任），只给两个出口：看看这一类之外还有什么
 * （主）、离开去别处逛逛（次）。
 *
 * 只接收 `noun` + `basePath` 两个 prop（brief 锁定的接口），不接收总数/城市名：
 *   - `noun` 是「还在收录中」的主语——调用方传入描述这一类的名词短语（如
 *     comp 稿的「上海的共享工位房源」），本组件只负责拼接固定后缀，不臆造
 *     城市/频道文案生成逻辑（那属于调用方的语境）。
 *   - 两个出口都不依赖额外数据：主按钮回到 `basePath`（该频道未叠加这一类
 *     限制的完整结果），次按钮回到站点首页 `/`——静态根路径，与
 *     `SupplySubmissionForm.tsx` 现有的 `href="/"` 同一惯例，不是新发明。
 *     comp 稿次按钮是「有房源时通知我」（需要订阅能力），但该能力本批次
 *     未实现，接口也未开放相应 prop，此处不伪造一个假交互。
 */
export default function EmptyNoStock(props: Readonly<{
  noun: string
  basePath: string
}>): React.JSX.Element {
  const { noun, basePath } = props

  return (
    <div className="ls-empty ls-empty--nostock">
      <span className="ls-empty__title">{noun}还在收录中</span>
      <span className="ls-empty__body">
        这不是筛选收得太严——这一类目前确实还没有一套上架，不是被藏起来的空货架。
        我们持续核对新增供给，一上架就会显示在这里。
      </span>
      <span className="ls-empty__actions">
        <Link href={basePath} className="ls-empty__btn ls-empty__btn--primary">查看全部结果</Link>
        <Link href="/" className="ls-empty__btn ls-empty__btn--secondary">返回首页</Link>
      </span>
    </div>
  )
}
