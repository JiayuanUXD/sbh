import React from 'react'
import DetailPanel from './DetailPanel'
import { factValue, findFact } from './fact-lookup'
import SpecTable, { type SpecRow } from './SpecTable'
import type { ListingDetailViewModel } from '@/domain/public-catalog'
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
 *     「押金月数」）/ 付款方式（复用既有「付款方式」，源自 `Listings.paymentTerms`，
 *     `mappers.ts:687` 早已 `fact('付款方式', listing.paymentTerms)` 映射进
 *     `listing.factGroups` 的 cost 组、与「押金月数」相邻）全部可达。
 *
 *     Review 修正：comp 的「押付方式」是"押二付三"这类"押金月数 + 付款周期"的
 *     复合约定。首版审计止步于「没有付款周期字段」就把这行改标签成「押金」，
 *     但 `paymentTerms` 就是那半个周期字段，本组件早就收着这个事实，只是
 *     没有查——这不是诚实降级，是漏查。现按「押金」「付款方式」**两行独立
 *     呈现**，不合并硬拼成 comp 的"押二付三"字面格式（`depositMonths` 是数字、
 *     `paymentTerms` 是自由文本，格式不保证能拼出"押二付三"这种简写，拼错比
 *     分两行说清楚更糟）。「免租期」「年递增」「中介费」在 Listings collection
 *     均无对应字段（域层没有），省略——这三项已按「先查 listing.factGroups
 *     现有事实清单，查不到再下探 collection」的顺序复核，确认不是第二次漏查。
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
 *
 * ---
 *
 * **「comp 之外的 5 条」——终审修复补回（2026-08-22）**
 *
 * `房源楼层 / 朝向 / 可分割 / 家具 / 其他固定费用` 这 5 条 comp 的 factGroups 没列，
 * 但 `mapListingFactGroups`（mappers.ts:661,662,664,676,718）一直在产出、改版前的
 * `DetailFacts`（全量事实清单）一直在房源详情页展示，全仓 grep 确认它们在本页
 * **再无第二处出处**。首版把这 5 条记成「设计取舍」，理由是「概况面板是按 comp
 * 逐字段核过的固定行清单」——但那条理由回答的是「comp 没列的要不要**补映射**」，
 * 回答不了「域层已有、旧页面已展示的要不要**保留**」。同一批次的 Task 10 在楼盘页
 * 遇到完全同型的情况（`DetailFacts → BuildingSpecPanel` 丢 6 条）判定为「接线造成
 * 的静默内容删除」，补回并加了守卫与专门测试；两页两套判据不成立，按楼盘页先例
 * 统一：**它们在组件手里的 DTO 里就有，属本文件三层判定的第 1 层「已在手」，
 * 不是可省略项。**
 *
 * 逐条理由（不用「设计取舍」这种无判据的说法）：
 *   - `房源楼层`：低区/高区直接决定采光、电梯等待与价格档位，是选址的一级判据；
 *     供给密度表的副行都在展示它（`BuildingSupplyBrowser` 的 `sub`），详情页反而
 *     没有，同一事实在列表页有、点进去没有。
 *   - `其他固定费用`：**费用披露**。删掉一条费用条款与删掉一条装修状态不是一个
 *     量级——它是用户签约前必须知道、且事后才发现会构成纠纷的那类信息。
 *   - `朝向`：与楼层同类的空间事实，商办选址里直接关联采光与工位排布。
 *   - `可分割`：决定「这套能不能只租一半」，是租赁可行性判据，不是装饰性属性。
 *   - `家具`：与「装修状态」并列的交付口径（带家具 / 无家具直接换算成入驻成本），
 *     两者同源于 `spaceDetails`，只展示其一才是随意的那一半。
 * 归组按现有四组就近安放（前三条进「面积与格局」、家具进「交付与资质」、其他固定
 * 费用进「费用明细」），不新增组、不改版式。
 * `tests/listing-overview-panel.test.ts` 有一条专门守卫这 5 条的用例，任何
 * 「按 comp 收敛概况面板」的后续清理会先撞到那条用例，而不是撞到用户。
 */

type ListingOverviewInput = Pick<ListingDetailViewModel, 'factGroups' | 'price' | 'availableFrom' | 'building'>

export type ListingOverviewGroup = Readonly<{
  id: string
  title: string
  rows: readonly SpecRow[]
}>

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
        // 以下 3 条见文件头「comp 之外的 5 条」：域层已产出、旧 DetailFacts 一直
        // 在展示，不补回就是接线造成的静默内容删除。
        { label: '房源楼层', value: fact('房源楼层') },
        { label: '朝向', value: fact('朝向') },
        { label: '可分割', value: fact('可分割') },
      ],
    },
    {
      id: 'terms',
      title: '租赁条件',
      rows: [
        { label: '合同单价', value: listing.price?.text ?? null },
        { label: '起租期', value: fact('最短租期') },
        { label: '押金', value: fact('押金月数') },
        { label: '付款方式', value: fact('付款方式') },
      ],
    },
    {
      id: 'delivery',
      title: '交付与资质',
      rows: [
        { label: '装修状态', value: fact('装修') },
        // 与「装修状态」同源于 spaceDetails、同属交付口径，见文件头。
        { label: '家具', value: fact('家具') },
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
        // 费用披露，见文件头：删一条费用条款与删一条装修状态不是一个量级。
        { label: '其他固定费用', value: fact('其他固定费用') },
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
          <span className="dt-group-title">{group.title}</span>
          <SpecTable rows={group.rows} />
        </div>
      ))}
    </DetailPanel>
  )
}
