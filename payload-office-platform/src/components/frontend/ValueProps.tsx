import React from 'react'

/**
 * 首页「价值主张」带：01/02/03 编号列表
 *
 * 设计依据：plans/temporal-imagining-sonnet.md §9（信任带，编辑式序号）
 * 守护不变量：
 *   - 纯静态、服务端组件；
 *   - 只用设计 token；深色 ink 底 + on-ink 文字，与 hero 形成节奏对比；
 *   - 编号用 numeric 字体，标题用 display 字体。
 */
type ValueProp = Readonly<{
  no: string
  title: string
  desc: string
}>

const PROPS: readonly ValueProp[] = [
  { no: '01', title: '真房源 · 实地核验', desc: '每套房源经顾问实地踏勘与有效性校验，价格、面积、状态与签约口径一致。' },
  { no: '02', title: '免费 1 对 1 选址顾问', desc: '资深顾问按预算、地铁、扩张计划匹配方案，全程不向租客收取任何费用。' },
  { no: '03', title: '全程租约护航', desc: '从看房、谈判到签约入驻，合同条款逐条解读，规避免租期与递增陷阱。' },
]

export default function ValueProps() {
  return (
    <section className="value-band" aria-labelledby="value-band-title">
      <div className="value-band__inner">
        <h2 className="value-band__title" id="value-band-title">为什么选择我们</h2>
        <ol className="value-band__list" role="list">
          {PROPS.map((p) => (
            <li key={p.no} className="value-band__item">
              <span className="value-band__no">{p.no}</span>
              <span className="value-band__body">
                <span className="value-band__name">{p.title}</span>
                <span className="value-band__desc">{p.desc}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
