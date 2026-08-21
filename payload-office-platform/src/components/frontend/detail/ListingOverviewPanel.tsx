import React from 'react'
import DetailPanel from './DetailPanel'
import SpecTable, { type SpecRow } from './SpecTable'
import type { FactGroupViewModel, FactValue, ListingDetailViewModel } from '@/domain/public-catalog'
import { formatAvailableDate } from '@/lib/frontend/format'

/**
 * 房源概况面板 —— 通栏，取代原稿「房源概况 / 租金账」双 tab。
 *
 * 产品裁定（2026-08-21，见 progress.md）：租金账已取消（量纲不可通约，见工作项
 * §2.3），概况不再需要 tab 容器——只剩一个选项的 tab 是点了没反应的死控件，
 * 本批硬约束明令禁止，故本组件直接以 `DetailPanel variant="full"` 承载四组
 * `SpecTable`，组与组只用间距（40px）+ 组标签区分，不用顶线不用色块。
 *
 * 字段来源与 comp（`房源详情.dc.html` factGroups`）对照——逐项在
 * `ListingDetailViewModel` 上核实可达，不可达时**省略该行**（结构性缺口，
 * 与「行存在但这套房源该值为 null」不是一回事，后者才交给 SpecTable 渲染
 * `—`）。省略前必须分清两种「不可达」：
 *
 *   - 「域层没有」= collection 上根本没有这个字段（没有数据来源，补映射也
 *     补不出来）——这类才真的省略该行；
 *   - 「DTO 没有」= 字段在 Buildings/Listings collection 上明明存在，只是还
 *     没被映射到 DTO 上——这是映射缺口不是数据缺口，缺口能以一次低成本映射
 *     补齐时应该补齐，不该设计成看不见（review 修正，见下方「空调/网络/
 *     停车费」）。
 *
 *   面积与格局：建筑面积 / 套内参考面积 / 得房率 / 净层高 / 工位估算 全部可达，
 *     直接复用 `mapListingFactGroups` 已产出的 `listing.factGroups` 扁平事实
 *     （值已拼好单位后缀，如 "1,240 ㎡"——与本面板「单位嵌在值串里」的行型
 *     一致，故不重新格式化，避免同一套后缀拼接逻辑出现第二处）。
 *     comp 的「开间 × 进深」在 Listings collection 无对应字段（域层没有），省略。
 *
 *   租赁条件：合同单价（listing.price.text）/ 起租期（复用既有「最短租期」，
 *     comp 用「年」我们只有「月」精度，同一概念不同粒度）/ 押金（复用既有
 *     「押金月数」）全部可达。comp 的「押付方式」是"押二付三"这类含支付
 *     周期的复合约定，付款周期字段不存在，只能呈现押金一半——**这是诚实降级
 *     不是编造**：字段改标签为「押金」而非硬凑成「押付方式」。「免租期」
 *     「年递增」「中介费」在 Listings collection 均无对应字段（域层没有），省略。
 *
 *   交付与资质：装修状态 / 交付时间（复用 `formatAvailableDate`，缺失既有
 *     "面议" 语义，不改用本面板的 "—"——同一字段站内其它位置早已是这个
 *     兜底文案，CityListingDetailView.tsx:87 同款先例）/ 可注册 全部可达。
 *     「空调」「网络」在 `Buildings.buildingServices.{airConditioning,network}`
 *     上本就存在（域层有），此前误判为 DTO 未暴露就省略——已在
 *     `BuildingSummaryViewModel` 补映射（`mappers.ts` `mapBuildingSummary`），
 *     取自 `listing.building.{airConditioning,network}`，与楼盘详情页「楼宇
 *     服务」读同一个来源字段，两页不会各读一份互相矛盾。「消防验收」在
 *     Listings/Buildings 均无对应字段（域层没有），省略。
 *
 *   费用明细：物业费（优先取金额事实「物业费金额」，两者都缺时退回类别事实
 *     「物业费」如"包含/不包含"——同一个真实世界属性的两种既有记录方式，
 *     非另起判断）/ 停车费（同「空调/网络」，补映射自
 *     `listing.building.parkingFee`）/ 发票（复用既有「发票」，comp 叫
 *     「税费」但我们只有发票口径的枚举，非"专票 9%"这类税率字符串，保留
 *     既有更准确的标签）可达。「车位配比」是需要额外计算的楼宇属性（现存
 *     字段只有车位总数没有配比，且仍是楼宇级），「电费」「网络费」在
 *     Listings/Buildings 均无对应字段（域层没有），三项省略。
 *
 * 详见 task-3-report.md 的逐字段核查表与「域层没有 / DTO 没有」的区分记录。
 */

