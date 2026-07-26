/**
 * 地理节点固定层级 & 字段不变量（纯函数层）
 *
 * 业务规则来源：docs/prd/后台管理系统_MVP_页面PRD/07_系统设置/03_城市区域_PRD.md
 *   固定两条链，不允许跨层级：
 *     城市 city → 行政区 district → 商圈 business_area
 *     城市 city → 地铁线路 metro_line → 地铁站 metro_station
 *   - 城市为根，不允许有上级
 *   - 每个非城市类型的合法父级类型唯一（见 PARENT_TYPE_RULE）
 *   - 区域代码全局唯一、创建后不可变（唯一性由 DB unique 约束保证，本层只管格式与不可变）
 *   - 坐标范围 lat ∈ [-90, 90]、lng ∈ [-180, 180]
 *
 * 纯函数：不依赖 payload / req，便于单测。副作用（父级查询、跨城市判断）留在 location-protect.ts。
 */

import { InvalidOperationError } from '@/domain/shared/errors'

/** 统一地理节点类型（固定枚举） */
export const LOCATION_TYPES = [
  'city',
  'district',
  'business_area',
  'metro_line',
  'metro_station',
] as const

export type LocationType = (typeof LOCATION_TYPES)[number]

/** 中文标签，供 select options 与错误信息复用 */
export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  city: '城市',
  district: '行政区',
  business_area: '商圈',
  metro_line: '地铁线路',
  metro_station: '地铁站',
}

/**
 * 固定层级规则：每种类型的合法父级类型。
 * null 表示根节点（城市），不允许有上级。
 */
export const PARENT_TYPE_RULE: Record<LocationType, LocationType | null> = {
  city: null,
  district: 'city',
  business_area: 'district',
  metro_line: 'city',
  metro_station: 'metro_line',
}

export function isLocationType(value: unknown): value is LocationType {
  return typeof value === 'string' && (LOCATION_TYPES as readonly string[]).includes(value)
}

/**
 * 业务表单 location 关系字段的候选过滤条件（M2.2）。
 * 只保留启用节点，并按传入类型收窄；类型省略时不限类型（仅滤启用）。
 * 停用节点不进新建/编辑候选，但历史已存值不受影响（filterOptions 仅约束下拉候选）。
 *
 * 返回值形状与 Payload `Where` 兼容；显式构造两个独立的 where 条件放入 and，
 * 避免数组字面量元素形状不一导致 TS 索引签名报错。
 */
export function activeLocationFilter(types?: readonly LocationType[]): {
  and: Array<{ [key: string]: { equals?: string; in?: readonly string[] } }>
} {
  const conditions: Array<{ [key: string]: { equals?: string; in?: readonly string[] } }> = []
  if (types && types.length > 0) {
    conditions.push(types.length === 1 ? { type: { equals: types[0] } } : { type: { in: types } })
  }
  conditions.push({ status: { equals: 'active' } })
  return { and: conditions }
}

/** 该类型要求的父级类型；city 返回 null（无上级） */
export function getRequiredParentType(type: LocationType): LocationType | null {
  return PARENT_TYPE_RULE[type]
}

/** 该类型是否必须有上级（除城市外都必须） */
export function requiresParent(type: LocationType): boolean {
  return getRequiredParentType(type) !== null
}

/** 给定子类型，某父级类型是否合法 */
export function isValidParentType(childType: LocationType, parentType: LocationType): boolean {
  return getRequiredParentType(childType) === parentType
}

// —— 坐标校验（6 位小数由 UI/存储层保证，本层只管范围） ——

export function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90
}

export function isValidLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180
}

/**
 * 区域代码格式：大写字母/数字开头,后续允许大写字母/数字/连字符/下划线,总长 2–64。
 * 唯一性交给 DB unique 约束,不可变交给 hook。
 */
const REGION_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,63}$/

export function isValidRegionCode(code: string): boolean {
  return REGION_CODE_PATTERN.test(code)
}

// —— 组合校验（抛 InvalidOperationError，供 hook 调用） ——

export type HierarchyCheckInput = {
  /** 被校验节点自身类型 */
  childType: LocationType
  /** 是否提供了 parent 关系 */
  hasParent: boolean
  /** 已解析的父级类型；hasParent 为 true 时必填 */
  parentType?: LocationType | null
}

/**
 * 固定层级校验：
 *   - 城市不允许有上级
 *   - 非城市类型必须有上级，且父级类型唯一合法
 */
export function assertValidHierarchy(input: HierarchyCheckInput): void {
  const { childType, hasParent, parentType } = input
  const required = getRequiredParentType(childType)

  if (required === null) {
    if (hasParent) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'ROOT_HAS_PARENT',
        message: `${LOCATION_TYPE_LABELS[childType]}为根节点，不允许设置上级`,
      })
    }
    return
  }

  if (!hasParent) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'PARENT_REQUIRED',
      message: `${LOCATION_TYPE_LABELS[childType]}必须挂在${LOCATION_TYPE_LABELS[required]}下`,
    })
  }

  if (parentType !== required) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'INVALID_PARENT_TYPE',
      message: `${LOCATION_TYPE_LABELS[childType]}的上级只能是${LOCATION_TYPE_LABELS[required]}，收到${
        parentType ? LOCATION_TYPE_LABELS[parentType] : '(未知)'
      }`,
      details: { childType, parentType, required },
    })
  }
}

/** 坐标对校验：任一为 null/undefined 视为未填（合法）；填了则必须成对且在范围内 */
export function assertValidCoordinates(lat: unknown, lng: unknown): void {
  const latEmpty = lat === null || lat === undefined
  const lngEmpty = lng === null || lng === undefined
  if (latEmpty && lngEmpty) return
  if (latEmpty !== lngEmpty) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'COORDINATE_INCOMPLETE',
      message: '中心坐标必须同时填写经度和纬度',
    })
  }
  if (typeof lat !== 'number' || !isValidLatitude(lat)) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'INVALID_LATITUDE',
      message: `纬度必须在 -90 ~ 90 之间，收到 ${String(lat)}`,
    })
  }
  if (typeof lng !== 'number' || !isValidLongitude(lng)) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'INVALID_LONGITUDE',
      message: `经度必须在 -180 ~ 180 之间，收到 ${String(lng)}`,
    })
  }
}

/** 区域代码格式校验 */
export function assertValidRegionCode(code: unknown): void {
  if (typeof code !== 'string' || !isValidRegionCode(code)) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'INVALID_REGION_CODE',
      message: `区域代码格式非法（大写字母/数字开头，2–64 位），收到 ${String(code)}`,
    })
  }
}
