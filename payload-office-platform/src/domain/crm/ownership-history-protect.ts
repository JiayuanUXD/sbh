/**
 * 归属历史保护 hook（tasks.md M5.4/M5.8 / design §3.6 lead_ownership_history / R6, R8）
 *
 * lead_ownership_history 是**追加式不可改写**流水:分配 / 认领 / 转派 / 进入公海 / 回收
 * 各写一条记录,记录当时的 from/to 归属人与原因,不覆盖既往归属（design §3.6）。
 *
 * 本 hook 只在 create 时工作:
 *   - 校验 action 合法（OWNERSHIP_ACTIONS）。
 *   - 负向动作（进入公海 / 回收）必须填原因（requiresReason / R8 审计）。
 *   - ownership_status 由动作**单一推导**（ownershipStatusAfterAction）,不信任外部传值。
 *   - created_at 服务端权威落时刻。
 *   - 初始化 version=1。
 *
 * update 一律拒绝（ForbiddenError）。物理删除由 Collection access.delete 关闭。
 * 跨文档校验（经纪人容量、城市/团队匹配）在 assignment-policy.ts;写库+事件+审计在领域服务。
 * 无 React 依赖;create 分支为纯逻辑,测试直接调用（不经 payload）。
 */

import type { CollectionBeforeChangeHook } from 'payload'

import { ForbiddenError, InvalidOperationError } from '@/domain/shared/errors'
import {
  isOwnershipAction,
  ownershipStatusAfterAction,
  requiresReason,
  type OwnershipAction,
} from '@/domain/crm/ownership'

export const protectOwnershipHistory: CollectionBeforeChangeHook = async ({
  data,
  operation,
}) => {
  // 追加式不可改写:归属历史创建后不可修改（design §3.6）。
  if (operation === 'update') {
    throw new ForbiddenError({
      domain: 'crm',
      message: '归属历史不可修改',
      details: { reason: 'append_only' },
    })
  }

  const action = data?.action
  if (!isOwnershipAction(action)) {
    throw new InvalidOperationError({
      domain: 'crm',
      code: 'OWNERSHIP_ACTION_INVALID',
      message: '归属动作非法',
    })
  }

  // 负向动作（进入公海 / 回收）必须填原因（R8 审计）。
  if (
    requiresReason(action as OwnershipAction) &&
    (typeof data?.reason !== 'string' || data.reason.trim().length === 0)
  ) {
    throw new InvalidOperationError({
      domain: 'crm',
      code: 'OWNERSHIP_REASON_REQUIRED',
      message: '进入公海 / 回收必须填写原因',
    })
  }

  // ownership_status 由动作单一推导,不信任外部传入。
  data.ownershipStatus = ownershipStatusAfterAction(action as OwnershipAction)

  // created_at 由 Payload 内置 timestamps 权威落时刻,不信任外部传入。

  // 审计一致性字段:归属历史无后续更新,恒为 1。
  data.version = 1

  return data
}
