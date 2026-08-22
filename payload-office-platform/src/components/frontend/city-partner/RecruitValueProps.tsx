import React from 'react'

/**
 * OPT-038 城市招募页 · 价值点主栏（Task 3）
 *
 * 设计依据：docs/SBH设计任务讨论/城市招募页.dc.html:80-91（方案 A 左栏）与末尾 specRows
 *   - 主栏宽 552（= 1024 − 400 − 72，**推导值**，由 `.rc-core` 的 minmax(0,1fr) 算出，
 *     不在任何地方写成常量，见 recruit.css `.rc-page` 一段）
 *   - h2 40 / 600 / 1.10；h2 → 列表 48；条与条 40
 *   - 每条：序号 14/600 --ink-3（tabular-nums）· 名 24/600/1.2 · 正文 17/1.47 --ink-2
 *   - 条顶 1px --line hairline
 * 样式全部在 styles/recruit.css 的 `.rc-vp*`，本文件不带任何内联样式。
 *
 * ── Server Component ──────────────────────────────────────────────────────
 * 无 'use client'、无 hook、不读 Payload。与 RecruitHero 同形：两个消费面
 * （`/city-partner` 与 `/[city]`）共用，差异由 props 承载，Task 5 接线。
 *
 * ── 只渲染左栏本身，不渲染 `.rc-section` / `.rc-core` ─────────────────────
 * 与 RecruitHero 的差别：Hero 独占一整条背景带，所以它自带 `.rc-section`；
 * 价值点与表单卡**共用同一条灰底带**（稿子:76），带与两栏栅格必须由接线方
 * （Task 5）提供，否则同一条 section 会被渲染两次、背景带断成两截。
 */

export type RecruitValuePoint = Readonly<{
  /** 价值点标题。 */
  name: string
  /** 一句话说明。 */
  body: string
}>

/** 主栏 h2 默认文案（稿子:81）。 */
export const RECRUIT_VALUE_PROPS_TITLE = '我们带给合伙人什么'

/**
 * 三条价值点的默认文案（稿子 renderVals().points，:365-369）。
 *
 * 放常量而不是各消费面各抄一份：`ComingSoonCityView.tsx:83-125` 现在把同样三条
 * 硬编码在 JSX 里（外加城市名插值），Task 5 接线后那三块要被本组件取代——
 * 若届时再抄一遍文案，同一段市场承诺就有了两个事实源。
 *
 * ⚠️ 序号（01/02/03）**不进这个常量**：它由数组下标推导（见下方 formatOrdinal）。
 * 把 '01' 写进数据，等于允许「第 2 条标着 01」这种下标与序号对不上的谎——
 * 与 Task 2 去掉「第 N 城」是同一条纪律：能推导的序数不留手写落点。
 */
export const RECRUIT_VALUE_POINTS: readonly RecruitValuePoint[] = [
  { name: '全国跨城企业客源精准导入', body: '承接来自上海及全国总部的外溢选址需求' },
  { name: '全流程数字化商办 SaaS 赋能', body: '房源可视化营销工具与线索流转系统' },
  { name: '高佣金分成与区域独占支持', body: '开放利润分成机制与核心商圈独家 / 优先合作席位' },
]

/** 01 / 02 / … —— 由下标推导，两位补零对齐（配合 .sf-num 的 tabular-nums 列宽才等宽）。 */
function formatOrdinal(index: number): string {
  return String(index + 1).padStart(2, '0')
}

type RecruitValuePropsProps = Readonly<{
  /** 主栏标题；默认见 RECRUIT_VALUE_PROPS_TITLE。 */
  title?: string
  /** 价值点列表；默认见 RECRUIT_VALUE_POINTS。传空数组则整段不渲染。 */
  points?: readonly RecruitValuePoint[]
  /** h2 的 id，供外层 `aria-labelledby` 指向；不传则不加 id。 */
  titleId?: string
}>

export default function RecruitValueProps({
  title = RECRUIT_VALUE_PROPS_TITLE,
  points = RECRUIT_VALUE_POINTS,
  titleId,
}: RecruitValuePropsProps) {
  // 空态整段不渲染：没有价值点时留一个只剩标题的空货架，比不渲染更糟。
  // （这里没有「诚实空态」可言——价值点不是查询结果，无从给出下一步动作。）
  if (points.length === 0) return null

  return (
    <div className="rc-vp">
      {/* h2 挂 `.hm-h2`（home.css:26）而不是本页自建类：稿子的 40/600/1.10 与
          首页 section 标题逐项同值，且那边已经带了 ≤767 收到 32 的移动档。
          `hm-` 前缀是已知的命名瑕疵（一个全站基元住在首页样式文件里），
          理由与后续处置写在 recruit.css 的「价值点主栏」小节。 */}
      <h2 className="hm-h2" {...(titleId ? { id: titleId } : {})}>
        {title}
      </h2>
      <ol className="rc-vp__list">
        {points.map((point, index) => (
          <li className="rc-vp__item" key={point.name}>
            {/* 序号用 aria-hidden：它是 <ol> 已经表达过的顺序的视觉重复，
                读屏再念一遍「零一」是噪音。语义顺序由 ol/li 承载。 */}
            <span className="rc-vp__no sf-num" aria-hidden="true">{formatOrdinal(index)}</span>
            <span className="rc-vp__name">{point.name}</span>
            <span className="rc-vp__body">{point.body}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
