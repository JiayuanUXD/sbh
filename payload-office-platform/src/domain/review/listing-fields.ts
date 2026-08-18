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

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  available: '可注册',
  conditional: '有条件注册',
  unavailable: '不可注册',
  confirm: '待确认',
}

export function isRegistrationStatus(value: unknown): value is RegistrationStatus {
  return typeof value === 'string' && (REGISTRATION_STATUSES as readonly string[]).includes(value)
}

/** 租赁费用是否包含的统一枚举（详情页字段）。 */
export const COST_INCLUSION_STATUSES = ['included', 'excluded', 'confirm'] as const
export type CostInclusionStatus = (typeof COST_INCLUSION_STATUSES)[number]

export const COST_INCLUSION_STATUS_LABELS: Record<CostInclusionStatus, string> = {
  included: '包含',
  excluded: '不包含',
  confirm: '待确认',
}

/** 家具状态（space_details.furniture_status）。 */
export const FURNITURE_STATUSES = ['included', 'optional', 'none', 'confirm'] as const
export type FurnitureStatus = (typeof FURNITURE_STATUSES)[number]

export const FURNITURE_STATUS_LABELS: Record<FurnitureStatus, string> = {
  included: '含家具',
  optional: '家具可选',
  none: '无家具',
  confirm: '待确认',
}

/** 发票情况（cost_terms.invoice_status）。 */
export const INVOICE_STATUSES = ['included', 'extra-tax', 'unavailable', 'confirm'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  included: '含发票',
  'extra-tax': '需加税点',
  unavailable: '无发票',
  confirm: '待确认',
}

/** 详情页媒体类型与房源媒体分类。 */
export const DETAIL_MEDIA_KINDS = ['image', 'floor-plan', 'video'] as const
export type DetailMediaKind = (typeof DETAIL_MEDIA_KINDS)[number]

export const DETAIL_MEDIA_KIND_LABELS: Record<DetailMediaKind, string> = {
  image: '图片',
  'floor-plan': '空间图',
  video: '视频',
}

export const LISTING_MEDIA_CATEGORIES = [
  'workspace',
  'meeting-room',
  'common-area',
  'exterior',
] as const
export type ListingMediaCategory = (typeof LISTING_MEDIA_CATEGORIES)[number]

export const LISTING_MEDIA_CATEGORY_LABELS: Record<ListingMediaCategory, string> = {
  workspace: '办公空间',
  'meeting-room': '会议室',
  'common-area': '公区/电梯厅',
  exterior: '外立面/建筑外观',
}

/**
 * 产权年限（出售专属，纯展示）。
 *
 * 商办常见三档。**平台不做年限折损计算**（用户决策）：不设产权到期日、不派生
 * 剩余年限，详情页只展示「50 年产权」这类原始信息。
 *
 * 这不是省事，是降风险：剩余年限要算准，前提是产权起始日准确，而业主提供的日期
 * 未必可靠；「剩余 31.4 年」这种精确数字一旦算错，客户拿它算过投资回报，平台要担
 * 二次计算的责任。展示原始年限把口径交回产权证本身。
 *
 * 用枚举而非自由输入，避免「四十年」「40年产权」「40」混存。
 */
export const PROPERTY_RIGHT_YEARS = ['40', '50', '70'] as const
export type PropertyRightYears = (typeof PROPERTY_RIGHT_YEARS)[number]

export const PROPERTY_RIGHT_YEARS_LABELS: Record<PropertyRightYears, string> = {
  '40': '40 年',
  '50': '50 年',
  '70': '70 年',
}

export function isPropertyRightYears(value: unknown): value is PropertyRightYears {
  return typeof value === 'string' && (PROPERTY_RIGHT_YEARS as readonly string[]).includes(value)
}
