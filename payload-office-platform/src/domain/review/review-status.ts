/**
 * 房源审核状态机纯函数（tasks.md M4.4 / design §3.4 review_status / §3.5 状态机）
 *
 * 单一真源：审核状态枚举 + 中文标签 + 守卫 + 审核动作 + 状态转移判定。
 * 无 payload / React 依赖，可独立单测。跨文档校验（快照冻结、版本锁、
 * 权限门）在 review-transition.ts / listing-review-protect.ts / endpoints。
 *
 * 状态机（design §3.5）：
 *   未提交 not_submitted --submit-->  待审核 pending
 *   待审核 pending       --withdraw--> 未提交 not_submitted
 *   待审核 pending       --approve-->  审核通过 approved
 *   待审核 pending       --reject-->   已驳回 rejected
 *   已驳回 rejected      --submit-->   待审核 pending（重新准备后再次提交）
 *
 * 审核通过为终态（再次上下架属发布轴 publication_status，不在审核轴）。
 */

/** 审核状态。 */
export const REVIEW_STATUSES = ['not_submitted', 'pending', 'approved', 'rejected'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  not_submitted: '未提交',
  pending: '待审核',
  approved: '审核通过',
  rejected: '已驳回',
}

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && (REVIEW_STATUSES as readonly string[]).includes(value)
}

/** 审核动作（驱动状态转移的事件）。 */
export const REVIEW_DECISIONS = ['submit', 'withdraw', 'approve', 'reject'] as const
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number]

export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  submit: '提交审核',
  withdraw: '撤回',
  approve: '审核通过',
  reject: '驳回',
}

export function isReviewDecision(value: unknown): value is ReviewDecision {
  return typeof value === 'string' && (REVIEW_DECISIONS as readonly string[]).includes(value)
}

/** 合法转移表：from → 允许的动作 → to。缺项即非法。 */
const TRANSITIONS: Record<ReviewStatus, Partial<Record<ReviewDecision, ReviewStatus>>> = {
  not_submitted: { submit: 'pending' },
  pending: { withdraw: 'not_submitted', approve: 'approved', reject: 'rejected' },
  approved: {},
  rejected: { submit: 'pending' },
}

/** 当前审核态下能否执行该动作。 */
export function canTransitionReview(from: ReviewStatus, decision: ReviewDecision): boolean {
  return TRANSITIONS[from]?.[decision] !== undefined
}

/** 合法转移返回目标态，非法返回 null（供 endpoint 决定报错码）。 */
export function nextReviewStatus(from: ReviewStatus, decision: ReviewDecision): ReviewStatus | null {
  return TRANSITIONS[from]?.[decision] ?? null
}

/** 审核裁决动作（approve/reject）映射到目标态；仅供审核台裁决用。 */
export function reviewDecisionToStatus(decision: 'approve' | 'reject'): ReviewStatus {
  return decision === 'approve' ? 'approved' : 'rejected'
}
