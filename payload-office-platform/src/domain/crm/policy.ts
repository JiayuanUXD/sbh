/**
 * CRM 运行时策略参数（MVP-R1 快照单一真源）—— tasks.md M5.4/M5.5/M5.8 / R1 / R6 / R8
 *
 * design §4.2 / requirements R1：分配、认领、转派、SLA、公海回收依赖一组可版本化的
 * 运行时参数。MVP 阶段固定为下列 R1 值,但**每条线索在分配/认领成功时必须快照当时的
 * 参数**（design §3.6 leads: runtime_policy_version + SLA 秒数字段快照）,使规则调整
 * 不回写既有线索——与 M4 供给关系「快照不回写」同源思想。
 *
 * 无 payload / React 依赖,可独立单测。时间计算在 sla.ts,额度校验在 assignment-policy.ts。
 */

/** 当前运行时策略版本号。参数变更时递增,线索快照记录生成时的版本。 */
export const RUNTIME_POLICY_VERSION = 'mvp-r1' as const

/** 每日认领上限（自然日,北京时间边界）。 */
export const DAILY_CLAIM_LIMIT = 20

/** 单经纪人活跃线索上限（未进入终态 converted/lost 且归属为本人的线索数）。 */
export const ACTIVE_LEAD_CAP = 100

/** 首次有效跟进 SLA：从分配/认领成功事件时刻起 4 小时。 */
export const FIRST_FOLLOW_UP_SLA_SECONDS = 4 * 60 * 60

/** 公海回收口径:连续 72 小时无有效跟进则可回收。 */
export const PUBLIC_POOL_RECYCLE_SECONDS = 72 * 60 * 60

/** 认领保护期:线索被认领后 24 小时内不进入公海回收扫描。 */
export const CLAIM_PROTECTION_SECONDS = 24 * 60 * 60

/** 手机号查重窗口:同号在 30 天内的新线索判为重复需求(tasks.md M5.3)。 */
export const DEDUP_WINDOW_DAYS = 30

/** 跟进纠错窗口:跟进记录创建后 24 小时内可追加修正记录(tasks.md M5.5,记录本身不可改)。 */
export const FOLLOWUP_CORRECTION_WINDOW_SECONDS = 24 * 60 * 60

/**
 * 线索归属/SLA 参数快照结构（写入 leads 的 SLA 秒数字段 + runtime_policy_version）。
 *
 * 分配/认领成功时由领域服务调用 snapshotRuntimePolicy() 生成并落库,后续参数调整不回写。
 */
export type RuntimePolicySnapshot = {
  runtimePolicyVersion: typeof RUNTIME_POLICY_VERSION
  dailyClaimLimit: number
  activeLeadCap: number
  firstFollowUpSlaSeconds: number
  publicPoolRecycleSeconds: number
  claimProtectionSeconds: number
}

/** 生成当前 MVP-R1 参数快照(值副本,便于随线索落库、脱离常量后仍稳定)。 */
export function snapshotRuntimePolicy(): RuntimePolicySnapshot {
  return {
    runtimePolicyVersion: RUNTIME_POLICY_VERSION,
    dailyClaimLimit: DAILY_CLAIM_LIMIT,
    activeLeadCap: ACTIVE_LEAD_CAP,
    firstFollowUpSlaSeconds: FIRST_FOLLOW_UP_SLA_SECONDS,
    publicPoolRecycleSeconds: PUBLIC_POOL_RECYCLE_SECONDS,
    claimProtectionSeconds: CLAIM_PROTECTION_SECONDS,
  }
}
