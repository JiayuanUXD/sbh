import React from 'react'

export type SpecRow = Readonly<{
  label: string
  /** null 渲染为 —（缺失本身是信息，不隐藏该行——见下方组件注释） */
  value: string | null
  unit?: string
}>

/**
 * 详情页规格表 —— 两列键值行，右列右对齐 + tabular-nums + 500。
 *
 * 设计依据：docs/SBH设计任务讨论/{房源详情,楼盘详情}.dc.html specRows「概况行」：
 * min-height 44 · 键 15/400/ink-2 · 值 15/500/ink；行线 1px，末行无线。
 *
 * `value: null` 必须渲染为 `—` 且**保留该行**，不能因为值缺失就把整行从列表
 * 里过滤掉——一个规格维度不存在于数据里，和"这套房源在该维度上没有值"是两
 * 件不同的事，前者是数据问题，后者是这套房源本身的属性（例如"车位数：—"
 * 明确告诉用户这套房源没有可确认的车位信息，而不是让页面对该维度保持沉默、
 * 让用户误以为"没提所以是有的"或"没提这个维度不存在"）。调用方如果确实要
 * 隐藏某个维度，应该在传入 rows 之前自己过滤，而不是依赖本组件对 null 做
 * 隐藏——那样每个消费方都要重新决定一次「隐藏」的语义，行为就会在页面之间
 * 漂移。
 */
export default function SpecTable({ rows }: Readonly<{ rows: readonly SpecRow[] }>) {
  return (
    <div className="dt-spec">
      {rows.map((row, index) => (
        <div key={`${index}-${row.label}`} className="dt-spec__row">
          <span className="dt-spec__label">{row.label}</span>
          <span className="dt-spec__value">
            {row.value ?? '—'}
            {row.value != null && row.unit ? <span className="dt-spec__unit">{row.unit}</span> : null}
          </span>
        </div>
      ))}
    </div>
  )
}
