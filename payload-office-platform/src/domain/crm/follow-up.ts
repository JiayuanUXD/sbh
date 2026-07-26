/**
 * CRM 跟进记录纯逻辑（tasks.md M5.5 / design §3.6 follow_ups / R6, R8 / M5 验收门）
 *
 * 跟进记录 append-only 不可物理删除;24 小时内纠错通过追加一条 correction_of 指向原记录的
 * 修正记录实现（记录本身永不 in-place 改）。本模块提供:方式/结果枚举、草稿合法性校验
 * （内容必填、"已推荐"必须关联至少一套有效供给房源）、24 小时纠错窗口判定——全为纯逻辑,
 * 不查库、不写库。关联房源是否属于统一有效供给由调用方(领域服务)预先精筛后传入。
 */

import { FOLLOWUP_CORRECTION_WINDOW_SECONDS } from './policy'

/** 跟进方式(顺序即 UI 呈现顺序)。 */
export const FOLLOWUP_METHODS = ['phone', 'wechat', 'visit', 'other'] as const
export type FollowUpMethod = (typeof FOLLOWUP_METHODS)[number]

export const FOLLOWUP_METHOD_LABELS: Record<FollowUpMethod, string> = {
  phone: '电话',
  wechat: '微信',
  visit: '面访',
  other: '其他',
}

export function isFollowUpMethod(value: unknown): value is FollowUpMethod {
  return typeof value === 'string' && (FOLLOWUP_METHODS as readonly string[]).includes(value)
}

/** 跟进结果(顺序即 UI 呈现顺序)。recommended=已推荐,必须关联房源。 */
export const FOLLOWUP_RESULTS = [
  'connected',
  'no_answer',
  'recommended',
  'appointment',
  'invalid',
] as const
export type FollowUpResult = (typeof FOLLOWUP_RESULTS)[number]

export const FOLLOWUP_RESULT_LABELS: Record<FollowUpResult, string> = {
  connected: '已接通',
  no_answer: '未接通',
  recommended: '已推荐',
  appointment: '已约带看',
  invalid: '无效',
}

export function isFollowUpResult(value: unknown): value is FollowUpResult {
  return typeof value === 'string' && (FOLLOWUP_RESULTS as readonly string[]).includes(value)
}

/** 是否为"已推荐"结果。 */
export function isRecommendationResult(result: FollowUpResult): boolean {
  return result === 'recommended'
}

/**
 * 该结果是否要求关联房源。
 *
 * "已推荐"(recommended)必须关联统一有效供给中的至少一套房源(M5 验收门 / R8);
 * 其余结果不强制。
 */
export function requiresRelatedListings(result: FollowUpResult): boolean {
  return isRecommendationResult(result)
}

/** 跟进草稿(校验所需最小字段)。关联房源以 id 列表传入,有效性由调用方预筛。 */
export type FollowUpDraft = {
  method: FollowUpMethod
  result: FollowUpResult
  content: string
  relatedListingIds: readonly (number | string)[]
}

/** 校验拒绝码(顺序即校验/呈现顺序)。 */
export const FOLLOWUP_VALIDATION_CODES = [
  'method_invalid',
  'result_invalid',
  'content_required',
  'recommended_requires_listing',
] as const
export type FollowUpValidationCode = (typeof FOLLOWUP_VALIDATION_CODES)[number]

export type FollowUpValidation = {
  valid: boolean
  errors: FollowUpValidationCode[]
}

/**
 * 校验跟进草稿是否可落库。收集全部错误(不短路),便于一次性回显。
 *
 *   - 方式 / 结果须在枚举内。
 *   - 内容必填(去空白后非空)。
 *   - 结果为"已推荐"时必须关联至少一套房源(有效供给精筛后的 id)。
 */
export function isValidFollowUp(draft: FollowUpDraft): FollowUpValidation {
  const errors: FollowUpValidationCode[] = []

  if (!isFollowUpMethod(draft.method)) {
    errors.push('method_invalid')
  }

  if (!isFollowUpResult(draft.result)) {
    errors.push('result_invalid')
  }

  if (typeof draft.content !== 'string' || draft.content.trim().length === 0) {
    errors.push('content_required')
  }

  if (
    isFollowUpResult(draft.result) &&
    requiresRelatedListings(draft.result) &&
    draft.relatedListingIds.length === 0
  ) {
    errors.push('recommended_requires_listing')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 是否仍在 24 小时纠错窗口内(边界:恰好到期视为仍可纠错,给足整点窗口)。
 *
 * createdAt:原跟进记录创建时刻;now:当前时刻。超窗后不允许再追加修正记录。
 */
export function isWithinCorrectionWindow(createdAt: Date, now: Date): boolean {
  const deadline = createdAt.getTime() + FOLLOWUP_CORRECTION_WINDOW_SECONDS * 1000
  return now.getTime() <= deadline
}
