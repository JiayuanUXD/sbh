/**
 * 跟进记录保护 hook（tasks.md M5.5 / design §3.6 follow_ups / R6, R8 / M5 验收门）
 *
 * follow_ups 是**追加式不可变**流水：一条记录对应一次跟进动作,一经写入即**不可修改、
 * 不可物理删除**（design §3.6「跟进记录不可物理删除；24 小时纠错通过追加修正记录实现」）。
 *
 * 因此本 hook 只在 create 时工作:
 *   - 复用 isValidFollowUp 校验方式/结果枚举、内容必填、"已推荐"必须关联至少一套房源。
 *   - created_at 服务端权威落时刻,不信任外部传值。
 *   - 初始化 version=1(记录本身无后续更新)。
 *
 * update 一律拒绝（ForbiddenError）。物理删除由 Collection access.delete 关闭。
 * 关联房源是否属于统一有效供给由领域服务预先精筛后传入,本 hook 不查库。
 * 无 React 依赖;create 分支为纯逻辑,测试直接调用（不经 payload）。
 */

import type { CollectionBeforeChangeHook } from 'payload'

import { ForbiddenError, InvalidOperationError } from '@/domain/shared/errors'
import {
  isValidFollowUp,
  type FollowUpDraft,
  type FollowUpMethod,
  type FollowUpResult,
} from '@/domain/crm/follow-up'

/** 将 relationship 数组字段规整成 id 列表（Payload 可能是 id 或已 populate 的对象）。 */
function toListingIds(value: unknown): (number | string)[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'number' || typeof item === 'string') return item
      if (item && typeof item === 'object' && 'id' in item) {
        return (item as { id: number | string }).id
      }
      return null
    })
    .filter((id): id is number | string => id !== null)
}

export const protectFollowUp: CollectionBeforeChangeHook = async ({ data, operation }) => {
  // 追加式不可变:跟进记录创建后不可修改（design §3.6）。
  if (operation === 'update') {
    throw new ForbiddenError({
      domain: 'crm',
      message: '跟进记录不可修改',
      details: { reason: 'append_only' },
    })
  }

  const draft: FollowUpDraft = {
    method: data?.method as FollowUpMethod,
    result: data?.result as FollowUpResult,
    content: typeof data?.content === 'string' ? data.content : '',
    relatedListingIds: toListingIds(data?.relatedListings),
  }

  const validation = isValidFollowUp(draft)
  if (!validation.valid) {
    throw new InvalidOperationError({
      domain: 'crm',
      code: 'FOLLOWUP_INVALID',
      message: '跟进记录不合法',
      details: { errors: validation.errors },
    })
  }

  // created_at 由 Payload 内置 timestamps 权威落时刻,不信任外部传入。

  // 审计一致性字段:跟进记录无后续更新,恒为 1。
  data.version = 1

  return data
}
