import { describe, expect, it } from 'vitest'

import {
  FOLLOWUP_METHODS,
  FOLLOWUP_RESULTS,
  FOLLOWUP_METHOD_LABELS,
  FOLLOWUP_RESULT_LABELS,
  isFollowUpMethod,
  isFollowUpResult,
  isRecommendationResult,
  requiresRelatedListings,
  isValidFollowUp,
  isWithinCorrectionWindow,
  type FollowUpDraft,
} from '@/domain/crm/follow-up'
import { FOLLOWUP_CORRECTION_WINDOW_SECONDS } from '@/domain/crm/policy'

/**
 * M5.5 跟进记录纯逻辑单测（tasks.md M5.5 / design §3.6 follow_ups / R6, R8 / M5 验收门）
 *
 * 校验维度:方式/结果枚举、内容必填、"已推荐"必须关联至少一套房源、24 小时纠错窗口判定。
 * 纯逻辑不查库:关联房源是否属于有效供给由调用方(领域服务)预先精筛后传入。
 */

const NOW = new Date('2026-07-26T12:00:00.000Z')

function baseDraft(overrides: Partial<FollowUpDraft> = {}): FollowUpDraft {
  return {
    method: 'phone',
    result: 'connected',
    content: '电话沟通,客户有意向',
    relatedListingIds: [],
    ...overrides,
  }
}

describe('crm-follow-up/枚举常量', () => {
  it('方式枚举与标签齐全', () => {
    expect(FOLLOWUP_METHODS).toEqual(['phone', 'wechat', 'visit', 'other'])
    for (const m of FOLLOWUP_METHODS) {
      expect(FOLLOWUP_METHOD_LABELS[m]).toBeTruthy()
    }
  })

  it('结果枚举与标签齐全', () => {
    expect(FOLLOWUP_RESULTS).toEqual([
      'connected',
      'no_answer',
      'recommended',
      'appointment',
      'invalid',
    ])
    for (const r of FOLLOWUP_RESULTS) {
      expect(FOLLOWUP_RESULT_LABELS[r]).toBeTruthy()
    }
  })

  it('类型守卫', () => {
    expect(isFollowUpMethod('phone')).toBe(true)
    expect(isFollowUpMethod('sms')).toBe(false)
    expect(isFollowUpResult('recommended')).toBe(true)
    expect(isFollowUpResult('won')).toBe(false)
  })
})

describe('crm-follow-up/已推荐必关联房源', () => {
  it('recommended 是需要关联房源的结果', () => {
    expect(isRecommendationResult('recommended')).toBe(true)
    expect(isRecommendationResult('connected')).toBe(false)
    expect(requiresRelatedListings('recommended')).toBe(true)
    expect(requiresRelatedListings('connected')).toBe(false)
  })

  it('已推荐但无关联房源 → 非法', () => {
    const r = isValidFollowUp(baseDraft({ result: 'recommended', relatedListingIds: [] }))
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('recommended_requires_listing')
  })

  it('已推荐且关联至少一套 → 合法', () => {
    const r = isValidFollowUp(baseDraft({ result: 'recommended', relatedListingIds: [1] }))
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('非推荐结果无需关联房源', () => {
    const r = isValidFollowUp(baseDraft({ result: 'connected', relatedListingIds: [] }))
    expect(r.valid).toBe(true)
  })
})

describe('crm-follow-up/内容必填', () => {
  it('空内容 → 非法', () => {
    const r = isValidFollowUp(baseDraft({ content: '   ' }))
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('content_required')
  })
})

describe('crm-follow-up/方式或结果非法', () => {
  it('非法方式 → 非法', () => {
    const r = isValidFollowUp(baseDraft({ method: 'sms' as never }))
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('method_invalid')
  })

  it('非法结果 → 非法', () => {
    const r = isValidFollowUp(baseDraft({ result: 'won' as never }))
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('result_invalid')
  })
})

describe('crm-follow-up/24 小时纠错窗口', () => {
  it('窗口常量为 24 小时', () => {
    expect(FOLLOWUP_CORRECTION_WINDOW_SECONDS).toBe(24 * 60 * 60)
  })

  it('创建后 1 小时内 → 可纠错', () => {
    const createdAt = new Date(NOW.getTime() - 60 * 60 * 1000)
    expect(isWithinCorrectionWindow(createdAt, NOW)).toBe(true)
  })

  it('恰好 24 小时(边界)→ 仍可纠错', () => {
    const createdAt = new Date(NOW.getTime() - FOLLOWUP_CORRECTION_WINDOW_SECONDS * 1000)
    expect(isWithinCorrectionWindow(createdAt, NOW)).toBe(true)
  })

  it('超过 24 小时 → 不可纠错', () => {
    const createdAt = new Date(NOW.getTime() - (FOLLOWUP_CORRECTION_WINDOW_SECONDS + 1) * 1000)
    expect(isWithinCorrectionWindow(createdAt, NOW)).toBe(false)
  })
})
