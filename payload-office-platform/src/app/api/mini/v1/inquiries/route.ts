import { getPayload, type PayloadRequest } from 'payload'
import { NextResponse } from 'next/server'

import config from '@/payload.config'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import {
  findExistingInquiryResult,
  PublicInquirySubmissionError,
  resolveTrustedPublicInquiryCity,
  submitPublicInquiry,
  type InquiryRequest,
  type PublicInquiryDeps,
} from '@/domain/inquiry'
import {
  isAllowedDatabaseFingerprint,
  type AcceptanceRuntimeConfig,
} from '@/domain/mini-program/acceptance-attestation'
import {
  computeMiniAcceptanceListingInquiryIdempotencyKey,
  computeMiniListingInquiryIdempotencyKey,
} from '@/domain/mini-program/inquiry-idempotency'
import { validateMiniInquiryInput, type MiniInquiryInput } from '@/domain/mini-program/inquiry-schema'
import {
  verifyAcceptancePermitToken,
  type AcceptancePermitPayload,
} from '@/domain/mini-program/acceptance-permit'
import { runAcceptanceFencedTransaction } from '@/domain/mini-program/acceptance-transaction-fence'
import {
  MINI_CACHE_CONTROL,
  miniError,
  miniRequestId,
  miniWriteOk,
} from '@/domain/mini-program/response'
import { verifyAnonymousContextToken } from '@/domain/mini-program/session'
import {
  assertEffectiveBuilding,
  assertEffectiveListing,
  createSearchContext,
} from '@/domain/public-catalog'
import { isUniqueViolation } from '@/domain/shared/unique-violation'
import { getSiteConfig } from '@/lib/frontend/site-config'
import { probeAcceptanceDatabase } from '@/lib/mini-program/acceptance-db-probe'
import { readAcceptanceRuntimeConfig } from '@/lib/mini-program/acceptance-runtime-config'
import {
  readMiniSessionSigningRuntimeConfig,
  readMiniTrustedProxyRuntimeConfig,
  readMiniWechatRuntimeConfig,
} from '@/lib/mini-program/runtime-config'
import {
  createWechatGateway,
  WechatGatewayError,
  type WechatGatewayLogEntry,
} from '@/lib/mini-program/wechat-gateway'
import type { PoolLike } from '@/lib/rate-limit-pg'

import { readBoundedJsonBody } from '../bounded-json-body'
import { resolveMiniTrustedClientIp, runMiniRateLimit } from '../rate-limit-state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 16 * 1024
const MAX_BEARER_LENGTH = 4096
const ACCEPTANCE_PERMIT_HEADER = 'x-sbh-acceptance-permit'
const MINI_CAMPAIGN = Object.freeze({
  utm_source: 'wechat-mini-program',
  utm_medium: 'mini-program',
  utm_campaign: 'shanghai',
  utm_content: '',
  utm_term: '',
})

type PayloadClient = Awaited<ReturnType<typeof getPayload>>
type SafeLogger = Readonly<{
  info?(entry: unknown, event: string): void
  error?(entry: unknown, event: string): void
  warn?(entry: unknown, event?: string): void
}>
type AcceptanceInquiryCandidate = Readonly<{
  rawToken: string
  permit: AcceptancePermitPayload
  runtimeConfig: AcceptanceRuntimeConfig
}>
type AcceptanceInquiryGate =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'candidate'; value: AcceptanceInquiryCandidate }>
type AcceptanceReceipt = Readonly<{
  runId: string
  fixtureNamespace: string
  leadLocator: Readonly<{ collection: 'leads'; idempotencyKey: string }>
}>

function safeLog(
  logger: SafeLogger,
  level: 'info' | 'error' | 'warn',
  entry: unknown,
  event: string,
): void {
  try {
    logger[level]?.(entry, event)
  } catch {
    // 日志设施不能改变写请求结果，也不能把其异常带入响应。
  }
}

function response(
  body: unknown,
  status: number,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': MINI_CACHE_CONTROL,
      'X-Request-Id': requestId,
      ...headers,
    },
  })
}

function acceptanceUnavailable(requestId: string): Response {
  return new NextResponse('Not Found', {
    status: 404,
    headers: {
      'Cache-Control': MINI_CACHE_CONTROL,
      'X-Request-Id': requestId,
    },
  })
}

