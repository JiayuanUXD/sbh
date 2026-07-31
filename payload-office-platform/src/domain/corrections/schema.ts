/**
 * P1 Task 6 纠错 schema 校验与白名单收窄
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 6
 *           specs/work-items/FPD-P1-detail-enhancements.md §7
 *
 * 守护不变量：
 *   - 输入视为 unknown，schema 白名单收窄后才落库
 *   - 类别仅 7 类公开枚举（price/area/availability/media/location/building-fact/other）
 *   - targetType 仅 listing/building
 *   - description 必填且 ≤500 字
 *   - 不收手机号、姓名等 PII（Modal 仅收类别 + 说明）
 *   - 错误返回稳定安全错误码字符串数组（不抛 JS 异常、不泄露内部对象）
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

/** 公开纠错类别（FPD-P1 Task 6） */
export const CORRECTION_CATEGORIES = [
  'price',
  'area',
  'availability',
  'media',
  'location',
  'building-fact',
  'other',
] as const
export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number]

/** 类别中文标签（后台展示） */
export const CORRECTION_CATEGORY_LABELS: Record<CorrectionCategory, string> = {
  price: '价格',
  area: '面积',
  availability: '在售状态',
  media: '图片/视频',
  location: '位置',
  'building-fact': '楼盘信息',
  other: '其他',
}

/** 纠错目标类型（仅房源/楼盘） */
export const CORRECTION_TARGET_TYPES = ['listing', 'building'] as const
export type CorrectionTargetType = (typeof CORRECTION_TARGET_TYPES)[number]

/** 字段长度限制 */
export const LIMITS = {
  DESCRIPTION_MAX: 500,
  TARGET_SLUG_MAX: 200,
  REQUEST_ID_MAX: 100,
} as const

/** 校验通过后的纠错请求 */
export type CorrectionRequest = Readonly<{
  requestId: string
  targetType: CorrectionTargetType
  targetSlug: string
  category: CorrectionCategory
  description: string
}>

export type ValidationResult =
  | { ok: true; data: CorrectionRequest }
  | { ok: false; errors: readonly string[] }

/**
 * 校验并标准化纠错请求体（unknown 输入）。
 *
 * 错误码：
 *   - invalid_body
 *   - request_id_required / request_id_too_long
 *   - target_type_invalid
 *   - target_slug_required / target_slug_too_long
 *   - category_invalid
 *   - description_required / description_too_long
 */
export function validateCorrection(input: unknown): ValidationResult {
  if (!isObject(input)) {
    return { ok: false, errors: ['invalid_body'] }
  }

  const errors: string[] = []

  const requestId = trimString(input.requestId)
  if (!requestId) errors.push('request_id_required')
  else if (requestId.length > LIMITS.REQUEST_ID_MAX) errors.push('request_id_too_long')

  const targetTypeRaw = trimString(input.targetType)
  if (!isTargetType(targetTypeRaw)) errors.push('target_type_invalid')

  const targetSlug = trimString(input.targetSlug)
  if (!targetSlug) errors.push('target_slug_required')
  else if (targetSlug.length > LIMITS.TARGET_SLUG_MAX) errors.push('target_slug_too_long')

  const categoryRaw = trimString(input.category)
  if (!isCategory(categoryRaw)) errors.push('category_invalid')

  const description = trimString(input.description)
  if (!description) errors.push('description_required')
  else if (description.length > LIMITS.DESCRIPTION_MAX) errors.push('description_too_long')

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    data: {
      requestId,
      targetType: targetTypeRaw as CorrectionTargetType,
      targetSlug,
      category: categoryRaw as CorrectionCategory,
      description,
    },
  }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function trimString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function isTargetType(v: string): v is CorrectionTargetType {
  return (CORRECTION_TARGET_TYPES as readonly string[]).includes(v)
}

function isCategory(v: string): v is CorrectionCategory {
  return (CORRECTION_CATEGORIES as readonly string[]).includes(v)
}
