/**
 * 投放房源提交 API 路由（/api/supply-submissions）
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.5
 *
 * 守护不变量（与 /api/corrections、/api/inquiries 同构）：
 *   - 仅接受 POST + application/json + 同源请求；
 *   - 请求体视为 unknown，由 domain/supply-submission/schema 白名单收窄；
 *   - body 大小上限 16KB；
 *   - 幂等键 = sha256(requestId | phoneNormalized | buildingName)；命中 → 返回首次成功语义；
 *   - 限流：每 IP 每分钟 3 次，429 + Retry-After，不记录完整 IP；
 *   - 日志：buildSupplyLogEntry，不含手机号/楼盘名/地址/原始 IP；
 *   - 城市固定写入默认城市（MVP 单城，前台不采集）；
 *   - 不暴露记录 ID、内部错误。
 */

import { getPayload, type Payload } from 'payload'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import {
  buildSupplyLogEntry,
  computeSupplyIdempotencyKey,
  hashIpForLog,
  validateSupplySubmission,
  type SupplySubmissionRequest,
} from '@/domain/supply-submission'
import { runDistributedRateLimit } from '@/lib/rate-limit-distributed'
import { createPgRateLimitDeps } from '@/lib/rate-limit-pg'
import { SUPPLY_SUBMISSION_RATE_LIMIT_CONFIG as RATE_LIMIT_CONFIG } from '@/lib/rate-limit-config'
import { siteConfig } from '@/lib/frontend/site-config'
import { ratePruneRef } from './rate-limit-state'
import {
  extractPgPool,
  isStrictJsonContentType,
  resolveDefaultCityId,
} from './request-guards'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 每请求 body 最大字节数 */
const MAX_BODY_BYTES = 16 * 1024

/** 提取客户端 IP（CloudRun / 反代场景取首跳） */
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** 日级盐：UTC 日期字符串，同一天内进程内哈希稳定，跨天自动轮换。 */
function getDailySalt(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 同源校验：Origin 必须与 Host 同源 */
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
      (marker.includes('supply_submissions') || marker.includes('idempotency_key'))
    ) {
      return true
    }
    candidate = record.cause
  }
  return false
}

function logIdempotentSuccess(
  payload: Payload,
  submission: SupplySubmissionRequest,
  startedAt: number,
): Response {
  payload.logger.info(
    buildSupplyLogEntry(submission, {
      idempotent: true,
      errorCode: null,
      durationMs: Date.now() - startedAt,
    }),
    'supply_submission_idempotent_hit',
  )
  return NextResponse.json({ ok: true })
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now()
  const ip = clientIp(req)
  const ipHash = hashIpForLog(ip, getDailySalt())
  // 限流键加 'supply:' 前缀，与询盘/纠错配额隔离（共享 inquiry_rate_limit 表）
  const rateKey = `supply:${ipHash}`

  // ----- 1. 限流 -----
  // This dedicated CloudRun / Next process owns the Payload Jobs auto-runner.
  // `cron: true` initializes it even when traffic only reaches this custom
  // route and no Payload REST endpoint has been requested yet.
  const payload = await getPayload({ config, cron: true })
  const pool = extractPgPool(payload.db)
  if (!pool) {
    payload.logger.error({ errorCode: 'rate_limit_pool_unavailable' }, 'supply_submission_pool_unavailable')
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 })
  }
  const pgDeps = createPgRateLimitDeps(pool)
  const rate = await runDistributedRateLimit(pgDeps, RATE_LIMIT_CONFIG, rateKey, ratePruneRef)
  if (rate.failedOpen) {
    payload.logger.warn({ rateKey }, 'rate_limit_store_unavailable_fail_open')
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
  if (!isStrictJsonContentType(req.headers.get('content-type'))) {
    return NextResponse.json({ ok: false, errors: ['invalid_content_type'] }, { status: 415 })
  }
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, errors: ['body_too_large'] }, { status: 413 })
  }

  // ----- 3. 解析 body -----
  let body: unknown
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, errors: ['body_too_large'] }, { status: 413 })
    }
    body = raw === '' ? null : JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, errors: ['invalid_json'] }, { status: 400 })
  }

  // ----- 4. schema 白名单校验 -----
  const result = validateSupplySubmission(body)
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 })
  }
  const submission: SupplySubmissionRequest = result.data

  // ----- 5. 幂等键 -----
  const idempotencyKey = await computeSupplyIdempotencyKey(
    submission.requestId,
    submission.phoneNormalized,
    submission.buildingName,
    submission.address,
  )

  // ----- 6. 幂等检查 -----
  try {
    const existing = await payload.find({
      collection: 'supply-submissions',
      where: { idempotencyKey: { equals: idempotencyKey } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      return logIdempotentSuccess(payload, submission, startedAt)
    }
  } catch {
    payload.logger.error(
      { errorCode: 'idempotency_check_failed' },
      'supply_submission_idempotency_check_failed',
    )
    // 幂等检查失败时继续创建：unique 约束兜底
  }

  // ----- 7. 创建申请 -----
  // 城市是可空的元数据字段（collection 未设 required，DB 里 city_id 允许 NULL）。
  // 解析失败只告警并留空，绝不因此拒绝一条有效的公开提交——否则生产库里那条
  // slug='shanghai' 的 location 被改名/停用就会让整个投放入口 500、线索全丢。
  // 城市可由审单顾问在后台补录。
  const cityId = await resolveDefaultCityId(payload, siteConfig.defaultCity)
  if (cityId === null) {
    payload.logger.warn(
      { errorCode: 'default_city_unavailable' },
      'supply_submission_default_city_unavailable',
    )
  }

  try {
    await payload.create({
      collection: 'supply-submissions',
      data: {
        buildingName: submission.buildingName,
        address: submission.address,
        areaSqm: submission.areaSqm,
        rentAmount: submission.rentAmount ?? undefined,
        rentUnit: submission.rentUnit ?? undefined,
        commissionMonths: submission.commissionMonths,
        contactPhone: submission.contactPhone,
        status: 'pending',
        city: cityId ?? undefined,
        requestId: submission.requestId,
        idempotencyKey,
        sourcePath: submission.source.path,
        sourceUrl: `${siteConfig.siteOrigin}${submission.source.path}`,
        consentAccepted: submission.consent.accepted,
        consentPolicyVersion: submission.consent.policyVersion,
        submitterIpHash: ipHash,
      },
      overrideAccess: true,
    })

    payload.logger.info(
      buildSupplyLogEntry(submission, {
        idempotent: false,
        errorCode: null,
        durationMs: Date.now() - startedAt,
      }),
      'supply_submission_success',
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (isIdempotencyUniqueViolation(e)) {
      return logIdempotentSuccess(payload, submission, startedAt)
    }
    payload.logger.error(
      { errorCode: 'create_failed' },
      'supply_submission_create_failed',
    )
    payload.logger.info(
      buildSupplyLogEntry(submission, {
        idempotent: false,
        errorCode: 'server_error',
        durationMs: Date.now() - startedAt,
      }),
      'supply_submission_error',
    )
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 })
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
