import React from 'react'

/**
 * OPT-035「为什么选择我们」白底带（.hm-band .hm-values）。
 *
 * OPT-053：文案改由「站点设置 → 首页区块」配置，默认值仍是设计稿锁定稿的三条。
 * 序号（01/02/03）**按顺序自动生成**，不进配置——让运营手填只会出现跳号与重号，
 * 而它本来就只是位置的表示。
 */
export default function HomeValueProps({ items }: Readonly<{
  items: readonly Readonly<{ name: string; body: string }>[]
}>) {
  return (
    <section className="hm-band hm-values" aria-labelledby="hm-values-title">
      <div className="hm-container">
        <h2 className="hm-h2" id="hm-values-title">为什么选择我们</h2>
        <div className="hm-values__grid">
          {items.map((v, index) => (
            <div className="hm-value hm-rise hm-rise--slow" key={`${index}-${v.name}`}>
              <span className="hm-value__no sf-num">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="hm-value__name">{v.name}</h3>
              <p className="hm-value__body">{v.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
