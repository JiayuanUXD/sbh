/**
 * 只读枚举发布基线（tasks.md M2.6 Part A / Requirement R2）
 *
 * 职责：把散落在各 `src/domain/*` 模块的强类型枚举（`*_TYPES`/`*_STATUSES`
 * 数组 + `*_LABELS` 标签表）收敛为一个**只读**发布注册表，供前端字典下拉、
 * 文档说明和一致性测试统一读取。
 *
 * 设计约束：
 *   - **不复制枚举值**：所有 entries 由各领域模块的真源数组 `.map` 生成，
 *     真源新增值而这里漏更新时，`entries` 与真源长度不一致 → 单测转红。
 *   - **只读**：`readonly: true`。核心状态、商户类型、强类型枚举是发布基线，
 *     不允许在后台新增/改名（区别于可维护的展示标签，见 display-tag.ts）。
 *   - 无 payload / React 依赖，可独立单测。
 */
import {
  MERCHANT_TYPES,
  MERCHANT_TYPE_LABELS,
  MERCHANT_STATUSES,
  MERCHANT_STATUS_LABELS,
  QUALIFICATION_STATUSES,
  QUALIFICATION_STATUS_LABELS,
} from '../supply/merchant'
import {
  TEAM_STATUSES,
  TEAM_STATUS_LABELS,
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
} from '../auth/org'
import { LOCATION_TYPES, LOCATION_TYPE_LABELS } from '../geography/location-hierarchy'
import {
  BUILDING_OPERATIONAL_STATUSES,
  BUILDING_OPERATIONAL_STATUS_LABELS,
  BUILDING_TYPES,
  BUILDING_TYPE_LABELS,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_LABELS,
  REGISTRATION_CAPABILITIES,
  REGISTRATION_CAPABILITY_LABELS,
} from '../supply/building'

/** 单个字典项：机器值 + 中文显示标签。 */
export interface EnumDictionaryEntry {
  value: string
  label: string
}

/** 只读枚举字典定义。 */
export interface EnumDictionaryDef {
  /** 稳定字典编码（前端引用、文档、测试的主键）。 */
  code: string
  /** 字典中文名。 */
  label: string
  /** 恒为 true：发布基线不可在后台维护。 */
  readonly: true
  /** 由真源数组映射生成的字典项，顺序与真源一致。 */
  entries: readonly EnumDictionaryEntry[]
  /** 真源模块路径，便于溯源。 */
  source: string
}

/**
 * 由真源数组 + 标签表生成 entries。
 * 泛型约束确保只能传入「值 → 中文标签」的完整映射，标签缺项会被 TS 捕获。
 */
function toEntries<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): readonly EnumDictionaryEntry[] {
  return values.map((value) => ({ value, label: labels[value] }))
}

/** 面向业务的只读枚举字典发布基线。 */
export const ENUM_DICTIONARIES: readonly EnumDictionaryDef[] = [
  {
    code: 'merchant.type',
    label: '商户类型',
    readonly: true,
    entries: toEntries(MERCHANT_TYPES, MERCHANT_TYPE_LABELS),
    source: 'src/domain/supply/merchant.ts',
  },
  {
    code: 'merchant.status',
    label: '商户状态',
    readonly: true,
    entries: toEntries(MERCHANT_STATUSES, MERCHANT_STATUS_LABELS),
    source: 'src/domain/supply/merchant.ts',
  },
  {
    code: 'merchant.qualification_status',
    label: '商户资质状态',
    readonly: true,
    entries: toEntries(QUALIFICATION_STATUSES, QUALIFICATION_STATUS_LABELS),
    source: 'src/domain/supply/merchant.ts',
  },
  {
    code: 'team.status',
    label: '团队状态',
    readonly: true,
    entries: toEntries(TEAM_STATUSES, TEAM_STATUS_LABELS),
    source: 'src/domain/auth/org.ts',
  },
  {
    code: 'employment.status',
    label: '任职状态',
    readonly: true,
    entries: toEntries(EMPLOYMENT_STATUSES, EMPLOYMENT_STATUS_LABELS),
    source: 'src/domain/auth/org.ts',
  },
  {
    code: 'location.type',
    label: '地理节点类型',
    readonly: true,
    entries: toEntries(LOCATION_TYPES, LOCATION_TYPE_LABELS),
    source: 'src/domain/geography/location-hierarchy.ts',
  },
  {
    code: 'building.operational_status',
    label: '楼盘启停状态',
    readonly: true,
    entries: toEntries(BUILDING_OPERATIONAL_STATUSES, BUILDING_OPERATIONAL_STATUS_LABELS),
    source: 'src/domain/supply/building.ts',
  },
  {
    code: 'building.type',
    label: '楼盘物业类型',
    readonly: true,
    entries: toEntries(BUILDING_TYPES, BUILDING_TYPE_LABELS),
    source: 'src/domain/supply/building.ts',
  },
  {
    code: 'building.verification_status',
    label: '楼盘认证状态',
    readonly: true,
    entries: toEntries(VERIFICATION_STATUSES, VERIFICATION_STATUS_LABELS),
    source: 'src/domain/supply/building.ts',
  },
  {
    code: 'building.registration_capability',
    label: '楼盘注册能力',
    readonly: true,
    entries: toEntries(REGISTRATION_CAPABILITIES, REGISTRATION_CAPABILITY_LABELS),
    source: 'src/domain/supply/building.ts',
  },
]

/** 按 code 查询单个字典，未命中返回 undefined。 */
export function getEnumDictionary(code: string): EnumDictionaryDef | undefined {
  return ENUM_DICTIONARIES.find((dict) => dict.code === code)
}

/** 列出全部只读枚举字典。 */
export function listEnumDictionaries(): readonly EnumDictionaryDef[] {
  return ENUM_DICTIONARIES
}
