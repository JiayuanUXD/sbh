/**
 * 两步留电第二步：可选需求补充（POST /api/inquiries/demand）
 *
 * 委托找房首屏只采手机号（已建 Lead）；成功后用户可在此补充
 * 意向区域 / 面积 / 预算 / 期望入驻时间，更新到同一条 Lead。
 *
 * 守护不变量：
 *   - 仅接受 POST + application/json + 同源；
 *   - body 视为 unknown，由 validateDemandUpdate 白名单收窄；
 *   - 按 requestId + 标准化手机号定位 Lead（手机号即鉴权：只持有两者者可更新）；
 *   - 找不到匹配 Lead → 404 not_found（不泄露是否存在）；
 *   - budget/area/moveInTime 写入 Lead 同名文本字段；意向区域为自由文本，
 *     追加到 specialRequirements（Lead.district 是关系字段，前台静态页无法可靠解析）；
 *   - 只更新提供的字段，未提供的字段不动（部分更新）；
 *   - 限流复用 /api/inquiries 的每 IP 配额；
 *   - 响应固定 { ok: true } | { ok: false, error }。
 */

import { getPayload, type Payload } from 'payload'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import { validateDemandUpdate } from '@/domain/inquiry'
import { runDistributedRateLimit } from '@/lib/rate-limit-distributed'
import { createPgRateLimitDeps, type PoolLike } from '@/lib/rate-limit-pg'
import { INQUIRY_RATE_LIMIT_CONFIG as RATE_LIMIT_CONFIG } from '@/lib/rate-limit-config'
import { hashIpForLog } from '@/domain/inquiry'
import { ratePruneRef } from '../rate-limit-state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 16 * 1024

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

function getDailySalt(): string {
  return new Date().toISOString().slice(0, 10)
}

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

const DISTRICT_PREFIX = '意向区域：'

function buildSpecialRequirements(current: string | null | undefined, district: string | null): string | undefined {
  if (!district) return undefined
  const base = typeof current === 'string' && current.trim() ? current.replace(/\s+$/, '') : ''
  const suffix = `${DISTRICT_PREFIX}${district}；`
  return base ? `${base}\n${suffix}` : suffix
}

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req)
  const rateKey = hashIpForLog(ip, getDailySalt())

  const payload = await getPayload({ config })
  const pgDeps = createPgRateLimitDeps(
    (payload.db as unknown as { pool: PoolLike }).pool,
  )
  const rate = await runDistributedRateLimit(pgDeps, RATE_LIMIT_CONFIG, rateKey, ratePruneRef)
  if (rate.failedOpen) {
    payload.logger.warn({ rateKey }, 'demand_update_rate_limit_fail_open')
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    )
  }

  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  if (!isJsonContentType(req)) {
    return NextResponse.json({ ok: false, error: 'invalid_content_type' }, { status: 415 })
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'body_too_large' }, { status: 413 })
  }

  let body: unknown
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'body_too_large' }, { status: 413 })
    }
    body = raw === '' ? null : JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const result = validateDemandUpdate(body)
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 })
  }
  const update = result.data

  try {
    // overrideAccess：服务端按 requestId+phone 可信定位，绕过前台读访问与脱敏
    const existing = await payload.find({
      collection: 'leads',
      where: { requestId: { equals: update.requestId }, phone: { equals: update.phoneNormalized } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const lead = existing.docs[0]
    if (!lead) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (update.demand.budget) data.budget = update.demand.budget
    if (update.demand.area) data.area = update.demand.area
    if (update.demand.moveInTime) data.moveInTime = update.demand.moveInTime
    const specialRequirements = buildSpecialRequirements(
      lead.specialRequirements as string | null | undefined,
      update.demand.district,
    )
    if (specialRequirements) data.specialRequirements = specialRequirements

    if (Object.keys(data).length > 0) {
      await payload.update({
        collection: 'leads',
        id: lead.id,
        data,
        overrideAccess: true,
      })
    }

    payload.logger.info(
      {
        requestId: update.requestId,
        demandFields: Object.keys(data),
      },
      'demand_update_success',
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    payload.logger.error({ err: e }, 'demand_update_failed')
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 })
  }
}

export function GET(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}
