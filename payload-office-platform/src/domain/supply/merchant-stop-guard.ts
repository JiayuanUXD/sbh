/**
 * 商户停用保护 hook（tasks.md M2.4「启停影响确认」/ R2 §56）
 *
 * 语义（design R2）：商户被停用且仍有有效业务关联时,阻止直接停用,
 * 要求先完成影响确认/转派/供给冻结。仅在 active→disabled 转换时触发。
 *
 * M3.3 起 countMerchantReferences 登记了 building-merchant-relations,商户名下
 * 有当前有效关系时抛 MERCHANT_HAS_ACTIVE_RELATIONS 拦截停用,无则放行。
 */

import type { CollectionBeforeChangeHook } from 'payload'
import { InvalidOperationError } from '@/domain/shared/errors'
import { countMerchantReferences } from './merchant-references'

export const protectMerchantStop: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  // 仅拦截「启用 → 停用」的更新;创建/其他状态变更不涉及
  if (operation !== 'update' || !originalDoc) return data
  const was = originalDoc.status
  const now = data?.status
  if (was === 'disabled' || now !== 'disabled') return data

  // overrideAccess: true —— 完整性不变量,须统计全部有效关系
  const report = await countMerchantReferences(req.payload, originalDoc.id, req, {
    overrideAccess: true,
  })
  if (report.referenced) {
    throw new InvalidOperationError({
      domain: 'supply',
      code: 'MERCHANT_HAS_ACTIVE_RELATIONS',
      message: '该商户仍有有效供给关系，停用前请先完成影响确认与转派/供给冻结',
      details: {
        total: report.total,
        sources: report.sources.map((s) => ({ label: s.label, count: s.count })),
      },
    })
  }
  return data
}