function readAcceptanceInquiryGate(request: Request): AcceptanceInquiryGate {
  if (!request.headers.has(ACCEPTANCE_PERMIT_HEADER)) return { kind: 'none' }

  const token = request.headers.get(ACCEPTANCE_PERMIT_HEADER) ?? ''
  if (!token || token.length > MAX_BEARER_LENGTH) return { kind: 'invalid' }

  const runtimeConfig = readAcceptanceRuntimeConfig()
  if (!runtimeConfig) return { kind: 'invalid' }

  const permit = verifyAcceptancePermitToken(token, runtimeConfig.permitSigningSecret)
  if (
    !permit ||
    permit.purpose !== 'acceptance-write' ||
    permit.gitSHA !== runtimeConfig.deploymentGitCommitSha ||
    permit.revision !== runtimeConfig.deploymentRevision ||
    !isAllowedDatabaseFingerprint(permit.dbFingerprint, runtimeConfig.dbFingerprintAllowlist)
  ) {
    return { kind: 'invalid' }
  }

  return { kind: 'candidate', value: { rawToken: token, permit, runtimeConfig } }
}

function failure(
  requestId: string,
  code: Parameters<typeof miniError>[0],
  message: string,
  status: number,
  fields?: readonly string[],
): Response {
  return response(miniError(code, message, requestId, fields), status, requestId)
}

function invalid(requestId: string, status: number, field: string): Response {
  return failure(requestId, 'invalid_request', '请求参数无效', status, [field])
}

function bearerToken(header: string | null):
  | Readonly<{ ok: true; token: string | null }>
  | Readonly<{ ok: false }> {
  if (header === null) return { ok: true, token: null }
  const match = /^Bearer ([^\s]+)$/.exec(header)
  if (!match || match[1].length > MAX_BEARER_LENGTH) return { ok: false }
  return { ok: true, token: match[1] }
}

function canonicalInquiry(
  input: MiniInquiryInput,
  phone: string,
  requestId: string,
): InquiryRequest {
  return {
    city: 'shanghai',
    requestId,
    name: `微信用户${phone.slice(-4)}`,
    phone,
    phoneNormalized: phone,
    company: null,
    message: null,
    listingSlug: input.listingSlug,
    buildingSlug: input.buildingSlug,
    targetType: 'listing',
    demand: {
      district: null,
      budget: null,
      area: null,
      moveInTime: input.moveInTime,
    },
    consent: input.consent,
    source: {
      pageType: 'listing',
      path: `/listings/${input.listingSlug}`,
      section: 'mobile-bar',
      currentFilters: null,
      campaign: MINI_CAMPAIGN,
    },
    priceSnapshot: input.priceSnapshot,
    activeSupplyGroup: null,
    viewingPreference: null,
  }
}

function populatedBuildingSlug(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const slug = (value as Record<string, unknown>).slug
  return typeof slug === 'string' && slug.length > 0 ? slug : null
}

async function findOwningBuildingSlug(
  payload: PayloadClient,
  listingSlug: string,
): Promise<string | null> {
  const result = await payload.find({
    collection: 'listings',
    where: { slug: { equals: listingSlug } },
    select: { building: true },
    limit: 1,
    depth: 1,
    overrideAccess: true,
  })
  return populatedBuildingSlug(result.docs[0]?.building)
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    tableName: 'leads',
    column: 'idempotency_key',
  })
}

function publicInquiryDeps(
  payload: PayloadClient,
  logger: SafeLogger,
  transactionReq?: PayloadRequest,
): PublicInquiryDeps {
  const transaction = transactionReq ? { req: transactionReq } : {}
  const resolveCity = async (slug: string) => {
    const city = await resolveCityContext(slug)
    return city ? { id: city.id, slug: city.slug } : null
  }
  return {
    findExistingLead: async (trustedKey) => {
      const result = await payload.find({
        collection: 'leads',
        where: { idempotencyKey: { equals: trustedKey } },
        limit: 1,
        depth: 0,
        ...transaction,
      })
      return result.docs[0] ?? null
    },
    resolveCity,
    assertEffectiveListing: async (slug, citySlug) =>
      assertEffectiveListing(slug, createSearchContext(citySlug)),
    assertEffectiveBuilding: async (slug, citySlug) =>
      assertEffectiveBuilding(slug, createSearchContext(citySlug)),
    findOwningBuildingSlug: (slug) => findOwningBuildingSlug(payload, slug),
    createLead: async (data) => {
      await payload.create({
        collection: 'leads',
        data: { ...data, name: data.name as string },
        ...transaction,
      })
    },
    isIdempotencyUniqueViolation,
    nowIso: () => new Date().toISOString(),
    onIdempotencyCheckError: () => {
      safeLog(logger, 'error', {
        operation: 'mini_inquiry_idempotency_precheck',
        errorCode: 'lookup_failed',
      }, 'mini_inquiry_idempotency_precheck_failed')
    },
    onListingBuildingResolutionError: () => {
      safeLog(logger, 'warn', {
        operation: 'mini_inquiry_listing_building_resolution',
        errorCode: 'lookup_failed',
      }, 'mini_inquiry_listing_building_resolution_failed')
    },
    onIdempotencyRaceReadError: () => {
      safeLog(logger, 'error', {
        operation: 'mini_inquiry_idempotency_race_read',
        errorCode: 'lookup_failed',
      }, 'mini_inquiry_idempotency_race_read_failed')
    },
  }
}

