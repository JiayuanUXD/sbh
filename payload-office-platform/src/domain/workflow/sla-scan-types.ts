/**
 * SLA 扫描类型枚举（tasks.md M6.5 / design §8 / R6, R7）
 *
 * 单一真源：3 种 SLA 扫描类型，对应不同定时任务和扫描间隔。
 *
 * 业务不变量（AGENTS.md §10 / design §8）：
 *   - MVP-R1 SLA 扫描：每 15 分钟（首次跟进 + 公海回收）
 *   - 房源 30 天未有效维护扫描：每天北京时间 00:15
 *   - 固定同一 as_of 和 Asia/Shanghai 时间边界
 *   - 扫描幂等：相同 asOf 不重复扫描
 */

/** SLA 扫描类型 */
export const SLA_SCAN_TYPES = [
  'first-followup',
  'public-pool',
  'stale-maintenance',
] as const

export type SlaScanType = (typeof SLA_SCAN_TYPES)[number]

export const SLA_SCAN_TYPE_LABELS: Record<SlaScanType, string> = {
  'first-followup': '首次跟进扫描',
  'public-pool': '公海回收扫描',
  'stale-maintenance': '房源维护扫描',
}

export function isSlaScanType(value: unknown): value is SlaScanType {
  return (
    typeof value === 'string' &&
    (SLA_SCAN_TYPES as readonly string[]).includes(value)
  )
}

/**
 * SLA 违规类型（写入 'sla.breached' 事件的 payload.slaType 字段）。
 *
 * - first_followup：已分配但 4 小时未首次跟进
 * - claim_protection：分配后未在保护期内跟进
 * - reclaim：72 小时无有效跟进触发公海回收
 */
export const SLA_BREACH_TYPES = [
  'first_followup',
  'claim_protection',
  'reclaim',
] as const

export type SlaBreachType = (typeof SLA_BREACH_TYPES)[number]

export function isSlaBreachType(value: unknown): value is SlaBreachType {
  return (
    typeof value === 'string' &&
    (SLA_BREACH_TYPES as readonly string[]).includes(value)
  )
}
