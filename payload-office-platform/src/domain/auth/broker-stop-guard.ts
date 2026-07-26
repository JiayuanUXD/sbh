/**
 * 经纪人停用守卫（tasks.md M2.5「停用前检查未完成线索并要求转派」/ R6）
 *
 * 不变量：employment_status 从 active → disabled 时，
 * 若该经纪人名下仍有未完成（非终态）线索，禁止停用，要求先转派。
 *
 * 与 merchant-stop-guard 同构：只在 active→disabled 这一次转换触发，
 * 用 overrideAccess:true 看到该经纪人全部在办线索（完整性不变量）。
 */

import type { CollectionBeforeChangeHook } from 'payload'
import { InvalidOperationError } from '@/domain/shared/errors'
import { countBrokerOpenLeads } from './broker-references'

export const protectBrokerStop: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (operation !== 'update' || !originalDoc) return data

  const was = originalDoc.employmentStatus
  const now = data?.employmentStatus
  // 仅拦截「在职 → 停用」这一次转换
  if (was === 'disabled' || now !== 'disabled') return data

  const report = await countBrokerOpenLeads(req.payload, originalDoc.id, req, {
    overrideAccess: true,
  })
  if (report.hasOpenLeads) {
    throw new InvalidOperationError({
      domain: 'auth',
      code: 'BROKER_HAS_OPEN_LEADS',
      message: `该经纪人仍有 ${report.openLeads} 条未完成线索，停用前必须先转派`,
      details: { openLeads: report.openLeads },
    })
  }

  return data
}
