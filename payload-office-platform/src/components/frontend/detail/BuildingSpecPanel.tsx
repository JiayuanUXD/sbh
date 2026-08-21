import React from 'react'
import DetailPanel from './DetailPanel'
import { factValue, findFact, formatCompletionYear } from './fact-lookup'
import SpecTable, { type SpecRow } from './SpecTable'
import type { AmenityGroupViewModel, FactGroupViewModel } from '@/domain/public-catalog'

/**
 * 楼盘参数面板（OPT-037 Task 6）—— 通栏，对应 comp「楼盘参数（完整）」，
 * 2 列 gap 40/72，每列内部仍是 `SpecTable` 的行结构（不另写一套行）。
 *
 * 字段可达性判定——comp 列了 24 项（4 组 × 6），按硬约束的三层判定顺序
 * （先查组件手里已有的 DTO 事实 → 再查有没有低成本映射缺口 → 最后才查
 * collection 决定省略）逐项核实，结论写在下面每组注释里，避免后来者
 * 凭直觉「恢复」已经确认拿不到的字段：
 *
 *   - 「已在手」：`building.factGroups`（`mapBuildingFactGroups` 已产出，
 *     本面板与楼盘详情页现有「楼盘参数」区读的是同一份事实，不另开一份）
 *     直接覆盖 17/24 项，含两处「两个既有字段拼一行」（层高/净高、客梯/
 *     货梯——comp 原稿就是这么画的合并行，两个字段都是普通数字+单位，
 *     不是"押二付三"那种需要语义拼接的复合值，拼接风险与 Task 3 的
 *     押金/付款方式不是一回事）。
 *   - 「可推导，非编造」：「最小可租面积」来自调用方传入的 `minLeasableArea`
 *     （取自 `BuildingSupplySnapshot` 的 `aggregateAreaRange`，与
 *     `HeroSummaryPanel` 「可租面积」统计同一来源，不是另算一份；无有效
 *     供给时 `aggregateAreaRange` 返回 `null`，不是 `0` 也不是 `Infinity`，
 *     该行照实渲染 —）。
 *   - 「域层没有，省略」：电梯速度、楼板承重、车位配比（与 Task 3 「需要
 *     额外计算的楼宇属性」同一结论，非重复踩坑）、空调加时费、出租率、
 *     主要租户行业——`Buildings` collection 逐项确认无对应字段。
 *   - 「域层有一部分，无法达到 comp 精度，取可靠的那部分」：comp「地上 /
 *     地下」需要楼层拆分，`Buildings.totalFloors` 只有合计楼层，没有地上
 *     地下拆分字段——不拼一个假拆分，改用可达的「总楼层」（与
 *     `HeroSummaryPanel.HERO_FACT_LABELS` 的既有标签一致）。
 *   - 「最短租期」：comp 期望楼盘级最短租期，但 `BuildingSupplyGroupViewModel
 *     .listings` 是 `ListingCardViewModel`，该 DTO 本身不携带
 *     `minimumLeaseMonths`（只有 `ListingDetailViewModel.factGroups` 单套
 *     详情才有）——要在楼盘级聚合它需要新增跨房源的聚合管道，超出「一次
 *     低成本映射」的范围，与「车位配比」同一类省略理由，不是漏查。
 *
 * 「认证」行——review 修正（2026-08-21）：comp 字面是「LEED 认证 → 金级」，
 * 假设域层有一个结构化的认证体系字段（如 `certificationScheme: 'LEED' |
 * 'WELL' | ...` + `certificationGrade`）。但 `Buildings.certifications` 是
 * 自由文本数组（仅 `name`/`certificateNumber`/有效期/`publicVisible`），没有
 * 体系分类字段。首版实现按名称正则找一条含"LEED"的项——这个写法本身是
 * 「域层没有就换一种方式硬凑」的静默误导：当楼盘持有认证但都不叫"LEED"
 * （如"绿色建筑三星""WELL 铂金级"），该行会渲染 —，读起来像"这栋楼没有
 * 认证"，而组件手里其实攥着认证数据只是没显示——与本项目反复重申的「越界
 * 空态不许说没有结果」「规格表缺失显示 — 不隐藏行，因为隐藏=暗示不存在」
 * 是同一类问题，只是换了张脸。
 * 修正：不做特定认证名称的字符串匹配，直接展示这栋楼实际持有的公开在
 * 有效期内的认证列表（`isCertificationPublicAt` / `publicVisible` 过滤已在
 * `mapBuildingAmenityGroups` 做过，这里不重复判断，只做展示层的拼接）。
 * 多条认证用" · "拼成一行（站内既有的列表转字符串约定，见
 * `BuildingDetailLayout.tsx` `parts.join(' · ')`、`ListingCard.tsx`
 * `locationParts.join(' · ')`），不设条数上限——`.dt-spec__value` 本就允许
 * 换行（地址行已验证过长值换行不破版），认证条目现实中通常 1–3 条，没有
 * 才渲染 —，此时 — 才真正意味着"这栋楼没有可公开的认证"。
 * 这是刻意偏离 comp 字面的「LEED 认证」单项设计，Task 10 接线时不要
 * "恢复"成按认证名称做字符串匹配的写法。
 */

type BuildingSpecInput = Readonly<{
  factGroups: readonly FactGroupViewModel[]
  amenityGroups: readonly AmenityGroupViewModel[]
}>

