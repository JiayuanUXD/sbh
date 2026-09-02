/**
 * 商户类指标查询适配器（tasks.md M7.3 / R7）
 *
 * 覆盖：
 *   - merchants.active
 *   - merchants.qualification_expiring（30 天内资质到期）
 *
 * 业务不变量：
 *   - 商户无 city 关联字段，城市过滤不应用于商户指标
 *     （builtin.ts 中 merchants.* 的 allowedScopeDims 不包含 city，sanitize 会丢弃）
 *   - **不能按 `deletedAt` 过滤**：Merchants 没有启用 trash（启用的只有 Listings /
 *     Buildings / Leads / Articles / Pages），Payload 会直接拒绝该路径并抛
 *     `The following path cannot be queried: deletedAt`，两个商户指标因此恒为
 *     `status=failed`。这是从 listing/lead/building 三个适配器复制过来时带上的——
 *     那三个 collection 确实有 trash。发现于 OPT-065 的浏览器走查：看板把失败卡
 *     渲染成占位而不是隐藏，错误原文直接显示在卡上。
 *   - 时间窗口按 Asia/Shanghai
 */

import type {
  MetricQueryAdapter,
  MetricScalarResult,
} from '../metric-types'

const DAY_MS = 24 * 60 * 60 * 1000

/** merchants.active：status=active */
export const countMerchantsActive: MetricQueryAdapter = async (ctx): Promise<MetricScalarResult> => {
  const value = await ctx.payload.count({
    collection: 'merchants',
    where: {
      status: { equals: 'active' },
    },
    overrideAccess: true,
  })
  return { kind: 'scalar', value, asOf: ctx.asOf.toISOString() }
}

/**
 * merchants.qualification_expiring：资质 30 天内即将过期。
 *
 * qualificationExpiredAt 在 [now, now+30d) 区间内。
 * 排除已过期（应进「过期」指标）和 null（无到期日，视为永不过期）。
 */
export const countMerchantsQualificationExpiring: MetricQueryAdapter = async (
  ctx,
): Promise<MetricScalarResult> => {
  const now = ctx.asOf
  const threshold = new Date(now.getTime() + 30 * DAY_MS)
  const value = await ctx.payload.count({
    collection: 'merchants',
    where: {
      qualificationExpiredAt: {
        greater_than_equal: now.toISOString(),
        less_than: threshold.toISOString(),
      },
    },
    overrideAccess: true,
  })
  return { kind: 'scalar', value, asOf: ctx.asOf.toISOString() }
}
