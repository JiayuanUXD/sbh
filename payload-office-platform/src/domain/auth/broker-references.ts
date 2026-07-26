/**
 * 经纪人未完成线索引用计数（tasks.md M2.5「停用前检查未完成线索并要求转派」/ R6）
 *
 * 口径：某经纪人当前负责、且尚未结束的线索数量。
 * 「未完成」= 现有 Leads.status 不在终态集合 {won, lost} 中。
 * 与 merchant-references 同构：依赖 payload.count（副作用），单测 mock count。
 *
 * M5 线索模型重构后（stage/ownership_status 分离），把 where 条件切到
 * ownership_status='assigned' + stage 非终态即可，本函数签名不变。
 */

import type { Payload, PayloadRequest, Where } from 'payload'

/** 线索终态：已成交 / 无效——处于这两态的线索不阻止经纪人停用 */
export const LEAD_TERMINAL_STATUSES = ['won', 'lost'] as const

export type BrokerLeadReport = {
  brokerId: number | string
  openLeads: number
  hasOpenLeads: boolean
}

/**
 * 统计某经纪人名下未完成（非终态）的线索数量。
 *
 * @param options.overrideAccess 停用保护是完整性不变量，须看到该经纪人全部在办线索，
 *                               传 true；「查看影响」按数据权限展示时传 false（默认）。
 */
export async function countBrokerOpenLeads(
  payload: Payload,
  brokerId: number | string,
  req?: PayloadRequest,
  options?: { overrideAccess?: boolean },
): Promise<BrokerLeadReport> {
  const overrideAccess = options?.overrideAccess ?? false
  const where: Where = {
    and: [
      { owner: { equals: brokerId } },
      { status: { not_in: [...LEAD_TERMINAL_STATUSES] } },
    ],
  }
  const res = await payload.count({
    collection: 'leads',
    where,
    overrideAccess,
    req,
  })
  return {
    brokerId,
    openLeads: res.totalDocs,
    hasOpenLeads: res.totalDocs > 0,
  }
}
