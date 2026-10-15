import type { CollectionBeforeValidateHook, Option, PayloadRequest } from 'payload'

import { BUILDING_TYPE_LABELS, isBuildingType, type BuildingType } from './building'

/**
 * OPT-115 第一期（扩展）：物业类型旧值兼容层。第二期（收敛）回填并删掉旧枚举值后，整份文件删除。
 *
 * 为什么分两期：发布时新容器启动先跑迁移，旧版本此时仍承接全部流量；冒烟失败只回滚流量、
 * 不执行迁移 down。若第一期就删旧值，旧版本选「写字楼」保存会被 PG 拒绝，回滚后也一直如此
 * （`.agent/migrations.md`：扩展 → 回填 → 双读 → 切换 → 收敛）。所以第一期只给枚举加新值，
 * 数据不动，旧版本照常读写；新代码在这里做「双读」——读到旧值按映射显示新名称，保存时换成新值。
 */

export const LEGACY_BUILDING_TYPES = ['office_building', 'commercial_complex', 'serviced_office'] as const
export type LegacyBuildingType = (typeof LEGACY_BUILDING_TYPES)[number]

/** 旧值 → 新值（用户确认的映射）。商业综合体没有对应项，清空留给运营重选。 */
const LEGACY_REPLACEMENTS: Record<LegacyBuildingType, BuildingType | null> = {
  office_building: 'traditional_office',
  serviced_office: 'coworking',
  commercial_complex: null,
}

/** 后台下拉里旧选项的名字：只在当前值就是它时出现，说清保存后会变成什么。 */
export const LEGACY_BUILDING_TYPE_OPTION_LABELS: Record<LegacyBuildingType, string> = {
  office_building: '写字楼（旧选项，保存后改为传统办公）',
  serviced_office: '服务式办公（旧选项，保存后改为联合办公）',
  commercial_complex: '商业综合体（旧选项，保存后清空，请重选）',
}

export function isLegacyBuildingType(value: unknown): value is LegacyBuildingType {
  return typeof value === 'string' && (LEGACY_BUILDING_TYPES as readonly string[]).includes(value)
}

/** 旧值换成新值；新值、空值原样返回；未知值也原样返回，交给 building-protect 拒绝。 */
export function normalizeBuildingType<T>(value: T): T | BuildingType | null {
  return isLegacyBuildingType(value) ? LEGACY_REPLACEMENTS[value] : value
}

/** 展示用名称：新值取标签，旧值按映射取新标签；无对应项或未知值返回 null（不展示）。 */
export function buildingTypeLabel(value: unknown): string | null {
  const normalized = normalizeBuildingType(value)
  return isBuildingType(normalized) ? BUILDING_TYPE_LABELS[normalized] : null
}

/**
 * 下拉过滤：默认只给新值；当前值是旧值时把它留在选项里——Payload 的 select 校验
 * 用的是过滤后的选项，去掉它会让这条楼盘连其他字段都存不了。保存时
 * `normalizeLegacyBuildingType` 会先把它换成新值。
 */
export function filterBuildingTypeOptions({
  data,
  options,
}: {
  data: Record<string, unknown> | undefined
  options: Option[]
  req: PayloadRequest
  siblingData: Record<string, unknown> | undefined
}): Option[] {
  const current = data?.buildingType
  return options.filter((option) => {
    const value = typeof option === 'string' ? option : option.value
    return !isLegacyBuildingType(value) || value === current
  })
}

/** 保存时把旧值换成新值（只处理本次提交了的物业类型，不凭空写入）。 */
export const normalizeLegacyBuildingType: CollectionBeforeValidateHook = ({ data }) => {
  if (!data || !('buildingType' in data)) return data
  return { ...data, buildingType: normalizeBuildingType(data.buildingType) }
}

/**
 * 后台列表用的「值 → 中文名」：新旧值都覆盖，旧值按映射显示新名称，不把英文值原样露出来。
 * 商业综合体没有对应项，标「待重选」提醒运营。
 */
export const BUILDING_TYPE_DISPLAY_LABELS: Readonly<Record<BuildingType | LegacyBuildingType, string>> = {
  ...BUILDING_TYPE_LABELS,
  office_building: BUILDING_TYPE_LABELS.traditional_office,
  serviced_office: BUILDING_TYPE_LABELS.coworking,
  commercial_complex: '商业综合体（待重选）',
}
