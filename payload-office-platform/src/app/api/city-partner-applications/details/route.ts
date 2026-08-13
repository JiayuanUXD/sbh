import { createHash } from 'node:crypto'

import { getPayload } from 'payload'
import { NextResponse } from 'next/server'

import config from '@/payload.config'
import { completePublicCityPartnerDetails } from '@/domain/city-partner-application/public-service'
import { runDistributedRateLimit } from '@/lib/rate-limit-distributed'
import { createPgRateLimitDeps } from '@/lib/rate-limit-pg'
import { SUPPLY_SUBMISSION_RATE_LIMIT_CONFIG } from '@/lib/rate-limit-config'
import {
  extractPgPool,
  isSameOrigin,
  isStrictJsonContentType,
  validateCityPartnerDetailsBody,
} from '../request-guards'
import { detailsRatePruneRef } from '../rate-limit-state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 16 * 1024

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown'
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

function dailyIpHash(req: Request): string {
  return createHash('sha256')
    .update(`${new Date().toISOString().slice(0, 10)}|${clientIp(req)}`, 'utf8')
    .digest('hex')
}

export async function POST(req: Request): Promise<Response> {
  const payload = await getPayload({ config, cron: true })
  const pool = extractPgPool(payload.db)
  if (!pool) {
    payload.logger.error({ errorCode: 'rate_limit_pool_unavailable' }, 'city_partner_details_pool_unavailable')
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 })
  }
  const decision = await runDistributedRateLimit(
    createPgRateLimitDeps(pool),
    SUPPLY_SUBMISSION_RATE_LIMIT_CONFIG,
    `city-partner:details:${dailyIpHash(req)}`,
    detailsRatePruneRef,
  )
  if (!decision.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
    )
  }
  if (decision.failedOpen) {
    payload.logger.warn({ errorCode: 'rate_limit_store_unavailable' }, 'city_partner_details_rate_limit_fail_open')
  }
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  if (!isStrictJsonContentType(req.headers.get('content-type'))) {
    return NextResponse.json({ ok: false, error: 'invalid_content_type' }, { status: 415 })
  }
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'body_too_large' }, { status: 413 })
  }

  let body: unknown
  try {
    const raw = await req.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'body_too_large' }, { status: 413 })
    }
    body = raw.length === 0 ? null : JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const validated = validateCityPartnerDetailsBody(body)
  if (!validated.ok) {
    return NextResponse.json({ ok: false, errors: validated.errors }, { status: 422 })
  }

  try {
    const result = await completePublicCityPartnerDetails({ payload, input: validated.data })
    if (result.kind === 'not_found') {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
    }
    if (result.kind === 'conflict') {
      return NextResponse.json({ ok: false, error: 'details_already_completed' }, { status: 409 })
    }
    const idempotent = result.kind === 'idempotent'
    payload.logger.info({ idempotent }, 'city_partner_details_success')
    return NextResponse.json({ ok: true, idempotent })
  } catch {
    payload.logger.error({ errorCode: 'details_failed' }, 'city_partner_details_failed')
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 })
  }
}

function methodNotAllowed(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  )
}

export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
