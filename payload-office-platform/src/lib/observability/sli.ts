/**
 * SLI 快照聚合（OPT-018）
 *
 * 把"查 DB 取数"与"算比率/评级"分离：
 * - computeSliSnapshot 是纯函数，查询通过 SliQueryDeps 注入，便于单测。
 * - route 层负责构造 deps（payload.count 查 leads，raw SQL 查 inquiry_rate_limit）。
 *
 * 口径说明：
 * - inquiry_submissions_24h：leads 表近 24h createdAt 计数（成功落库的咨询）。
 * - inquiry_active_ips_current_window：inquiry_rate_limit 当前窗口行数（活跃 IP）。
 * - inquiry_rate_limited_ips_current_window：其中 count > max 的行数（已被限流的 IP）。
 * - inquiry_success_rate：当前窗口 leads 成功数 / rate_limit 总尝试数。
 *   样本为当前 1 分钟窗口，波动较大，但无需额外落库即可计算。
 */

import { rateSli, type SliSnapshot, type Rating } from './thresholds'

export interface RateLimitWindowStats {
  /** 当前窗口活跃 IP 数（表行数） */
  totalIps: number
  /** 当前窗口已被限流的 IP 数（count > max） */
  limitedIps: number
  /** 当前窗口所有 IP 的计数总和（总尝试次数） */
  sumCount: number
  /** 当前窗口起始时间戳 ms */
  windowStart: number
}

export interface SliQueryDeps {
  /** 统计 leads 表 createdAt >= sinceMs 的行数 */
  countLeadsSince(sinceMs: number): Promise<number>
  /** 统计 inquiry_rate_limit 当前窗口的聚合指标 */
  countRateLimitCurrentWindow(): Promise<RateLimitWindowStats>
  /** 当前时间戳 ms（注入便于测试） */
  now(): number
  /** 限流阈值 max（判断 IP 是否已被限流） */
  rateLimitMax: number
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export async function computeSliSnapshot(deps: SliQueryDeps): Promise<SliSnapshot> {
  const now = deps.now()
  const [submissions24h, rl] = await Promise.all([
    deps.countLeadsSince(now - ONE_DAY_MS),
    deps.countRateLimitCurrentWindow(),
  ])

  let successRate: number | null = null
  if (rl.sumCount > 0) {
    const successCurrent = await deps.countLeadsSince(rl.windowStart)
    // 理论上 successCurrent <= sumCount（每次成功都先经过限流计数）；
    // prune/对齐抖动可能短暂超 1，clamp 防御性处理。
    successRate = Math.min(1, successCurrent / rl.sumCount)
  }

  const rating: Rating | 'unknown' =
    successRate === null ? 'unknown' : rateSli('inquiry_success_rate', successRate)

  return {
    inquiry_submissions_24h: submissions24h,
    inquiry_rate_limited_ips_current_window: rl.limitedIps,
    inquiry_active_ips_current_window: rl.totalIps,
    inquiry_success_rate: successRate,
    ratings: { inquiry_success_rate: rating },
  }
}
