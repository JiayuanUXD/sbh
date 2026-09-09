import React from 'react'
import DetailPanel from './DetailPanel'
import SpecTable from './SpecTable'
import {
  buildBuildingSpecGroupsFromRegistry,
  type BuildingSpecContext,
  type BuildingSpecGroup,
} from '@/lib/frontend/detail-spec/building-rows'
import type { SpecVisibilityMap } from '@/lib/frontend/detail-spec/fields'

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
 *
 * 「comp 之外的 6 条」——Task 10 接线补充（2026-08-21）：本面板在楼盘详情页
 * 取代了旧的 `DetailFacts`（全量事实清单）。对账两者的字段清单发现 6 条
 * （物业类型 / 得房率 / 电梯分区 / 门禁 / 服务时间 / 开发商）comp 没列、
 * 但 `mapBuildingFactGroups` 一直在产出、旧页面一直在展示、种子数据里也
 * 都有值——不补进来就是一次接线造成的静默内容删除。它们按 comp 的四个
 * 语义组就近安放，落在因域层缺字段而空出来的格里，不改版式。
 * `tests/building-spec-panel.test.ts` 有一条专门守卫它们的用例，任何
 * 「按 comp 收敛」的后续清理会先撞到那条用例。
 */


/**
 * ── OPT-082：行清单已搬到 `src/lib/frontend/detail-spec/` ──
 *
 * 上面那份「哪些字段可达、哪些域层没有、哪些是漏查」的逐项判定**依然有效**，
 * 只是它描述的对象从本文件里的数组字面量变成了 registry：
 *   - 元数据（key / 标签 / 分组 / 默认是否展示）→ `detail-spec/fields.ts`
 *   - 取值表达式（原样搬过去，一个字没改）    → `detail-spec/building-rows.ts`
 *
 * 改字段前仍然先读上面那段，不要凭直觉「恢复」已经确认拿不到的字段。
 */

export type { BuildingSpecGroup }

type BuildingSpecInput = Omit<BuildingSpecContext, 'minLeasableArea'>

/**
 * 保留本函数的导出名与前两个参数：`BuildingDetailLayout` 拿它当纯函数判断
 * 「这栋楼到底有没有参数可展示」，签名一变那边就得跟着改，而那正是本次重构
 * 最不该牵动的地方。
 */
export function buildBuildingSpecGroups(
  building: BuildingSpecInput,
  minLeasableArea: number | null,
  visibility?: SpecVisibilityMap,
): readonly BuildingSpecGroup[] {
  return buildBuildingSpecGroupsFromRegistry({ ...building, minLeasableArea }, visibility)
}


/**
 * 组的收起（OPT-082 起，与 `ListingOverviewPanel` 同一判断逻辑）：
 * 一组内**没有任何可见且有值的行**时，连组标题一起不渲染。
 *
 * 旧口径是「组是代码里依据字段可达性定好的固定行清单，不随某一栋楼的数据完整度
 * 变化」——那是「缺值渲染 —」时代的配套：既然每行都在，组自然也在。规则反转后
 * 若还保留空组，页面上就是一个只剩标题的空货架。判断在
 * `buildBuildingSpecGroupsFromRegistry` 里做，本组件只渲染拿到的组。
 */
export default function BuildingSpecPanel({
  building,
  minLeasableArea,
  features = [],
  visibility,
}: Readonly<{
  building: BuildingSpecInput
  minLeasableArea: number | null
  /** 运营配置的字段可见性（OPT-082）。缺省按 registry 默认走，即改造前的现状。 */
  visibility?: SpecVisibilityMap
  /**
   * 「楼盘特色」标签（comp「楼盘参数」面板底部：标签列 104 + gap 32 · 13/500
   * 底 #f5f5f7），数据是 `BuildingDetailViewModel.amenities`。
   *
   * 放在本面板内部而不是由页面层另起一个面板，是照 comp 的分组：它与上方
   * 参数表共处一张白底面板、只用一条 hairline 分隔。空数组时整段不渲染
   * （**不是** 渲染一个「楼盘特色 —」的空行）——它不是固定 schema 的规格行，
   * 而是「有几条列几条」的标签集合，同 `HeroSummaryPanel.pickHeroFacts` 的判据。
   * （OPT-082 起参数行本身也是「没值就不显」，两者的呈现于是一致了，但理由不同：
   * 这里从来就不是规格行，不受那条规则反转的影响。）
   */
  features?: readonly string[]
}>) {
  const groups = buildBuildingSpecGroups(building, minLeasableArea, visibility)
  return (
    <DetailPanel variant="full" className="dt-building-spec">
      {groups.map((group) => (
        <div key={group.id} className="dt-building-spec__group">
          <span className="dt-group-title">{group.title}</span>
          <SpecTable rows={group.rows} />
        </div>
      ))}
      {features.length > 0 && (
        <div className="dt-building-spec__features">
          <span className="dt-group-title">楼盘特色</span>
          <ul className="dt-building-spec__feature-list">
            {features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
      )}
    </DetailPanel>
  )
}
