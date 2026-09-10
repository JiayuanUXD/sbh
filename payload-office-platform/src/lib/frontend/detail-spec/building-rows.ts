import { completionYearFromGroups, factValue, findFact } from '@/components/frontend/detail/fact-lookup'
import type { SpecRow } from '@/components/frontend/detail/SpecTable'
import type { AmenityGroupViewModel, FactGroupViewModel } from '@/domain/public-catalog'
import {
  BUILDING_SPEC_FIELDS,
  BUILDING_SPEC_GROUP_TITLES,
  isFieldVisible,
  type BuildingSpecGroupId,
  type SpecVisibilityMap,
} from './fields'

/**
 * OPT-083：楼盘参数面板的**取值**层。
 *
 * 元数据（key / label / group / 默认可见）在 `fields.ts`，本文件只挂 `resolve`。
 * 两文件分开的理由见 `fields.ts` 文件头（客户端安全边界）；不会漂移是因为本文件的
 * resolver 表以 `fields.ts` 的 key 为索引，`tests/opt083-detail-spec-registry.test.ts`
 * 断言每个 key 都有对应 resolver、且没有多余 resolver。
 *
 * 每条 `resolve` 都是从改造前 `BuildingSpecPanel.buildBuildingSpecGroups` 的对象
 * 字面量里**原样搬过来**的表达式，语义一个字没改——那份清单里逐条写着「为什么是
 * 这个字段、为什么不是 comp 上的那个」的判定（域层没有 / DTO 没有 / 可推导非编造
 * 的三层判定顺序），那些理由现在记在 `BuildingSpecPanel.tsx` 文件头，改任何一条
 * 之前先去读，不要凭直觉「恢复」已经确认拿不到的字段。
 */

export type BuildingSpecContext = Readonly<{
  factGroups: readonly FactGroupViewModel[]
  amenityGroups: readonly AmenityGroupViewModel[]
  minLeasableArea: number | null
}>

export type BuildingSpecGroup = Readonly<{
  id: BuildingSpecGroupId
  title: string
  rows: readonly SpecRow[]
}>

/** 两个同单位的既有事实拼一行（如"18 部 / 2 部"）；两者都缺时该行整体为 null。 */
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

/**
 * 展示这栋楼实际持有的公开认证（已过滤 publicVisible + 有效期，见
 * `mapBuildingAmenityGroups`），**不按特定认证名称做字符串匹配**。
 *
 * 首版曾按名称正则找一条含 "LEED" 的项，那是「域层没有就换一种方式硬凑」：楼盘持有
 * 认证但都不叫 LEED（如"绿色建筑三星""WELL 铂金级"）时该行渲染 —，读起来像"这栋楼
 * 没有认证"，而组件手里其实攥着认证数据只是没显示。没有认证时返回 null，此时 —
 * 才真正意味着"没有"。
 *
 * `BuildingDetailLayout` 的无图替代构图底条也要这一条，两处必须是同一份判断
 * （本项目在「同一判断逻辑多处」上已栽 7 次），故在此导出。
 */
export function publicCertificationsText(
  amenityGroups: readonly AmenityGroupViewModel[],
): string | null {
  const certifications = amenityGroups.find((group) => group.id === 'certifications')
  const items = certifications?.items ?? []
  return items.length > 0 ? items.join(' · ') : null
}

type BuildingResolver = (ctx: BuildingSpecContext) => string | null

