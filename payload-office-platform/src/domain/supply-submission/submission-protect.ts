/**
 * 投放房源申请保护 hook
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.3 / §5.5
 *
 * 守护不变量：
 *   - create：强制 status='pending'、handledAt=null，忽略外部传入；
 *   - update：提交事实字段（楼盘名/地址/面积/租金/佣金/手机号/溯源/同意）不可改，恢复原值；
 *     只允许后台补录字段与流程字段变更；
 *   - status 流转到终态（converted/rejected/duplicate）时自动补 handledAt。
 *
 * 与 access 叠加：access.create 公开、access.update 需 supply_submission:manage、
 * access.delete=false；protect 在 beforeChange 兜底，挡 Local API overrideAccess 绕过。
 */

import type { CollectionBeforeChangeHook } from 'payload'

/** 提交事实字段：创建后不可改 */
const IMMUTABLE_FIELDS = [
  'buildingName',
  'address',
  'areaSqm',
  'rentAmount',
  'rentUnit',
  'commissionMonths',
  'contactPhone',
  'requestId',
  'idempotencyKey',
  'sourcePath',
  'sourceUrl',
  'consentAccepted',
  'consentPolicyVersion',
  'submitterIpHash',
] as const

/** 需要写 handledAt 的终态 */
const TERMINAL_STATUSES = new Set(['converted', 'rejected', 'duplicate'])

export const protectSupplySubmission: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
}) => {
  const next = (data ?? {}) as Record<string, unknown>

  if (operation === 'create') {
    return { ...next, status: 'pending', handledAt: null }
  }

  const prev = (originalDoc ?? null) as Record<string, unknown> | null
  const fixed: Record<string, unknown> = { ...next }
  if (prev) {
    for (const field of IMMUTABLE_FIELDS) {
      if (field in prev) fixed[field] = prev[field]
    }
  }

  const nextStatus = typeof fixed.status === 'string' ? fixed.status : null
  const prevStatus = prev && typeof prev.status === 'string' ? prev.status : null
  if (nextStatus && nextStatus !== prevStatus && TERMINAL_STATUSES.has(nextStatus)) {
    fixed.handledAt = new Date().toISOString()
  }

  return fixed
}