type ListingOverviewInput = Pick<ListingDetailViewModel, 'factGroups' | 'price' | 'availableFrom' | 'building'>

export type ListingOverviewGroup = Readonly<{
  id: string
  title: string
  rows: readonly SpecRow[]
}>

function findFact(groups: readonly FactGroupViewModel[], label: string): FactValue | undefined {
  for (const group of groups) {
    const found = group.facts.find((item) => item.label === label)
    if (found) return found
  }
  return undefined
}

/**
 * `listing.factGroups` 的事实值已拼好单位后缀；`estimated` 时附加既有
 * "（估算）" 后缀（与 `DetailFacts.tsx` 的 `detail-facts__estimated` 同一
 * 约定，只是本面板把它折进字符串而非单独一个 span——`SpecTable.value` 是
 * 不透明字符串，两种呈现方式表达的是同一件事，不算另起一套判断）。
 */
function factValue(fact: FactValue | undefined): string | null {
  if (!fact || fact.value == null) return null
  return fact.estimated ? `${fact.value}（估算）` : fact.value
}

export function buildListingOverviewGroups(
  listing: ListingOverviewInput,
): readonly ListingOverviewGroup[] {
  const fact = (label: string) => factValue(findFact(listing.factGroups, label))
  const propertyFeeAmount = factValue(findFact(listing.factGroups, '物业费金额'))
  const propertyFeeInclusion = factValue(findFact(listing.factGroups, '物业费'))

  return [
    {
      id: 'space',
      title: '面积与格局',
      rows: [
        { label: '建筑面积', value: fact('建筑面积') },
        { label: '套内参考面积', value: fact('套内参考面积') },
        { label: '得房率', value: fact('得房率') },
        { label: '净层高', value: fact('净层高') },
        { label: '工位估算', value: fact('工位数') },
      ],
    },
    {
      id: 'terms',
      title: '租赁条件',
      rows: [
        { label: '合同单价', value: listing.price?.text ?? null },
        { label: '起租期', value: fact('最短租期') },
        { label: '押金', value: fact('押金月数') },
      ],
    },
    {
      id: 'delivery',
      title: '交付与资质',
      rows: [
        { label: '装修状态', value: fact('装修') },
        { label: '交付时间', value: formatAvailableDate(listing.availableFrom) },
        { label: '可注册', value: fact('注册') },
        { label: '空调', value: listing.building?.airConditioning ?? null },
        { label: '网络', value: listing.building?.network ?? null },
      ],
    },
    {
      id: 'cost',
      title: '费用明细',
      rows: [
        { label: '物业费', value: propertyFeeAmount ?? propertyFeeInclusion },
        { label: '停车费', value: listing.building?.parkingFee ?? null },
        { label: '发票', value: fact('发票') },
      ],
    },
  ]
}

/**
 * 整组字段全缺时依然渲染该组（含组标签）——与行级「不隐藏」同一判断逻辑，
 * 不为「组」另开一套隐藏规则。本面板的分组本身是代码时依据字段可达性定好的
 * 固定行清单（见上方逐组注释），不随某一套房源的数据完整度变化；至于某套
 * 房源恰好这组全部字段都是 null，那和单行值缺失是同一件事——渲染出来的
 * 「—」本身就是信息（这套房源在这个维度上确实没有可核实的数据），不是噪音。
 */
export default function ListingOverviewPanel({
  listing,
}: Readonly<{ listing: ListingOverviewInput }>) {
  const groups = buildListingOverviewGroups(listing)
  return (
    <DetailPanel variant="full" className="dt-overview">
      {groups.map((group) => (
        <div key={group.id} className="dt-overview__group">
          <span className="dt-overview__group-title">{group.title}</span>
          <SpecTable rows={group.rows} />
        </div>
      ))}
    </DetailPanel>
  )
}