export const BUILDING_SPEC_RESOLVERS: Readonly<Record<string, BuildingResolver>> = {
  buildingType: ({ factGroups }) => factValue(findFact(factGroups, '物业类型')),
  grade: ({ factGroups }) => factValue(findFact(factGroups, '楼宇等级')),
  completionYear: ({ factGroups }) => completionYearFromGroups(factGroups),
  grossFloorArea: ({ factGroups }) => factValue(findFact(factGroups, '总建筑面积')),
  // comp 原文「地上 / 地下」需要楼层拆分字段，Buildings 只有合计楼层（totalFloors），
  // 见 BuildingSpecPanel 文件头——用可达的「总楼层」，不拼假拆分。
  totalFloors: ({ factGroups }) => factValue(findFact(factGroups, '总楼层')),
  typicalFloorArea: ({ factGroups }) => factValue(findFact(factGroups, '标准层面积')),
  floorHeight: ({ factGroups }) => combineFacts(factGroups, '标准层高', '净层高'),
  efficiencyRate: ({ factGroups }) => factValue(findFact(factGroups, '得房率')),
  elevators: ({ factGroups }) => combineFacts(factGroups, '客梯', '货梯'),
  airConditioning: ({ factGroups }) => factValue(findFact(factGroups, '空调')),
  powerSupply: ({ factGroups }) => factValue(findFact(factGroups, '供电')),
  // 「通信」是 comp 字面标签，站内既有标签是「网络」（ListingOverviewPanel 同一来源
  // 同一标签）。两页读同一字段时保持同一标签，不为贴合 comp 另造一个新名字。
  network: ({ factGroups }) => factValue(findFact(factGroups, '网络')),
  accessControl: ({ factGroups }) => factValue(findFact(factGroups, '门禁')),
  elevatorZoning: ({ factGroups }) => factValue(findFact(factGroups, '分区说明')),
  serviceHours: ({ factGroups }) => factValue(findFact(factGroups, '服务时间')),
  propertyFee: ({ factGroups }) => factValue(findFact(factGroups, '物业费')),
  propertyCompany: ({ factGroups }) => factValue(findFact(factGroups, '物业公司')),
  developer: ({ factGroups }) => factValue(findFact(factGroups, '开发商')),
  parkingSpaces: ({ factGroups }) => factValue(findFact(factGroups, '停车位')),
  parkingFee: ({ factGroups }) => factValue(findFact(factGroups, '停车费')),
  certifications: ({ amenityGroups }) => publicCertificationsText(amenityGroups),
  // 「可注册」comp 字面标签，取自既有「注册能力」事实
  // （REGISTRATION_CAPABILITY_LABELS 已产出"支持注册/有条件支持/不支持注册"）。
  registrationCapability: ({ factGroups }) => factValue(findFact(factGroups, '注册能力')),
  // 与 HeroSummaryPanel「可租面积」统计同源（同一个 aggregateAreaRange），
  // 不另算一份；无有效供给时 minLeasableArea 是 null 而不是 0。
  minLeasableArea: ({ minLeasableArea }) =>
    minLeasableArea != null ? `${minLeasableArea} ㎡` : null,
}

/**
 * 装配楼盘参数分组。
 *
 * 组的渲染顺序取自 `BUILDING_SPEC_GROUP_TITLES` 的键序，组内行序取自
 * `BUILDING_SPEC_FIELDS` 的数组序——两者合起来就是改造前那份硬编码清单的顺序，
 * `tests/opt083-detail-spec-registry.test.ts` 的零变化守卫逐字盯着它。
 *
 * `.filter((group) => group.rows.length > 0)`：**未勾选 ⇒ 不渲染**。楼盘侧 23 项
 * 默认全部可见，所以默认配置下四组都在、输出与改造前完全一致；只有运营真的关掉
 * 一整组时才会少一组。这与「没值 ⇒ 不渲染」是两条独立规则。
 */
export function buildBuildingSpecGroupsFromRegistry(
  ctx: BuildingSpecContext,
  visibility?: SpecVisibilityMap,
): readonly BuildingSpecGroup[] {
  const groupIds = Object.keys(BUILDING_SPEC_GROUP_TITLES) as BuildingSpecGroupId[]
  return groupIds
    .map((id) => ({
      id,
      title: BUILDING_SPEC_GROUP_TITLES[id],
      rows: BUILDING_SPEC_FIELDS.filter(
        (field) => field.group === id && isFieldVisible(field, visibility),
      )
        .map((field) => ({
          label: field.label,
          value: BUILDING_SPEC_RESOLVERS[field.key](ctx),
        }))
        // OPT-083：**没值就不显这行**。这是对 `SpecTable` 旧契约（缺值渲染 —、
        // 不隐藏行）的刻意反转，产品裁定与已知代价见
        // `specs/work-items/OPT-083-detail-spec-field-visibility.md` §2 / §11，
        // 行为守卫见 `tests/opt083-detail-spec-hiding.test.ts`。
        .filter((row) => row.value != null),
    }))
    .filter((group) => group.rows.length > 0)
}
