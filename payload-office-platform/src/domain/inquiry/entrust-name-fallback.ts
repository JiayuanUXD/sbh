/**
 * 委托找房线索姓名兜底 hook
 *
 * 守护不变量：
 *   - 只在 sourcePageType='entrust' 且姓名为空时填充兜底值，不覆盖已有姓名；
 *   - 兜底值含手机号后四位，让后台一眼看出是零门槛渠道线索；
 *   - 不放宽 Leads.name 的 required，后台列表和跟进视图依赖它非空；
 *   - beforeValidate 阶段执行，早于字段必填校验；
 *   - 手机号缺失时退化为固定文案，绝不抛异常阻塞提交。
 */

import type { CollectionBeforeValidateHook } from 'payload'
import { normalizePhone, phoneLast4 } from '@/domain/shared/phone'

export const fillEntrustLeadName: CollectionBeforeValidateHook = ({ data }) => {
  const next = (data ?? {}) as Record<string, unknown>
  if (next.sourcePageType !== 'entrust') return next

  const existing = typeof next.name === 'string' ? next.name.trim() : ''
  if (existing) return next

  const phone = typeof next.phone === 'string' ? normalizePhone(next.phone) : ''
  const last4 = phone ? phoneLast4(phone) : ''
  return { ...next, name: last4 ? `未留姓名（${last4}）` : '未留姓名' }
}
