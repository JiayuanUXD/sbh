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
 * 与 access 叠加：access.create 关闭、access.update 需 supply_submission:manage、
 * access.delete=false；转换动作在 beforeChange 再校验 manage + convert，挡带身份的
 * Local API overrideAccess 绕过；无身份的受信系统 Local API 调用保留维护语义。
 */

import type { CollectionBeforeChangeHook } from 'payload'
import { derivePermissionContextFromRequest, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { ForbiddenError } from '@/domain/shared/errors'

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

function relationshipId(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

function requiresConvertPermission(
  next: Record<string, unknown>,
  previous: Record<string, unknown> | null,
): boolean {
  const statusTransition = next.status === 'converted' && previous?.status !== 'converted'
  const listingChanged =
    'convertedListing' in next &&
    relationshipId(next.convertedListing) !== relationshipId(previous?.convertedListing)
  return statusTransition || listingChanged
}

export const protectSupplySubmission: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
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

  // A request with an authenticated actor remains permission-bound even when a
  // Local API caller passes overrideAccess=true. Actor-less Local API calls are
  // reserved for trusted system jobs and remain available for maintenance.
  if (requiresConvertPermission(fixed, prev) && req.user) {
    const permission = await derivePermissionContextFromRequest(req as RequestContext)
    if (
      !permission ||
      !hasOperationPermission(permission, 'supply_submission:manage') ||
      !hasOperationPermission(permission, 'supply_submission:convert')
    ) {
      throw new ForbiddenError({
        domain: 'auth',
        message: '缺少操作权限：supply_submission:convert',
        details: {
          requiredOperations: ['supply_submission:manage', 'supply_submission:convert'],
        },
      })
    }
  }

  const nextStatus = typeof fixed.status === 'string' ? fixed.status : null
  const prevStatus = prev && typeof prev.status === 'string' ? prev.status : null
  if (nextStatus && nextStatus !== prevStatus && TERMINAL_STATUSES.has(nextStatus)) {
    fixed.handledAt = new Date().toISOString()
  }

  return fixed
}
