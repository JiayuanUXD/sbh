/**
 * P2 Task 2 路线摘要 API 路由（/api/routes）
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p2-guidance.md Task 2
 *           specs/work-items/FPD-P2-detail-guidance.md §4
 *
 * 守护不变量：
 *   - 仅接受 POST + application/json + 同源请求；
 *   - 请求体视为 unknown，由 validateRouteRequest 白名单收窄（origin/destination/mode/requestId）；
 *   - body 大小上限 10KB；
 *   - 限流：每 IP 每分钟 10 次（ROUTE_RATE_LIMIT_CONFIG），429 + Retry-After；
 *     限流键加 'route:' 前缀，与询盘/纠错配额隔离（共享 inquiry_rate_limit 表）；
 *   - provider 2500ms 超时；失败映射 502 { ok:false, error:'route_unavailable' }；
 *   - 响应只回 { ok:true, summary: RouteSummary }，绝不回传原始起点；
 *   - 日志绝不含请求 body、完整 URL、原始坐标；只记 mode/成功失败/耗时区间。
 */

import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import {
  createAmapRouteProvider,
  validateRouteRequest,
  LocationServiceError,
  type RouteRequest,
} from '@/domain/location-services'
import { runDistributedRateLimit, type PruneTimestampRef } from '@/lib/rate-limit-distributed'
import { createPgRateLimitDeps, type PoolLike } from '@/lib/rate-limit-pg'
import { ROUTE_RATE_LIMIT_CONFIG as RATE_LIMIT_CONFIG } from '@/lib/rate-limit-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 每请求 body 最大字节数（FPD-P2 Task 2：10KB） */
const MAX_BODY_BYTES = 10 * 1024

const ratePruneRef: PruneTimestampRef = { value: 0 }

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** 同源校验：Origin 必须与 Host 同源（缺 Origin 放行，依赖其他校验） */
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (!origin || !host) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function isJsonContentType(req: Request): boolean {
  return (req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')
}

/** 耗时区间桶（不记录精确毫秒） */
function durationBucket(ms: number): string {
  if (ms < 500) return '<500ms'
  if (ms < 1500) return '500-1500ms'
  if (ms < 2500) return '1500-2500ms'
  return '>=2500ms'
}

/**
 * 把全局 fetch 适配为 AmapRouteFetch 期望的最小响应形状。
 * 显式收窄类型，避免 `as never` 绕过检查。
 */
async function globalFetchAsAmap(
  url: string,
  init: { signal: AbortSignal; method: string },
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const res = await fetch(url, init)
  return { ok: res.ok, status: res.status, json: () => res.json() }
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now()

  // ----- 1. 限流（共享 inquiry_rate_limit 表，'route:' 前缀隔离） -----
  const payload = await getPayload({ config })
  const pgDeps = createPgRateLimitDeps((payload.db as unknown as { pool: PoolLike }).pool)
  const ip = clientIp(req)
  const rateKey = `route:${ip}`
  const rate = await runDistributedRateLimit(pgDeps, RATE_LIMIT_CONFIG, rateKey, ratePruneRef)
  if (rate.failedOpen) {
    payload.logger.warn({ endpoint: 'routes' }, 'rate_limit_store_unavailable_fail_open')
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    )
  }

  // ----- 2. 同源 / Content-Type / body 大小 -----
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  if (!isJsonContentType(req)) {
    return NextResponse.json({ ok: false, errors: ['invalid_content_type'] }, { status: 415 })
  }
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, errors: ['body_too_large'] }, { status: 413 })
  }

  // ----- 3. 解析 body（unknown，schema 收窄） -----
  let body: unknown
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, errors: ['body_too_large'] }, { status: 413 })
    }
    body = raw === '' ? null : JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, errors: ['invalid_json'] }, { status: 400 })
  }

  // ----- 4. schema 白名单校验 -----
  const result = validateRouteRequest(body)
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 })
  }
  const request: RouteRequest = result.data

  // ----- 5. 调 provider（起点仅在本次交互内存在，不落库不入日志） -----
  const key = process.env.AMAP_WEB_SERVICE_KEY ?? ''
  const provider = createAmapRouteProvider({ key, fetchImpl: globalFetchAsAmap })
  try {
    const summary = await provider.route({
      origin: request.origin,
      destination: request.destination,
      mode: request.mode,
    })
    // 日志只记 mode / 成功 / 耗时区间，绝不含坐标/URL/body
    payload.logger.info(
      { endpoint: 'routes', route_mode: request.mode, result: 'success', duration_bucket: durationBucket(Date.now() - startedAt) },
      'route_summary_success',
    )
    return NextResponse.json({ ok: true, summary })
  } catch (e) {
    const code = e instanceof LocationServiceError ? e.code : 'unknown'
    payload.logger.info(
      { endpoint: 'routes', route_mode: request.mode, result: 'error', error_code: code, duration_bucket: durationBucket(Date.now() - startedAt) },
      'route_summary_error',
    )
    return NextResponse.json({ ok: false, error: 'route_unavailable' }, { status: 502 })
  }
}

/** 其他方法禁止 */
export function GET(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

export function PUT(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

export function DELETE(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
