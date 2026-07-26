/**
 * CRM 手机号查重纯逻辑（tasks.md M5.3 / design §3.6 / R6 / M5 验收门）
 *
 * 手机号是查重键而非业务主键(design §3.6)。同一规范化手机号在 30 天窗口内再次进线,
 * 判为重复需求,并向运营提供三种明确处理路径:合并已有客户 / 创建新需求 / 取消。
 *
 * 纯逻辑不查库:调用方(领域服务)按规范化手机号预加载该号的全部客户历史线索后传入,
 * 这里只做窗口判定与候选客户选择。手机号规范化在 shared/phone.ts。
 */

import { DEDUP_WINDOW_DAYS } from './policy'

/** 三种处理路径(顺序即 UI 呈现顺序,验收门要求三选一)。 */
export const DEDUP_HANDLING_PATHS = ['merge_customer', 'new_demand', 'cancel'] as const
export type DedupHandlingPath = (typeof DEDUP_HANDLING_PATHS)[number]

/** 一条既有线索历史(同一规范化手机号名下),仅查重所需最小字段。 */
export type LeadHistoryEntry = {
  leadId: number | string
  customerId: number | string
  /** 线索有效创建时刻(effective_created_at,回落 createdAt)。 */
  createdAt: Date
}

export type DedupInput = {
  phoneNormalized: string
  history: readonly LeadHistoryEntry[]
  now: Date
}

export type DedupResult = {
  /** 是否命中 30 天窗口内的重复需求。 */
  isDuplicate: boolean
  /** 最近一条历史线索对应的客户 id(供合并参考);无历史为 null。 */
  existingCustomerId: number | string | null
  /** 仅在 isDuplicate 时给出三种处理路径,否则空数组。 */
  handlingPaths: readonly DedupHandlingPath[]
}

const WINDOW_MS = DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000

/**
 * 判定新进线索是否为 30 天窗口内的重复需求。
 *
 * 规则:
 *   - 无历史 → 非重复,无候选客户。
 *   - 取历史中 createdAt 最近的一条作为候选客户(供合并参考,即使窗口外也返回)。
 *   - 若存在任一历史线索的 createdAt 落在 [now-30d, now] 闭区间内 → 重复,给出三种路径。
 */
export function detectDuplicateLead(input: DedupInput): DedupResult {
  const { history, now } = input
  if (history.length === 0) {
    return { isDuplicate: false, existingCustomerId: null, handlingPaths: [] }
  }

  const sorted = [...history].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const mostRecent = sorted[0]

  const windowStart = now.getTime() - WINDOW_MS
  const withinWindow = sorted.find(
    (e) => e.createdAt.getTime() >= windowStart && e.createdAt.getTime() <= now.getTime(),
  )

  if (withinWindow) {
    return {
      isDuplicate: true,
      existingCustomerId: withinWindow.customerId,
      handlingPaths: DEDUP_HANDLING_PATHS,
    }
  }

  return { isDuplicate: false, existingCustomerId: mostRecent.customerId, handlingPaths: [] }
}
