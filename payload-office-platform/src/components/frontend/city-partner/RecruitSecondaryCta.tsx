import React from 'react'

/**
 * OPT-038 城市招募页 · 次要入口（Task 5）
 *
 * 设计依据：docs/SBH设计任务讨论/城市招募页.dc.html:224-236 与末尾 specRows
 *   - 整段是**上一段的尾注**：`padding-top: 0`，与商圈段的间距 = 1×--pad 而非 2×--pad
 *     （骨架里的 `.rc-section--tail`，Task 1 已落地）
 *   - 卡：稿子 `--bg-subtle`（= 灰，本项目是 `--bg`，**按颜色映射**见 recruit.css 文件头）
 *     · radius 18 · padding 40/48 · 左右两栏 space-between · gap 48
 *   - 标题 24/600/1.2 · 说明 17/1.47 --ink-2 · 卡内两行 gap 6
 *   - 右侧次级按钮：specRows「次级按钮 pill · padding 11/21 · 1px line-strong」
 *     → 形状收敛在 `.rc-secondary-btn`（见 recruit.css），**颜色不收敛**（见下）
 *
 * ── Server Component ──────────────────────────────────────────────────────
 * 无 'use client'、无 hook、不读 Payload。`action` 是插槽而不是内建按钮：
 * 两个消费面给的东西根本不同——城市路由给的是 `InquiryModal`（client 组件 +
 * `trackCta` 埋点）与 `next/link`，`/city-partner` 给的是 `InquiryModal`。
 * 把按钮内建进来就要把 `InquiryModal` 的十几个 prop 与埋点回调一路透传，
 * 等于在这里复制一份调用方的职责。
 *
 * ── 为什么是 entries[] 而不是稿子里的单张卡 ───────────────────────────────
 * 稿子只画了一张（租客入口）。城市路由**现在**有两个真实入口：租客
 * （`ComingSoonCityView` 的 `__tenant-note` 与 `__action-panel--tenant`）与业主
 * （`__action-panel--landlord` → `/publish?city=`）。改版若只保留稿子那一张，
 * 业主入口会连同旧版式一起消失——那是**删功能**，不是改版式。
 * 所以这里收成一个列表：`/city-partner` 传 1 条（与稿子逐项相同），
 * 城市路由传 2 条。两条时靠 `.rc-cta-list` 的 row-gap 排列，卡本身参数不变。
 *
 * ── 标题用 h2 ─────────────────────────────────────────────────────────────
 * 本段在两个消费面上都排在 h1（RecruitHero）之下，与价值点 / 商圈 h2 同级。
 * 稿子那里是个无语义的 `<span>`；给它 h2 是补语义，不是升级视觉档位
 * （字号仍是稿子的 24，不是 `.hm-h2` 的 40）。
 * ⚠️ 不能是 h1：`tests/city-partner-page-seo.test.ts:37` 与
 * `tests/e2e/city-partner-flow.spec.ts:31` 双锁「h1 恰好 1 个」。
 *
 * ── 没有新增任何 live region ──────────────────────────────────────────────
 * `tests/e2e/city-partner-flow.spec.ts` 用 `getByRole('status')` 定位表单反馈，
 * 且当前**页面上唯一**。本组件零 `role="status"` / `aria-live`。
 * （`InquiryModal` 自带的 `role="status"` 在弹层里，只有 `open` 时才 createPortal
 * 渲染，e2e 从不打开它，不构成 strict violation。）
 */

export type RecruitSecondaryEntry = Readonly<{
  /** 卡标题（h2）。 */
  title: string
  /** 一句话说明。 */
  body: string
  /** 右侧动作插槽：`InquiryModal` 触发钮 / `next/link`。 */
  action: React.ReactNode
}>

type RecruitSecondaryCtaProps = Readonly<{
  /** 入口卡列表。空数组且无 footer 时整段不渲染。 */
  entries: readonly RecruitSecondaryEntry[]
  /** section 的 `aria-label`（本段没有单一标题可指，故用 label 而非 labelledby）。 */
  label?: string
  /** 卡片下方的附加内容（城市路由用它放辅助跳转链接）。 */
  footer?: React.ReactNode
}>

export default function RecruitSecondaryCta({
  entries,
  label,
  footer,
}: RecruitSecondaryCtaProps) {
  // 空态整段不渲染：没有入口时留一条空的尾注带只是多一段留白。
  if (entries.length === 0 && !footer) return null

  return (
    <section className="rc-section rc-section--tail" {...(label ? { 'aria-label': label } : {})}>
      <div className="rc-container rc-tail">
        {entries.length > 0 ? (
          <ul className="rc-cta-list">
            {entries.map((entry) => (
              <li className="rc-cta" key={entry.title}>
                <div className="rc-cta__copy">
                  <h2 className="rc-cta__title">{entry.title}</h2>
                  <p className="rc-cta__body">{entry.body}</p>
                </div>
                <div className="rc-cta__action">{entry.action}</div>
              </li>
            ))}
          </ul>
        ) : null}
        {footer}
      </div>
    </section>
  )
}
