/**
 * 审核记录保护 hook（tasks.md M4.4 / design §3.5 listing_reviews / R4, R8）
 *
 * listing_reviews 是**追加式不可变**审计流水：一条审核记录对应一次审核动作
 * （提交 / 撤回 / 通过 / 驳回 / 重新提交），一经写入即**不可修改、不可物理删除**
 * （design §3.5「审核记录不可修改或物理删除。」）。
 *
 * 因此本 hook 只在 create 时工作：
 *   - 校验 decision 合法（REVIEW_DECISIONS）。
 *   - 驳回必须填原因（assertReasonForDecision）。
 *   - task_status 由动作**单一推导**（taskStatusForDecision），不信任外部传值。
 *   - 若带 snapshot，则服务端重算确定性 snapshot_hash（computeSnapshotHash），
 *     不信任客户端提交的哈希。
 *   - 初始化 version=1（审核记录本身无后续更新，仅留作审计一致性字段）。
 *
 * update 一律拒绝（ForbiddenError）。物理删除由 Collection access.delete 关闭。
 * 无 React 依赖；create 分支为纯逻辑，测试直接调用（不经 payload）。
 */

import type { CollectionBeforeChangeHook } from 'payload'

import { ForbiddenError, InvalidOperationError } from '@/domain/shared/errors'
import { isReviewDecision, type ReviewDecision } from '@/domain/review/review-status'
import {
  assertReasonForDecision,
  computeSnapshotHash,
  taskStatusForDecision,
  type ListingReviewSnapshot,
} from '@/domain/review/review-transition'

export const protectListingReview: CollectionBeforeChangeHook = async ({
  data,
  operation,
}) => {
  // 追加式不可变:审核记录创建后不可修改（design §3.5）。
  if (operation === 'update') {
    throw new ForbiddenError({
      domain: 'review',
      message: '审核记录不可修改',
      details: { reason: 'append_only' },
    })
  }

  const decision = data?.decision
  if (!isReviewDecision(decision)) {
    throw new InvalidOperationError({
      domain: 'review',
      code: 'REVIEW_DECISION_INVALID',
      message: '审核动作非法',
    })
  }

  // 驳回必须填原因（与 endpoint 复用同一门槛）。
  assertReasonForDecision(decision as ReviewDecision, data?.reason)

  // task_status 由动作单一推导,不信任外部传入。
  data.taskStatus = taskStatusForDecision(decision as ReviewDecision)

  // 带快照则服务端重算哈希,不信任客户端提交的哈希。
  if (data.snapshot && typeof data.snapshot === 'object') {
    data.snapshotHash = computeSnapshotHash(data.snapshot as ListingReviewSnapshot)
  }

  // 审计一致性字段:审核记录无后续更新,恒为 1。
  data.version = 1

  return data
}
