/**
 * 房源举报供给暂停效果（tasks.md M6.1-M6.2 / design §3.5 / R5, R8）
 *
 * 业务不变量（AGENTS.md §5.2）：
 *   - 有效举报暂停只影响统一有效供给谓词
 *   - 不改写审核状态（review_status）和发布状态（publication_status）
 *   - 举报导致的供给暂停通过 supply_visibility_hold=pending_recheck 表达，
 *     由统一有效供给谓词消费；本模块只产出"是否应暂停"的纯逻辑，
 *     不直接改写房源字段（M6.2 实现供给暂停时复用本函数）。
 *
 * 暂停规则（R5）：
 *   - 举报关闭且结论为 sustained（成立）→ 暂停供给
 *   - 举报关闭且结论为 partial（部分成立）→ 暂停供给（保守策略，部分成立也需复核）
 *   - 举报关闭且结论为 dismissed（不成立）→ 不暂停供给
 *   - 举报未关闭 → 不因结论暂停（结论仅 closed 时填）
 */

import type { ReportConclusion, ReportStatus } from './report-status'

/** 供给暂停副作用描述（供 M6.2 supply pause 服务消费）。 */
export interface SupplyPauseEffect {
  /** 是否应暂停房源有效供给 */
  shouldPause: boolean
  /** 暂停原因码（用于审计） */
  reason: 'sustained' | 'partial' | 'dismissed' | 'not-closed'
  /** 结论（透传，供审计日志记录） */
  conclusion: ReportConclusion | null
}

/**
 * 判断举报当前状态 + 结论是否应导致房源供给暂停。
 *
 * 仅基于举报自身字段推导，不读取房源当前状态。
 * 调用方（M6.2 supply pause 服务）负责：
 *   - 检查房源是否已被其他原因暂停（避免覆盖）
 *   - 写入 supply_visibility_hold=pending_recheck
 *   - 记录审计和事件
 */
export function shouldPauseSupply(
  status: ReportStatus,
  conclusion: ReportConclusion | null | undefined,
): boolean {
  // 只有 closed 状态才根据结论决定暂停
  if (status !== 'closed') return false
  if (conclusion === 'sustained' || conclusion === 'partial') return true
  return false
}

/**
 * 构建供给暂停副作用。
 *
 * 由 report-transition.ts 在状态转换时调用，推导本次转换对供给的影响。
 *
 * 注意：currentSupplyPaused 仅用于判断是否需要"恢复"动作；
 * 本函数只返回是否"应暂停"，恢复逻辑由 M6.2 的 supply pause 服务处理。
 */
export function buildSupplyPauseEffect(params: {
  status: ReportStatus
  conclusion: ReportConclusion | null
  currentSupplyPaused: boolean
}): SupplyPauseEffect {
  const { status, conclusion } = params
  const pause = shouldPauseSupply(status, conclusion)

  let reason: SupplyPauseEffect['reason']
  if (status !== 'closed') {
    reason = 'not-closed'
  } else if (conclusion === 'sustained') {
    reason = 'sustained'
  } else if (conclusion === 'partial') {
    reason = 'partial'
  } else {
    reason = 'dismissed'
  }

  return {
    shouldPause: pause,
    reason,
    conclusion,
  }
}
