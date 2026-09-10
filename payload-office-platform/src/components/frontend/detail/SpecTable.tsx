import React from 'react'

export type SpecRow = Readonly<{
  label: string
  /**
   * null 渲染为 `—`。**但正常链路上不会有 null 进来**——OPT-083 起，缺值的行在
   * 上游（registry 消费函数）就被滤掉了，见下方组件注释。这里保留 null 分支是
   * 防御性的：dev-story 演示页与手写夹具仍可能直接传 null。
   */
  value: string | null
  unit?: string
}>

/**
 * 详情页规格表 —— 两列键值行，右列右对齐 + tabular-nums + 500。
 *
 * 设计依据：docs/SBH设计任务讨论/{房源详情,楼盘详情}.dc.html specRows「概况行」：
 * min-height 44 · 键 15/400/ink-2 · 值 15/500/ink；行线 1px，末行无线。
 *
 * ## 「缺值怎么办」的规则不在本组件里（OPT-083 起）
 *
 * 本组件只负责**给什么渲什么**：拿到几行就渲几行，`value: null` 渲染 `—`。
 * 「哪些行该出现」的判断全部上移到了 `src/lib/frontend/detail-spec/` 的 registry
 * 消费函数（`buildBuildingSpecGroupsFromRegistry` / `buildListingOverviewGroupsFromRegistry`），
 * 它们会先按运营配置滤掉未勾选的、再滤掉没值的，最后连空组一起收起。
 *
 * ### 这条规则被**刻意反转**过，别照旧注释「修」回来
 *
 * 改造前这里写着「`value: null` 必须渲染 `—` 且保留该行」，理由是：隐藏一个维度
 * 等于暗示它不存在，而"车位数：—"明确告诉用户这套房源没有可确认的车位信息。
 * **那条理由针对的是数据缺失**，它本身没有错。
 *
 * OPT-083 引入的是另一件事——**运营的编辑决策**：全站范围内决定不披露某个维度。
 * 产品裁定把两种「不显示」统一成了同一种呈现（没值就不显这行），已知代价
 * （「未勾选」与「没值」在前台不可区分、「资料不全」的信号被弱化）记录在
 * `specs/work-items/OPT-083-detail-spec-field-visibility.md` §11，是被接受的取舍，
 * 不是漏考虑。要改回去请先读那份规格，并把
 * `tests/opt083-detail-spec-hiding.test.ts` 一起改——不要只看这段注释。
 */
export default function SpecTable({ rows }: Readonly<{ rows: readonly SpecRow[] }>) {
  return (
    <div className="dt-spec">
      {rows.map((row, index) => (
        <div key={`${index}-${row.label}`} className="dt-spec__row">
          <span className="dt-spec__label">{row.label}</span>
          {/* `sf-num`：全站数字基元（surface.css `.sf-num`）——"数字一律 tabular-nums"
              这条约束此前靠 detail.css 里 9 处内联复制守住，本批收敛到基元。 */}
          <span className="sf-num dt-spec__value">
            {row.value ?? '—'}
            {row.value != null && row.unit ? <span className="dt-spec__unit">{row.unit}</span> : null}
          </span>
        </div>
      ))}
    </div>
  )
}
