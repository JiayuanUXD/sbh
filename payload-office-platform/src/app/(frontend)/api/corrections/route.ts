/**
 * P1 Task 6 纠错提交 API 路由（/api/corrections）
 *
 * 守护不变量：
 *   - 仅接受 POST + application/json + 同源请求；
 *   - 请求体视为 unknown，由 domain/corrections/schema 白名单收窄；
 *   - body 大小上限 20KB；
 *   - 幂等键 = sha256(requestId | targetType | targetSlug | category)，不含 PII；
 *   - 幂等键命中 -> 返回 { ok: true }，不重复建记录；
 *   - 限流：每 IP 每分钟 3 次（CORRECTION_RATE_LIMIT_CONFIG），429 + Retry-After；
 *   - 限流键与 reporterIpHash 用 hashIpForLog，不记录完整 IP；
 *   - 日志：buildCorrectionLogEntry，不含 description 正文、不含原始 IP；
 *   - 响应形状固定：{ ok: true } | { ok: false, errors: string[] } | { ok: false, error: string }
 *   - 不暴露记录 ID、内部错误。
 */

import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import {
  buildCorrectionLogEntry,
  computeCorrectionIdempotencyKey,
  hashIpForLog,
  validateCorrection,
  type CorrectionRequest,
} from '@/domain/corrections'
import { runDistributedRateLimit } from '@/lib/rate-limit-distributed'
import { createPgRateLimitDeps, type PoolLike } from '@/lib/rate-limit-pg'
import { CORRECTION_RATE_LIMIT_CONFIG as RATE_LIMIT_CONFIG } from '@/lib/rate-limit-config'
import { ratePruneRef } from './rate-limit-state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 每请求 body 最大字节数（FPD-P1 Task 6：20KB） */
const MAX_BODY_BYTES = 20 * 1024

/** 提取客户端 IP（CloudRun / 反代场景取首跳） */
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** 日级盐：UTC 日期字符串，同一天内进程内哈希稳定，跨天自动轮换。 */
function getDailySalt(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

/** 同源校验：Origin 必须与 Host 同源 */
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (!origin || !host) {
    // 同源请求可能不带 Origin（如直接 POST）；缺 Origin 时放行，依赖其他校验
    return true
  }
  try {
    const url = new URL(origin)
    return url.host === host
  } catch {
    return false
  }
}

/** Content-Type 校验：必须为 application/json */
function isJsonContentType(req: Request): boolean {
  return (req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error
  for (let depth = 0; depth < 5 && candidate && typeof candidate === 'object'; depth += 1) {
    const record = candidate as Record<string, unknown>
    const marker = [record.constraint, record.detail, record.message]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
      .toLowerCase()
    if (
      record.code === '23505' &&
      (marker.includes('information_corrections') || marker.includes('idempotency_key'))
    ) {
      return true
    }
    candidate = record.cause
  }
  return false
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now()
  const ip = clientIp(req)
  const dailySalt = getDailySalt()
  const ipHash = hashIpForLog(ip, dailySalt)
  // 限流键加 'correction:' 前缀，与询盘配额隔离（共享 inquiry_rate_limit 表）
  const rateKey = `correction:${ipHash}`

  // ----- 1. 限流（OPT-017 分布式，共享 inquiry_rate_limit 表） -----
  const payload = await getPayload({ config })
  const pgDeps = createPgRateLimitDeps(
    (payload.db as unknown as { pool: PoolLike }).pool,
  )
  const rate = await runDistributedRateLimit(
    pgDeps,
    RATE_LIMIT_CONFIG,
    rateKey,
    ratePruneRef,
  )
  if (rate.failedOpen) {
    payload.logger.warn({ rateKey }, 'rate_limit_store_unavailable_fail_open')
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    )
  }

  // ----- 2. 同源 / Content-Type / body 大小校验 -----
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  if (!isJsonContentType(req)) {
    return NextResponse.json(
      { ok: false, errors: ['invalid_content_type'] },
      { status: 415 },
    )
  }
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, errors: ['body_too_large'] },
      { status: 413 },
    )
  }

  // ----- 3. 解析 body（视为 unknown，由 schema 收窄） -----
  let body: unknown
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, errors: ['body_too_large'] },
        { status: 413 },
      )
    }
    body = raw === '' ? null : JSON.parse(raw)
  } catch {
    return NextResponse.json(
      { ok: false, errors: ['invalid_json'] },
      { status: 400 },
    )
  }

  // ----- 4. schema 白名单校验（domain/corrections/schema.ts） -----
  const result = validateCorrection(body)
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors },
      { status: 422 },
    )
  }
  const correction: CorrectionRequest = result.data

  // ----- 5. 计算幂等键（domain/corrections/idempotency.ts） -----
  const idempotencyKey = await computeCorrectionIdempotencyKey(
    correction.requestId,
    correction.targetType,
    correction.targetSlug,
    correction.category,
  )

  // ----- 6. 幂等检查：同键已存在 -> 返回 { ok: true }，不重复建记录 -----
  try {
    const existing = await payload.find({
      collection: 'information-corrections',
      where: { idempotencyKey: { equals: idempotencyKey } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      payload.logger.info(
        buildCorrectionLogEntry(correction, {
          idempotent: true,
          errorCode: null,
          durationMs: Date.now() - startedAt,
        }),
        'correction_idempotent_hit',
      )
      // 不暴露记录 ID
      return NextResponse.json({ ok: true })
    }
  } catch (e) {
    payload.logger.error({ err: e }, 'correction_idempotency_check_failed')
    // 幂等检查失败时继续创建：最坏情况下重复记录，但 unique 约束兜底
  }

  // ----- 7. 创建纠错记录（afterChange hook 自动发布 'correction.created' 到 Outbox） -----
  try {
    await payload.create({
      collection: 'information-corrections',
      data: {
        targetType: correction.targetType,
        targetSlug: correction.targetSlug,
        category: correction.category,
        description: correction.description,
        status: 'new',
        requestId: correction.requestId,
        idempotencyKey,
        reporterIpHash: ipHash,
      },
      overrideAccess: true,
    })

    payload.logger.info(
      buildCorrectionLogEntry(correction, {
        idempotent: false,
        errorCode: null,
        durationMs: Date.now() - startedAt,
      }),
      'correction_success',
    )
    // 不暴露记录 ID
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (isIdempotencyUniqueViolation(e)) {
      // 并发竞态：同键已写入，按幂等成功处理
      payload.logger.info(
        buildCorrectionLogEntry(correction, {
          idempotent: true,
          errorCode: null,
          durationMs: Date.now() - startedAt,
        }),
        'correction_idempotent_hit',
      )
      return NextResponse.json({ ok: true })
    }
    payload.logger.error({ err: e }, 'correction_create_failed')
    payload.logger.info(
      buildCorrectionLogEntry(correction, {
        idempotent: false,
        errorCode: 'server_error',
        durationMs: Date.now() - startedAt,
      }),
      'correction_error',
    )
    return NextResponse.json(
      { ok: false, error: 'server_error' },
      { status: 500 },
    )
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
