/**
 * 房源业务字段枚举单一真源（tasks.md M4.1 / design §3.4 listings / R4）
 *
 * 审核轴（review_status）/ 发布轴（publication_status）/ 供给冻结轴
 * （supply_visibility_hold）在 review-status.ts、publication-status.ts 定义；
 * 本模块收敛房源自身的其余强类型枚举：租售类型、装修状态。
 * 沿用全域枚举范式：`X_VALUES as const` + `X_LABELS: Record<X,string>` + `isX()` 守卫。
 * 无 payload / React 依赖，可独立单测。
 */

/** 租售类型（design §3.4 business_type）。 */
export const BUSINESS_TYPES = ['lease', 'sale'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  lease: '出租',
  sale: '出售',
}

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === 'string' && (BUSINESS_TYPES as readonly string[]).includes(value)
}

/** 装修状态（design §3.4 decoration_status）。 */
export const DECORATION_STATUSES = ['rough', 'simple', 'furnished', 'fully_fitted'] as const
export type DecorationStatus = (typeof DECORATION_STATUSES)[number]

export const DECORATION_STATUS_LABELS: Record<DecorationStatus, string> = {
  rough: '毛坯',
  simple: '简装',
  furnished: '精装带家具',
  fully_fitted: '拎包入住',
}

export function isDecorationStatus(value: unknown): value is DecorationStatus {
  return typeof value === 'string' && (DECORATION_STATUSES as readonly string[]).includes(value)
}

/** 工商注册状态（详情页字段）。 */
export const REGISTRATION_STATUSES = ['available', 'conditional', 'unavailable', 'confirm'] as const
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number]

export function isRegistrationStatus(value: unknown): value is RegistrationStatus {
  return typeof value === 'string' && (REGISTRATION_STATUSES as readonly string[]).includes(value)
}

/** 租赁费用是否包含的统一枚举（详情页字段）。 */
export const COST_INCLUSION_STATUSES = ['included', 'excluded', 'confirm'] as const

/** 详情页媒体类型与房源媒体分类。 */
export const DETAIL_MEDIA_KINDS = ['image', 'floor-plan', 'video'] as const
export const LISTING_MEDIA_CATEGORIES = [
  'workspace',
  'meeting-room',
  'common-area',
  'exterior',
] as const
