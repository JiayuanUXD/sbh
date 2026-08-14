/**
 * P1 Task 6 纠错记录保护 hook
 *
 * 守护不变量：
 *   - create：强制 status='new'，忽略外部传入（防止绕过 schema 直接指定处理状态）
 *   - update：append-only，事实字段（targetType/targetSlug/category/description/
 *     requestId/idempotencyKey/reporterIpHash）不可改，恢复原值；status 可由后台
 *     correction:manage 流转（triaged/resolved/rejected）
 *
 * 与 access 层叠加：access.update=correction:manage 限制后台，access.delete=false
 * 禁止删除；protect 在 beforeChange 兜底，挡 Local API overrideAccess 绕过。
 */

import type { CollectionBeforeChangeHook } from 'payload'

/** 事实字段：创建后不可改（append-only 审计轨迹） */
const IMMUTABLE_FIELDS = [
  'targetType',
  'targetSlug',
  'category',
  'description',
  'requestId',
  'idempotencyKey',
  'reporterIpHash',
] as const

export const protectInformationCorrection: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
}) => {
  const next = (data ?? {}) as Record<string, unknown>

  if (operation === 'create') {
    // 强制初始状态为 new，忽略外部传入
    return { ...next, status: 'new' }
  }

  // update：事实字段恢复原值，仅允许 status 流转
  const prev = (originalDoc ?? null) as Record<string, unknown> | null
  const fixed: Record<string, unknown> = { ...next }
  if (prev) {
    for (const field of IMMUTABLE_FIELDS) {
      if (field in prev) {
        fixed[field] = prev[field]
      }
    }
  }
  return fixed
}
