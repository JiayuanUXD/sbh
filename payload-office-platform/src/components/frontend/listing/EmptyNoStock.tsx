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
 * （主）、留下一个真实的诉求（次）。
 *
 * 接口在首版「只接收 noun + basePath」的基础上加宽了两个可选 prop——原则与
 * Task 6 `countNoun` 同一条：**接口该加宽就加宽，不要为了迁就一个偏窄的签名
 * 去把体验降级**。具体到这两处：
 *
 *   - `secondaryAction`：次要出口的插槽。首版把它写死成 `href="/"` 返回首页，
 *     但生产环境现有空态（`CityListingsView.tsx`）用的是
 *     `<InquiryModal pageType="search" triggerLabel="提交需求" triggerVariant="primary" />`
 *     ——一个用户搜了半天扑空后仍能"告诉我们要什么"的真实出口，比把人赶回
 *     首页更有用。本组件不 import `InquiryModal`（Server Component 完全可以
 *     直接渲染 Client Component，插槽不是为了绕过这个边界）——用插槽是为了
 *     不让 `EmptyNoStock` 知道 `InquiryModal` 那一整串页面相关 props
 *     （`pageType`/`triggerLabel`/`triggerVariant` 等）：这些参数因页面而异，
 *     由接线层（Task 11/12）按当前语境实例化好整个元素传进来，本组件只负责
 *     "这里有一个次要出口"这一个通用位置，不持有任何具体交互能力，也不需要
 *     跟着 `InquiryModal` 的 props 变化同步改自己的签名。省略该 prop 时次要
 *     按钮位整体不渲染，不伪造一个假交互占位符。
 *
 *     视觉处理选择「包裹 + 重置」而非「调用方自己按 40 高/#f5f5f7 拼样式」：
 *     `InquiryModal` 默认渲染的触发器是旧配色体系的 `.btn.btn--primary`
 *     （44 高、8px 圆角、`--color-copper` 底色——`--color-copper` 现在只是
 *     `--accent` 的别名，但形状/高度与列表页新体系的 40 高胶囊完全不同，见
 *     `styles.css` `.btn`/`.btn--primary` 定义）。让每个调用方都记得传对
 *     `triggerVariant`/`triggerClassName` 才能长成 comp 稿要求的样子，属于
 *     "调用方必须知道我们的视觉规格"——本组件改为把 `secondaryAction` 包进
 *     `.ls-empty__btn-slot`，用高特异度选择器（`.ls-empty .ls-empty__btn-slot
 *     > *`）把子元素强制重置成 40 高·`#f5f5f7`·胶囊，不管调用方传进来的是
 *     `InquiryModal` 的按钮、一个 `<Link>`，还是别的什么控件——插槽只负责
 *     "此刻是什么"，视觉规格仍然完全由本组件掌握（与 comp 一致，也是
 *     Task 6/8 一路延续的"视觉在组件里，数据/行为在调用方"分工）。
 *
 *   - `unfilteredTotalCount`：主按钮文案里的具体数字（comp 稿「看上海全部
 *     1,893 套在租」）。这不是当前（0 条）结果数，是 `basePath` 不叠加这一
 *     类限制时的总量——调用方需要另外查一次。与 `countNoun` 不同，这个数字
 *     缺失时组件仍然诚实（退化成不带数字的通用文案），因此是可选的，不是
 *     必填的："缺了会撒谎" vs "缺了只是少一个加分数字"是两种不同的缺省
 *     处置，不能用同一个"必填"标准套。数字 >0 时才使用带数字的文案（批次
 *     统一的"不显示 0"规则），且用 `tabular-nums` 渲染。
 *
 * **Task 11/12 接线时必须实际传入这两个 prop**，否则会退回到本组件首版
 * 「次按钮回首页、主按钮不带数字」这个更弱的行为——两个 prop 的语义与命名
 * 已经在上面写清楚，接线 brief 应直接引用 `secondaryAction` / `unfilteredTotalCount`
 * 这两个名字。
 */
export default function EmptyNoStock(props: Readonly<{
  noun: string
  /**
   * 主按钮里 `unfilteredTotalCount` 后面跟的量词短语，如「套在租房源」/
   * 「套出售房源」。必填、无默认值：与 `FilterFormC.countNoun` 同一约定——
   * 首版把「套在租房源」硬编码在 JSX 里，出售频道复用同一个组件时就会说出
   * 「查看全部 128 套在租房源」这种错语境的话（Task 11 接线时发现）。
   * 调用方应从 `CHANNEL_COPY` 一类的集中文案表取值，不要写字面量。
   */
  totalNoun: string
  basePath: string
  /**
   * `basePath`（不叠加这一类限制的完整结果集）里的房源总数，用于主按钮文案
   * 里的具体数字（comp 稿字面「看上海全部 1,893 套在租」）。可选：省略或
   * 传 0 时按钮退化为不带数字的通用文案，仍然真实，不是必须补全的信息。
   */
  unfilteredTotalCount?: number
  /**
   * 次要出口插槽，由接线层传入已实例化的交互元素（如
   * `<InquiryModal pageType="search" triggerLabel="提交需求" triggerVariant="primary" />`，
   * 见 `CityListingsView.tsx` 现有空态用法）。省略则不渲染次要按钮位。
   * 本组件把它包进 `.ls-empty__btn-slot` 并重置视觉为 40 高·`#f5f5f7`·胶囊
   * ——调用方不需要关心也不应该覆盖这套视觉规格，只需要提供"点了之后发生
   * 什么"。
   */
  secondaryAction?: React.ReactNode
}>): React.JSX.Element {
  const { noun, totalNoun, basePath, unfilteredTotalCount, secondaryAction } = props
  const hasCount = unfilteredTotalCount != null && unfilteredTotalCount > 0

  return (
    <div className="ls-empty ls-empty--nostock">
      <span className="ls-empty__title">{noun}还在收录中</span>
      <span className="ls-empty__body">
        这不是筛选收得太严——这一类目前确实还没有一套上架，不是被藏起来的空货架。
        我们持续核对新增供给，一上架就会显示在这里。
      </span>
      <span className="ls-empty__actions">
        {/* 文案整段包一层 <span>，不要把文本直接摊平进 flex 容器（`.ls-empty__btn`
            是 inline-flex）：flex 容器会把每个连续文本片段各自拆成独立的匿名
            flex item，item 边界处的空白会被当成"行首/行尾"折叠掉——"查看全部"
            与数字、数字与"套在租房源"之间的空格会直接消失（实测过，Playwright
            innerText 甚至把它们渲成三个换行分隔的块）。包一层 span 后整段文案
            只是这一个 flex item 内部的正常行内流，空格按普通文本规则保留。 */}
        <Link href={basePath} className="ls-empty__btn ls-empty__btn--primary">
          <span>
            {hasCount ? (
              <>
                查看全部 <span className="ls-empty__btn-count">{unfilteredTotalCount}</span> {totalNoun}
              </>
            ) : (
              '查看全部结果'
            )}
          </span>
        </Link>
        {secondaryAction ? <span className="ls-empty__btn-slot">{secondaryAction}</span> : null}
      </span>
    </div>
  )
}