function accepted(
  requestId: string,
  acceptedExisting: boolean,
  targetResolution: 'listing' | 'building' | 'general',
  acceptance?: AcceptanceReceipt,
): Response {
  return response(miniWriteOk({
    accepted: true,
    acceptedExisting,
    targetResolution,
    ...(acceptance ? { acceptance } : {}),
  }, requestId), 200, requestId)
}

export async function POST(request: Request): Promise<Response> {
  const requestId = miniRequestId()
  const acceptanceGate = readAcceptanceInquiryGate(request)
  if (acceptanceGate.kind === 'invalid') return acceptanceUnavailable(requestId)

  const proxyConfig = readMiniTrustedProxyRuntimeConfig()
  const client = proxyConfig.ok
    ? resolveMiniTrustedClientIp(request, proxyConfig.value.trustedProxyHops)
    : { ok: false as const }
  if (!client.ok) {
    return failure(requestId, 'service_unavailable', '服务暂不可用，请稍后重试', 503)
  }
  let payload: PayloadClient
  try {
    payload = await getPayload({ config })
    const pool = (payload.db as unknown as { pool: PoolLike }).pool
    if (acceptanceGate.kind === 'candidate') {
      if (!pool) throw new Error('pool unavailable')
      const actual = await probeAcceptanceDatabase(
        pool,
        acceptanceGate.value.runtimeConfig.attestationSecret,
        acceptanceGate.value.runtimeConfig.dbFingerprintAllowlist,
      )
      if (actual.fingerprint !== acceptanceGate.value.permit.dbFingerprint) {
        return failure(requestId, 'invalid_request', '请求参数无效', 409)
      }
    }
    if (acceptanceGate.kind !== 'candidate') {
      const rate = await runMiniRateLimit(
        client.clientIp,
        'mini-inquiry',
        pool,
      )
      if (!rate.allowed) {
        if (rate.storeFailed) {
          return failure(requestId, 'service_unavailable', '服务暂不可用，请稍后重试', 503)
        }
        return response(
          miniError('rate_limited', '请求过于频繁，请稍后重试', requestId),
          429,
          requestId,
          { 'Retry-After': String(rate.retryAfterSeconds) },
        )
      }
    }
  } catch {
    return failure(requestId, 'service_unavailable', '服务暂不可用，请稍后重试', 503)
  }

  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? ''
  if (contentType !== 'application/json') {
    return invalid(requestId, 415, 'invalid_content_type')
  }
  const body = await readBoundedJsonBody(request, MAX_BODY_BYTES)
  if (!body.ok) {
    return invalid(
      requestId,
      body.error === 'body_too_large' ? 413 : 400,
      body.error,
    )
  }

  let siteConfig: ReturnType<typeof getSiteConfig>
  try {
    siteConfig = getSiteConfig()
  } catch {
    return failure(requestId, 'service_unavailable', '服务暂不可用，请稍后重试', 503)
  }
  const parsed = validateMiniInquiryInput(body.value, siteConfig.privacyPolicyVersion)
  if (!parsed.ok) return invalid(requestId, 422, parsed.errors[0] ?? 'invalid_body')

  if (
    acceptanceGate.kind === 'candidate' &&
    (
      acceptanceGate.value.permit.submissionRequestId !== parsed.data.submissionRequestId ||
      acceptanceGate.value.permit.listingSlug !== parsed.data.listingSlug ||
      parsed.data.phone === null
    )
  ) {
    return acceptanceUnavailable(requestId)
  }

  const authorization = bearerToken(request.headers.get('authorization'))
  if (!authorization.ok) {
    return failure(requestId, 'session_invalid', '匿名会话已失效，请重试', 401)
  }
  if (authorization.token !== null) {
    const signingConfig = readMiniSessionSigningRuntimeConfig()
    if (!signingConfig.ok) {
      return failure(requestId, 'service_unavailable', '服务暂不可用，请稍后重试', 503)
    }
    const verification = verifyAnonymousContextToken(authorization.token, {
      signingSecret: signingConfig.value.sessionSigningSecret,
      now: () => Date.now(),
    })
    if (!verification.ok) {
      return failure(requestId, 'session_invalid', '匿名会话已失效，请重试', 401)
    }
  }

  const logger = payload.logger as unknown as SafeLogger
  const idempotencyKey = acceptanceGate.kind === 'candidate'
    ? await computeMiniAcceptanceListingInquiryIdempotencyKey(
        acceptanceGate.value.permit.runId,
        parsed.data.submissionRequestId,
        parsed.data.listingSlug,
      )
    : await computeMiniListingInquiryIdempotencyKey(
        parsed.data.submissionRequestId,
        parsed.data.listingSlug,
      )
  const acceptanceReceipt: AcceptanceReceipt | undefined = acceptanceGate.kind === 'candidate'
    ? {
        runId: acceptanceGate.value.permit.runId,
        fixtureNamespace: acceptanceGate.value.permit.fixtureNamespace,
        leadLocator: { collection: 'leads', idempotencyKey },
      }
    : undefined

  if (acceptanceGate.kind === 'candidate') {
    const candidate = acceptanceGate.value
    const acceptancePhone = parsed.data.phone
    if (!acceptancePhone || !acceptanceReceipt) return acceptanceUnavailable(requestId)
    const inquiry = canonicalInquiry(parsed.data, acceptancePhone, requestId)
    try {
      const fenced = await runAcceptanceFencedTransaction({
        payload,
        locator: idempotencyKey,
        verifyLeaseAtDatabaseTime: (dbNowMs) => {
          const permit = verifyAcceptancePermitToken(
            candidate.rawToken,
            candidate.runtimeConfig.permitSigningSecret,
            dbNowMs,
          )
          return permit &&
            permit.purpose === 'acceptance-write' &&
            permit.runId === candidate.permit.runId &&
            permit.submissionRequestId === parsed.data.submissionRequestId &&
            permit.listingSlug === parsed.data.listingSlug &&
            permit.fixtureNamespace === candidate.permit.fixtureNamespace &&
            permit.gitSHA === candidate.runtimeConfig.deploymentGitCommitSha &&
            permit.revision === candidate.runtimeConfig.deploymentRevision &&
            permit.dbFingerprint === candidate.permit.dbFingerprint &&
            permit.iat === candidate.permit.iat &&
            permit.exp === candidate.permit.exp &&
            permit.jti === candidate.permit.jti &&
            isAllowedDatabaseFingerprint(
              permit.dbFingerprint,
              candidate.runtimeConfig.dbFingerprintAllowlist,
            )
            ? permit
            : null
        },
        action: async ({ req }) => {
          const deps = publicInquiryDeps(payload, logger, req)
          try {
            const existing = await findExistingInquiryResult(idempotencyKey, deps)
            if (existing) {
              return {
                acceptedExisting: true,
                targetResolution: existing.targetResolution,
              } as const
            }
          } catch {
            safeLog(logger, 'error', {
              operation: 'mini_inquiry_idempotency_precheck',
              requestId,
              errorCode: 'lookup_failed',
            }, 'mini_inquiry_idempotency_precheck_failed')
            throw new Error('acceptance inquiry precheck failed')
          }

          const trustedCity = await resolveTrustedPublicInquiryCity(
            inquiry,
            'shanghai',
            deps,
          )
          const submission = await submitPublicInquiry({
            inquiry,
            trustedIdempotencyKey: idempotencyKey,
            defaultCity: 'shanghai',
            siteOrigin: siteConfig.siteOrigin,
            trustedCity,
            viewingPreference: null,
          }, deps)
          return {
            acceptedExisting: submission.idempotent,
            targetResolution: submission.targetResolution,
          } as const
        },
      })
      if (fenced.kind !== 'committed') {
        return failure(requestId, 'service_unavailable', '服务暂不可用，请稍后重试', 503)
      }
      safeLog(logger, 'info', {
        operation: 'mini_inquiry',
        requestId,
        acceptedExisting: fenced.value.acceptedExisting,
        targetResolution: fenced.value.targetResolution,
        errorCode: null,
      }, 'mini_inquiry_success')
      return accepted(
        requestId,
        fenced.value.acceptedExisting,
        fenced.value.targetResolution,
        acceptanceReceipt,
      )
    } catch (error) {
      const isCreateFailure = error instanceof PublicInquirySubmissionError
        && error.code === 'create_failed'
      safeLog(logger, 'error', {
        operation: 'mini_inquiry_submit',
        requestId,
        errorCode: isCreateFailure ? 'inquiry_submit_failed' : 'service_unavailable',
      }, 'mini_inquiry_submit_failed')
      return failure(
        requestId,
        isCreateFailure ? 'inquiry_submit_failed' : 'service_unavailable',
        isCreateFailure ? '提交失败，请重试' : '服务暂不可用，请稍后重试',
        503,
      )
    }
  }

  const deps = publicInquiryDeps(payload, logger)
  try {
    const existing = await findExistingInquiryResult(idempotencyKey, deps)
    if (existing) {
      safeLog(logger, 'info', {
        operation: 'mini_inquiry',
        requestId,
        acceptedExisting: true,
        targetResolution: existing.targetResolution,
        errorCode: null,
      }, 'mini_inquiry_success')
      return accepted(requestId, true, existing.targetResolution, acceptanceReceipt)
    }
  } catch {
    safeLog(logger, 'error', {
      operation: 'mini_inquiry_idempotency_precheck',
      requestId,
      errorCode: 'lookup_failed',
    }, 'mini_inquiry_idempotency_precheck_failed')
    return failure(requestId, 'service_unavailable', '服务暂不可用，请稍后重试', 503)
  }

  let phone = parsed.data.phone
  if (!phone) {
    const wechatConfig = readMiniWechatRuntimeConfig()
    if (!wechatConfig.ok) {
      return failure(requestId, 'service_unavailable', '服务暂不可用，请稍后重试', 503)
    }
    const gateway = createWechatGateway(wechatConfig.value, {
      fetchImpl: fetch,
      now: () => Date.now(),
      logger: {
        error(entry: WechatGatewayLogEntry) {
          safeLog(logger, 'error', { requestId, ...entry }, 'mini_wechat_gateway_error')
        },
      },
    })
    try {
      phone = (await gateway.exchangePhoneCode(parsed.data.phoneCode!)).phone
    } catch (error) {
      const consumed = error instanceof WechatGatewayError && new Set([
        'phone_code_invalid',
        'wechat_phone_code_rejected',
        'wechat_phone_rejected',
        'wechat_phone_invalid',
      ]).has(error.errorCode)
      const code = consumed ? 'phone_code_consumed' : 'service_unavailable'
      safeLog(logger, 'error', {
        operation: 'mini_inquiry_phone_exchange',
        requestId,
        errorCode: code,
      }, 'mini_inquiry_phone_exchange_failed')
      return failure(
        requestId,
        code,
        consumed ? '手机号授权已失效，请重试或手动填写' : '服务暂不可用，请稍后重试',
        consumed ? 409 : 503,
      )
    }
  }

  const inquiry = canonicalInquiry(parsed.data, phone, requestId)
  try {
    const trustedCity = await resolveTrustedPublicInquiryCity(
      inquiry,
      'shanghai',
      deps,
    )
    const submission = await submitPublicInquiry({
      inquiry,
      trustedIdempotencyKey: idempotencyKey,
      defaultCity: 'shanghai',
      siteOrigin: siteConfig.siteOrigin,
      trustedCity,
      viewingPreference: null,
    }, deps)
    safeLog(logger, 'info', {
      operation: 'mini_inquiry',
      requestId,
      acceptedExisting: submission.idempotent,
      targetResolution: submission.targetResolution,
      errorCode: null,
    }, 'mini_inquiry_success')
    return accepted(requestId, submission.idempotent, submission.targetResolution, acceptanceReceipt)
  } catch (error) {
    const isCreateFailure = error instanceof PublicInquirySubmissionError
      && error.code === 'create_failed'
    safeLog(logger, 'error', {
      operation: 'mini_inquiry_submit',
      requestId,
      errorCode: isCreateFailure ? 'inquiry_submit_failed' : 'service_unavailable',
    }, 'mini_inquiry_submit_failed')
    return failure(
      requestId,
      isCreateFailure ? 'inquiry_submit_failed' : 'service_unavailable',
      isCreateFailure ? '提交失败，请重试' : '服务暂不可用，请稍后重试',
      503,
    )
  }
}
