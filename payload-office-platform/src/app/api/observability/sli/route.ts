/**
 * SLI 快照端点（/api/observability/sli）（OPT-018）
 *
 * 暴露关键业务 SLI 供看板/告警消费：
 *   - inquiry_submissions_24h：近 24h 成功落库的咨询数
 *   - inquiry_active_ips_current_window：当前 1min 窗口活跃 IP 数
 *   - inquiry_rate_limited_ips_current_window：当前窗口已被限流的 IP 数
 *   - inquiry_success_rate：当前窗口成功率（leads 成功 / 限流总尝试）
 *   - ratings.inquiry_success_rate：good | needs-improvement | poor | unknown
 *
 * 鉴权（fail-closed）：
 *   - 生产环境必须配置 OBSERVABILITY_API_KEY，请求头 x-observability-key 必须匹配，否则 403；
 *   - 非生产环境未配 key 时放行（便于本地调试），配了则同样校验。
 *
 * 不暴露 PII：仅聚合计数与比率，无 IP、无用户输入。
 */

import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { computeSliSnapshot, type SliQueryDeps, type RateLimitWindowStats } from '@/lib/observability/sli'
import { INQUIRY_RATE_LIMIT_CONFIG } from '@/lib/rate-limit-config'
import { computeWindowStart } from '@/lib/rate-limit-distributed'
import type { PoolLike } from '@/lib/rate-limit-pg'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 校验观测端点访问凭证。生产 fail-closed，dev 未配 key 时放行。 */
function authorize(req: Request): boolean {
  const expected = process.env.OBSERVABILITY_API_KEY
  if (!expected) {
    // 未配 key：生产拒绝，非生产放行（本地调试）
    return process.env.NODE_ENV !== 'production'
  }
  const provided = req.headers.get('x-observability-key')
  if (provided && provided === expected) return true
  // 也接受 Authorization: Bearer <key>
  const auth = req.headers.get('authorization')
  if (auth && auth.startsWith('Bearer ') && auth.slice(7) === expected) return true
  return false
}

export async function GET(req: Request): Promise<Response> {
  if (!authorize(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  let payload: Awaited<ReturnType<typeof getPayload>>
  try {
    payload = await getPayload({ config })
  } catch {
    return NextResponse.json({ ok: false, error: 'payload_unavailable' }, { status: 503 })
  }

  const pool = (payload.db as unknown as { pool?: PoolLike }).pool
  if (!pool) {
    return NextResponse.json({ ok: false, error: 'db_pool_unavailable' }, { status: 503 })
  }

  const windowMs = INQUIRY_RATE_LIMIT_CONFIG.windowMs
  const max = INQUIRY_RATE_LIMIT_CONFIG.max

  const deps: SliQueryDeps = {
    now: () => Date.now(),
    rateLimitMax: max,
    async countLeadsSince(sinceMs) {
      const res = await payload.count({
        collection: 'leads',
        where: { createdAt: { greater_than_equal: new Date(sinceMs) } },
        overrideAccess: true,
      })
      return res.totalDocs
    },
    async countRateLimitCurrentWindow(): Promise<RateLimitWindowStats> {
      const windowStart = computeWindowStart(Date.now(), windowMs)
      const result = await pool.query({
        text: `
          SELECT
            COUNT(*)::int AS total_ips,
            COUNT(*) FILTER (WHERE count > $2)::int AS limited_ips,
            COALESCE(SUM(count), 0)::bigint AS sum_count
          FROM inquiry_rate_limit
          WHERE window_start = $1
        `,
        values: [windowStart, max],
      })
      const row = result.rows[0] ?? {}
      return {
        totalIps: Number(row.total_ips ?? 0),
        limitedIps: Number(row.limited_ips ?? 0),
        sumCount: Number(row.sum_count ?? 0),
        windowStart,
      }
    },
  }

  try {
    const snapshot = await computeSliSnapshot(deps)
    return NextResponse.json(
      { ok: true, snapshot, generated_at: new Date().toISOString() },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'X-Content-Type-Options': 'nosniff',
        },
      },
    )
  } catch {
    return NextResponse.json({ ok: false, error: 'sli_compute_failed' }, { status: 503 })
  }
}