export type BuildingSpecGroup = Readonly<{
  id: string
  title: string
  rows: readonly SpecRow[]
}>

/** 两个同单位的既有事实拼一行（如"18 部 / 2 部"）；两者都缺时该行整体为 —。 */
function combineFacts(
  groups: readonly FactGroupViewModel[],
  labelA: string,
  labelB: string,
): string | null {
  const a = factValue(findFact(groups, labelA))
  const b = factValue(findFact(groups, labelB))
  if (a == null && b == null) return null
  return `${a ?? '—'} / ${b ?? '—'}`
}

/** 「竣工时间」事实值是 ISO 日期字符串，本行只要年份 + comp 要的"年"后缀。 */
function completionYear(groups: readonly FactGroupViewModel[]): string | null {
  const fact = findFact(groups, '竣工时间')
  if (!fact || fact.value == null) return null
  return formatCompletionYear(fact.value, fact.estimated)
}

/**
 * 展示这栋楼实际持有的公开认证（已过滤 publicVisible + 有效期，见
 * `mapBuildingAmenityGroups`），不按特定认证名称做字符串匹配——见文件头
 * review 修正说明。没有认证时返回 null（渲染 —，此时确实是"没有"）。
 */
function publicCertificationsText(amenityGroups: readonly AmenityGroupViewModel[]): string | null {
  const certifications = amenityGroups.find((group) => group.id === 'certifications')
  const items = certifications?.items ?? []
  return items.length > 0 ? items.join(' · ') : null
}

export function buildBuildingSpecGroups(
  building: BuildingSpecInput,
  minLeasableArea: number | null,
): readonly BuildingSpecGroup[] {
  const groups = building.factGroups
  const fact = (label: string) => factValue(findFact(groups, label))

  return [
    {
      id: 'structure',
      title: '建筑',
      rows: [
        { label: '楼盘等级', value: fact('楼宇等级') },
        { label: '竣工年份', value: completionYear(groups) },
        { label: '总建筑面积', value: fact('总建筑面积') },
        // comp 原文「地上 / 地下」需要楼层拆分字段，Buildings 只有合计楼层
        // （totalFloors），见文件头注释——改用可达的「总楼层」，不拼假拆分。
        { label: '总楼层', value: fact('总楼层') },
        { label: '标准层面积', value: fact('标准层面积') },
        { label: '层高 / 净高', value: combineFacts(groups, '标准层高', '净层高') },
      ],
    },
    {
      id: 'mep',
      title: '机电与设施',
      rows: [
        { label: '客梯 / 货梯', value: combineFacts(groups, '客梯', '货梯') },
        { label: '空调', value: fact('空调') },
        { label: '供电', value: fact('供电') },
        // 「通信」comp 字面标签，Buildings 上对应字段站内既有标签是「网络」
        // （ListingOverviewPanel 「空调/网络/停车费」同一来源同一标签），
        // 两页读同一字段时保持同一标签，不为贴合 comp 另造一个新名字。
        { label: '网络', value: fact('网络') },
        // 电梯速度、楼板承重：Buildings.verticalTransport 只有客梯/货梯数量
        // 与分区说明，没有速度/承重字段，域层没有，省略。
      ],
    },
    {
      id: 'cost',
      title: '费用与管理',
      rows: [
        { label: '物业费', value: fact('物业费') },
        { label: '物业公司', value: fact('物业公司') },
        { label: '停车位', value: fact('停车位') },
        { label: '停车费', value: fact('停车费') },
        // 车位配比：现存字段只有车位总数没有配比（与 Task 3 同一结论）；
        // 空调加时费：buildingServices 上无对应字段。均域层没有，省略。
      ],
    },
    {
      id: 'qualification',
      title: '资质与运营',
      rows: [
        // 「认证」——不按名称匹配特定认证体系（如"LEED"），展示这栋楼实际
        // 持有的全部公开有效认证，见文件头 review 修正说明。
        { label: '认证', value: publicCertificationsText(building.amenityGroups) },
        // 「可注册」comp 字面标签，取自既有「注册能力」事实（REGISTRATION_
        // CAPABILITY_LABELS 已产出"支持注册/有条件支持/不支持注册"）。
        { label: '可注册', value: fact('注册能力') },
        { label: '最小可租面积', value: minLeasableArea != null ? `${minLeasableArea} ㎡` : null },
        // 出租率、主要租户行业：Buildings/供给快照均无对应字段或聚合基线
        // （出租率需要「总可用工位/面积」基线，仓库没有），域层没有，省略。
        // 最短租期：需要跨房源聚合 minimumLeaseMonths，超出低成本映射范围
        // （详见文件头注释），省略。
      ],
    },
  ]
}

/**
 * 整组字段部分省略时仍渲染该组（与 ListingOverviewPanel 同一判断逻辑：组是
 * 代码里依据字段可达性定好的固定行清单，不随某一栋楼的数据完整度变化）。
 */
export default function BuildingSpecPanel({
  building,
  minLeasableArea,
}: Readonly<{ building: BuildingSpecInput; minLeasableArea: number | null }>) {
  const groups = buildBuildingSpecGroups(building, minLeasableArea)
  return (
    <DetailPanel variant="full" className="dt-building-spec">
      {groups.map((group) => (
        <div key={group.id} className="dt-building-spec__group">
          <span className="dt-group-title">{group.title}</span>
          <SpecTable rows={group.rows} />
        </div>
      ))}
    </DetailPanel>
  )
}
