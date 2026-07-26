import { describe, expect, it } from 'vitest'

import {
  firstFollowUpDeadline,
  isFirstFollowUpBreached,
  claimProtectionUntil,
  isWithinClaimProtection,
  publicPoolEligibleAt,
  isPublicPoolRecyclable,
} from '@/domain/crm/sla'
import {
  FIRST_FOLLOW_UP_SLA_SECONDS,
  PUBLIC_POOL_RECYCLE_SECONDS,
  CLAIM_PROTECTION_SECONDS,
} from '@/domain/crm/policy'

/**
 * M5.4/M5.5 SLA 纯逻辑单测（design §4.2 / R6 / R8 / M5 验收门）
 *
 * 三条时限,全部以「成功事件时刻」为锚点,按秒偏移计算,存储 UTC:
 *   - 首次有效跟进 SLA：分配/认领成功时刻 + 4h。
 *   - 认领保护期：认领成功时刻 + 24h,内不进公海回收扫描。
 *   - 公海回收口径：末次有效跟进(或归属起点)+ 72h 无有效跟进则可回收。
 *
 * 验收门:分配/认领成功事件时刻准确生成 4 小时首次跟进期限(不含时区漂移——纯偏移)。
 */

const ANCHOR = new Date('2026-07-26T00:00:00.000Z') // 北京时间 08:00

describe('crm-sla/首次有效跟进期限', () => {
  it('成功事件时刻 + 4h 精确期限', () => {
    const deadline = firstFollowUpDeadline(ANCHOR)
    expect(deadline.getTime()).toBe(ANCHOR.getTime() + FIRST_FOLLOW_UP_SLA_SECONDS * 1000)
    expect(deadline.toISOString()).toBe('2026-07-26T04:00:00.000Z')
  })

  it('未到期不算违约', () => {
    const deadline = firstFollowUpDeadline(ANCHOR)
    const now = new Date(deadline.getTime() - 1000)
    expect(isFirstFollowUpBreached(ANCHOR, now)).toBe(false)
  })

  it('恰好到期不算违约（含边界）', () => {
    const deadline = firstFollowUpDeadline(ANCHOR)
    expect(isFirstFollowUpBreached(ANCHOR, deadline)).toBe(false)
  })

  it('超过期限算违约', () => {
    const deadline = firstFollowUpDeadline(ANCHOR)
    const now = new Date(deadline.getTime() + 1000)
    expect(isFirstFollowUpBreached(ANCHOR, now)).toBe(true)
  })

  it('已完成首次跟进则永不违约（有 firstValidFollowUpAt）', () => {
    const late = new Date(ANCHOR.getTime() + 10 * 60 * 60 * 1000) // 10h 后才跟进,但已跟进
    expect(isFirstFollowUpBreached(ANCHOR, late, late)).toBe(false)
  })
})

describe('crm-sla/认领保护期', () => {
  it('认领成功时刻 + 24h', () => {
    const until = claimProtectionUntil(ANCHOR)
    expect(until.getTime()).toBe(ANCHOR.getTime() + CLAIM_PROTECTION_SECONDS * 1000)
  })

  it('保护期内', () => {
    const now = new Date(ANCHOR.getTime() + 23 * 60 * 60 * 1000)
    expect(isWithinClaimProtection(ANCHOR, now)).toBe(true)
  })

  it('保护期恰好结束(含边界视为已结束)', () => {
    const until = claimProtectionUntil(ANCHOR)
    expect(isWithinClaimProtection(ANCHOR, until)).toBe(false)
  })

  it('保护期后', () => {
    const now = new Date(ANCHOR.getTime() + 25 * 60 * 60 * 1000)
    expect(isWithinClaimProtection(ANCHOR, now)).toBe(false)
  })
})

describe('crm-sla/公海回收口径', () => {
  it('末次有效跟进 + 72h 可回收', () => {
    const at = publicPoolEligibleAt(ANCHOR)
    expect(at.getTime()).toBe(ANCHOR.getTime() + PUBLIC_POOL_RECYCLE_SECONDS * 1000)
  })

  it('72h 内不可回收', () => {
    const now = new Date(ANCHOR.getTime() + 71 * 60 * 60 * 1000)
    expect(isPublicPoolRecyclable(ANCHOR, now)).toBe(false)
  })

  it('恰好 72h 不可回收（须严格超过）', () => {
    const at = publicPoolEligibleAt(ANCHOR)
    expect(isPublicPoolRecyclable(ANCHOR, at)).toBe(false)
  })

  it('超过 72h 可回收', () => {
    const now = new Date(ANCHOR.getTime() + PUBLIC_POOL_RECYCLE_SECONDS * 1000 + 1000)
    expect(isPublicPoolRecyclable(ANCHOR, now)).toBe(true)
  })

  it('认领保护期覆盖回收判定：24h 内即使无跟进也不可回收', () => {
    // 归属起点即锚点,末次有效跟进为空 → 以归属起点为基准。
    // 保护期 24h 内 now,虽 lastValidFollowUpAt 为空但受保护。
    const now = new Date(ANCHOR.getTime() + 12 * 60 * 60 * 1000)
    expect(isPublicPoolRecyclable(ANCHOR, now, { claimedAt: ANCHOR })).toBe(false)
  })

  it('保护期后且超 72h 无跟进：可回收', () => {
    const now = new Date(ANCHOR.getTime() + PUBLIC_POOL_RECYCLE_SECONDS * 1000 + 1000)
    expect(isPublicPoolRecyclable(ANCHOR, now, { claimedAt: ANCHOR })).toBe(true)
  })
})
