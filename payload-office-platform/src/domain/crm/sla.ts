/**
 * CRM SLA 时限纯逻辑（tasks.md M5.4/M5.5/M5.8 / design §4.2 / R6 / R8）
 *
 * 三条时限全部以「成功事件时刻」为锚点、按秒偏移计算,存储 UTC——纯偏移不涉时区漂移
 * (自然日边界统计在别处用 time.ts 的北京时区工具,这里的期限是绝对时长)。无 payload/React
 * 依赖,可独立单测。参数来自 policy.ts(可版本化,线索落库时快照)。
 *
 *   - 首次有效跟进 SLA：分配/认领成功时刻 + FIRST_FOLLOW_UP_SLA_SECONDS(4h)。
 *   - 认领保护期：认领成功时刻 + CLAIM_PROTECTION_SECONDS(24h),内不进公海回收扫描。
 *   - 公海回收口径：末次有效跟进(或归属起点)+ PUBLIC_POOL_RECYCLE_SECONDS(72h) 无跟进则可回收。
 */

import {
  FIRST_FOLLOW_UP_SLA_SECONDS,
  PUBLIC_POOL_RECYCLE_SECONDS,
  CLAIM_PROTECTION_SECONDS,
} from './policy'

function addSeconds(base: Date, seconds: number): Date {
  return new Date(base.getTime() + seconds * 1000)
}

/** 首次有效跟进期限：分配/认领成功事件时刻 + 4h。 */
export function firstFollowUpDeadline(assignedAt: Date): Date {
  return addSeconds(assignedAt, FIRST_FOLLOW_UP_SLA_SECONDS)
}

/**
 * 是否已违反首次跟进 SLA。
 *
 * 已完成首次有效跟进(firstValidFollowUpAt 存在)则永不违约——SLA 已被满足。
 * 未跟进时,now 严格超过期限才算违约(恰好到期不算,给足整点窗口)。
 */
export function isFirstFollowUpBreached(
  assignedAt: Date,
  now: Date,
  firstValidFollowUpAt?: Date | null,
): boolean {
  if (firstValidFollowUpAt) return false
  return now.getTime() > firstFollowUpDeadline(assignedAt).getTime()
}

/** 认领保护期截止：认领成功时刻 + 24h。 */
export function claimProtectionUntil(claimedAt: Date): Date {
  return addSeconds(claimedAt, CLAIM_PROTECTION_SECONDS)
}

/** 是否仍在认领保护期内(边界:恰好到期视为已结束)。 */
export function isWithinClaimProtection(claimedAt: Date, now: Date): boolean {
  return now.getTime() < claimProtectionUntil(claimedAt).getTime()
}

/** 公海可回收时刻：基准时刻(末次有效跟进,无则归属起点)+ 72h。 */
export function publicPoolEligibleAt(lastActivityAt: Date): Date {
  return addSeconds(lastActivityAt, PUBLIC_POOL_RECYCLE_SECONDS)
}

/**
 * 是否可回收进公海。
 *
 * lastActivityAt：末次有效跟进时刻;无有效跟进时传归属起点。
 * 须严格超过 72h(恰好到期不回收)。若提供 claimedAt 且仍在 24h 认领保护期内,
 * 一律不可回收(保护期优先于回收扫描,tasks.md M5.8)。
 */
export function isPublicPoolRecyclable(
  lastActivityAt: Date,
  now: Date,
  opts?: { claimedAt?: Date | null },
): boolean {
  if (opts?.claimedAt && isWithinClaimProtection(opts.claimedAt, now)) return false
  return now.getTime() > publicPoolEligibleAt(lastActivityAt).getTime()
}
