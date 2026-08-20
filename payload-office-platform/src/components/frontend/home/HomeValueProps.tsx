import React from 'react'

/**
 * OPT-035「为什么选择我们」纯静态白底带（.hm-band .hm-values）。
 * 文案照设计稿锁定稿（docs/SBH设计任务讨论/首页.dc.html 的 values 数组）逐字抄录。
 */
const VALUES = [
  { no: '01', name: '真房源实地核验', body: '每套房源由本地顾问到场量房拍照，面积与层高逐条核过，下架即时同步。' },
  { no: '02', name: '免费选址顾问', body: '按预算、通勤、注册要求给出可比清单，不收企业端服务费。' },
  { no: '03', name: '全程租约护航', body: '合同条款、免租期、押付方式与交付标准全程跟进到入驻。' },
] as const

export default function HomeValueProps() {
  return (
    <section className="hm-band hm-values" aria-labelledby="hm-values-title">
      <div className="hm-container">
        <h2 className="hm-h2" id="hm-values-title">为什么选择我们</h2>
        <div className="hm-values__grid">
          {VALUES.map((v) => (
            <div className="hm-value hm-rise" key={v.no}>
              <span className="hm-value__no hm-num">{v.no}</span>
              <h3 className="hm-value__name">{v.name}</h3>
              <p className="hm-value__body">{v.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
