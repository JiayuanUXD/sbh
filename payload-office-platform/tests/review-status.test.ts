import { describe, expect, it } from 'vitest'

import {
  REVIEW_STATUSES,
  REVIEW_STATUS_LABELS,
  isReviewStatus,
  REVIEW_DECISIONS,
  REVIEW_DECISION_LABELS,
  isReviewDecision,
  canTransitionReview,
  nextReviewStatus,
  reviewDecisionToStatus,
} from '@/domain/review/review-status'

/**
 * M4.4 审核状态机纯函数单测（design §3.4 review_status / §3.5 状态机）
 *
 * 状态：未提交 → 待审核 →（通过 / 驳回）；驳回 → 未提交（重新准备）；
 *       待审核 → 未提交（撤回）。无 payload 依赖，纯内存断言。
 */

describe('review-status/枚举', () => {
  it('四个状态', () => {
    expect(REVIEW_STATUSES).toEqual(['not_submitted', 'pending', 'approved', 'rejected'])
  })

  it('每个状态都有非空中文 label', () => {
    for (const s of REVIEW_STATUSES) {
      expect(REVIEW_STATUS_LABELS[s].trim().length).toBeGreaterThan(0)
    }
  })

  it('isReviewStatus 守卫', () => {
    expect(isReviewStatus('pending')).toBe(true)
    expect(isReviewStatus('approved')).toBe(true)
    expect(isReviewStatus('unknown')).toBe(false)
    expect(isReviewStatus(null)).toBe(false)
    expect(isReviewStatus(123)).toBe(false)
  })
})

describe('review-status/审核动作枚举', () => {
  it('四个动作:提交/撤回/通过/驳回', () => {
    expect(REVIEW_DECISIONS).toEqual(['submit', 'withdraw', 'approve', 'reject'])
  })

  it('每个动作都有非空中文 label', () => {
    for (const d of REVIEW_DECISIONS) {
      expect(REVIEW_DECISION_LABELS[d].trim().length).toBeGreaterThan(0)
    }
  })

  it('isReviewDecision 守卫', () => {
    expect(isReviewDecision('submit')).toBe(true)
    expect(isReviewDecision('reject')).toBe(true)
    expect(isReviewDecision('publish')).toBe(false)
    expect(isReviewDecision(undefined)).toBe(false)
  })
})

describe('review-status/状态机 canTransitionReview', () => {
  it('未提交 -submit-> 待审核', () => {
    expect(canTransitionReview('not_submitted', 'submit')).toBe(true)
  })

  it('待审核 -withdraw-> 未提交', () => {
    expect(canTransitionReview('pending', 'withdraw')).toBe(true)
  })

  it('待审核 -approve-> 审核通过', () => {
    expect(canTransitionReview('pending', 'approve')).toBe(true)
  })

  it('待审核 -reject-> 已驳回', () => {
    expect(canTransitionReview('pending', 'reject')).toBe(true)
  })

  it('已驳回 -submit-> 待审核(重新准备后再次提交)', () => {
    expect(canTransitionReview('rejected', 'submit')).toBe(true)
  })

  it('审核通过后不可再提交/撤回/通过/驳回', () => {
    expect(canTransitionReview('approved', 'submit')).toBe(false)
    expect(canTransitionReview('approved', 'withdraw')).toBe(false)
    expect(canTransitionReview('approved', 'approve')).toBe(false)
    expect(canTransitionReview('approved', 'reject')).toBe(false)
  })

  it('未提交态不能被通过或驳回(未进入审核队列)', () => {
    expect(canTransitionReview('not_submitted', 'approve')).toBe(false)
    expect(canTransitionReview('not_submitted', 'reject')).toBe(false)
    expect(canTransitionReview('not_submitted', 'withdraw')).toBe(false)
  })

  it('待审核不能重复 submit', () => {
    expect(canTransitionReview('pending', 'submit')).toBe(false)
  })
})

describe('review-status/nextReviewStatus', () => {
  it('合法转移返回目标态', () => {
    expect(nextReviewStatus('not_submitted', 'submit')).toBe('pending')
    expect(nextReviewStatus('pending', 'withdraw')).toBe('not_submitted')
    expect(nextReviewStatus('pending', 'approve')).toBe('approved')
    expect(nextReviewStatus('pending', 'reject')).toBe('rejected')
    expect(nextReviewStatus('rejected', 'submit')).toBe('pending')
  })

  it('非法转移返回 null', () => {
    expect(nextReviewStatus('approved', 'submit')).toBeNull()
    expect(nextReviewStatus('not_submitted', 'approve')).toBeNull()
  })
})

describe('review-status/reviewDecisionToStatus', () => {
  it('approve -> approved, reject -> rejected', () => {
    expect(reviewDecisionToStatus('approve')).toBe('approved')
    expect(reviewDecisionToStatus('reject')).toBe('rejected')
  })
})
