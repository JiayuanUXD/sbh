import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  events: [] as string[],
  rateKeys: [] as string[],
  rateCounts: new Map<string, number>(),
  rateStoreFails: false,
  getPayload: vi.fn(),
  createLocalReq: vi.fn(),
  payloadFind: vi.fn(),
  payloadCreate: vi.fn(),
  beginTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  transactionExecute: vi.fn(),
  transactionSessions: {} as Record<string, { db: { execute: ReturnType<typeof vi.fn> } }>,
  transactionIndex: 0,
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  readSigningConfig: vi.fn(),
  readProxyConfig: vi.fn(),
  readWechatConfig: vi.fn(),
  verifyToken: vi.fn(),
  exchangePhoneCode: vi.fn(),
  createWechatGateway: vi.fn(),
  resolveTrustedCity: vi.fn(),
  submitPublicInquiry: vi.fn(),
  resolveCityContext: vi.fn(),
  getSiteConfig: vi.fn(),
  readAcceptanceConfig: vi.fn(),
  verifyAcceptancePermitToken: vi.fn(),
  probeAcceptanceDatabase: vi.fn(),
}))

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, createLocalReq: io.createLocalReq, getPayload: io.getPayload }
})

vi.mock('@/lib/rate-limit-pg', () => ({
  createPgRateLimitDeps: () => ({
    acquire: async (key: string, windowStart: number) => {
      io.events.push('rate')
      io.rateKeys.push(key)
      if (io.rateStoreFails) throw new Error('rate-store-sensitive')
      const count = (io.rateCounts.get(key) ?? 0) + 1
      io.rateCounts.set(key, count)
      return { count, windowStart }
    },
    pruneExpired: async () => 0,
    countKeys: async () => io.rateCounts.size,
    keyExists: async (key: string) => io.rateCounts.has(key),
    now: () => 1_800_000_000_000,
  }),
}))

vi.mock('@/lib/mini-program/runtime-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mini-program/runtime-config')>()
  return {
    ...actual,
    readMiniSessionSigningRuntimeConfig: io.readSigningConfig,
    readMiniTrustedProxyRuntimeConfig: io.readProxyConfig,
    readMiniWechatRuntimeConfig: io.readWechatConfig,
  }
})

vi.mock('@/domain/mini-program/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/mini-program/session')>()
  return { ...actual, verifyAnonymousContextToken: io.verifyToken }
})

vi.mock('@/lib/mini-program/wechat-gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mini-program/wechat-gateway')>()
  return { ...actual, createWechatGateway: io.createWechatGateway }
})

vi.mock('@/domain/inquiry/public-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/inquiry/public-service')>()
  return {
    ...actual,
    resolveTrustedPublicInquiryCity: io.resolveTrustedCity,
    submitPublicInquiry: io.submitPublicInquiry,
  }
})

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  resolveCityContext: io.resolveCityContext,
}))

vi.mock('@/lib/frontend/site-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/frontend/site-config')>()
  return { ...actual, getSiteConfig: io.getSiteConfig }
})

vi.mock('@/lib/mini-program/acceptance-runtime-config', () => ({
  readAcceptanceRuntimeConfig: io.readAcceptanceConfig,
}))

vi.mock('@/domain/mini-program/acceptance-permit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/mini-program/acceptance-permit')>()
  return { ...actual, verifyAcceptancePermitToken: io.verifyAcceptancePermitToken }
})

vi.mock('@/lib/mini-program/acceptance-db-probe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mini-program/acceptance-db-probe')>()
  return { ...actual, probeAcceptanceDatabase: io.probeAcceptanceDatabase }
})

import { validateMiniInquiryInput } from '@/domain/mini-program/inquiry-schema'
import { acceptanceFixtureNamespace } from '@/domain/mini-program/acceptance-permit'
import { POST } from '@/app/api/mini/v1/inquiries/route'
import {
  __resetMiniRateLimitStateForTests,
  miniInquiryRatePruneRef,
  miniRateLimitKey,
  miniSessionRatePruneRef,
  resolveMiniTrustedClientIp,
} from '@/app/api/mini/v1/rate-limit-state'
import { hashIpForLog, PublicInquirySubmissionError } from '@/domain/inquiry'
import {
  INQUIRY_RATE_LIMIT_CONFIG,
  MINI_INQUIRY_RATE_LIMIT_CONFIG,
  MINI_SESSION_RATE_LIMIT_CONFIG,
} from '@/lib/rate-limit-config'
import { runDistributedRateLimit, type RateLimitDeps } from '@/lib/rate-limit-distributed'
import { WechatGatewayError } from '@/lib/mini-program/wechat-gateway'

const POLICY_VERSION = 'MVP-R1'
const SUBMISSION_ID = '9d40e795-51e3-4f06-84ab-30be09a5ed0c'
const ACCEPTANCE_TOKEN = 'acceptance-permit-sensitive-marker'
const ACCEPTANCE_RUN_ID = '550e8400-e29b-41d4-a716-446655440000'
const ACCEPTANCE_FIXTURE_NAMESPACE = acceptanceFixtureNamespace(ACCEPTANCE_RUN_ID)
const ACCEPTANCE_FINGERPRINT = 'b'.repeat(64)
const ACCEPTANCE_DB_NOW_MS = 1_800_000_000_123
const ACCEPTANCE_PAYLOAD = {
  version: 1 as const,
  purpose: 'acceptance-write' as const,
  runId: ACCEPTANCE_RUN_ID,
  submissionRequestId: SUBMISSION_ID,
  listingSlug: 'jingan-center-100-monthly',
  fixtureNamespace: ACCEPTANCE_FIXTURE_NAMESPACE,
  gitSHA: 'a'.repeat(40),
  revision: 'revision-1',
  dbFingerprint: ACCEPTANCE_FINGERPRINT,
  iat: 1_800_000_000_000,
  exp: 1_800_000_600_000,
  jti: Buffer.alloc(16, 7).toString('base64url'),
}
const ACCEPTANCE_CONFIG = {
  deploymentGitCommitSha: ACCEPTANCE_PAYLOAD.gitSHA,
  deploymentRevision: ACCEPTANCE_PAYLOAD.revision,
  attestationSecret: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
  operatorBootstrapSecret: Uint8Array.from({ length: 32 }, (_, index) => index + 33),
  permitSigningSecret: Uint8Array.from({ length: 32 }, (_, index) => index + 65),
  dbFingerprintAllowlist: [ACCEPTANCE_FINGERPRINT],
}
type AcceptanceReceiptForTest = Readonly<{
  runId: string
  fixtureNamespace: string
  leadLocator: Readonly<{ collection: 'leads'; idempotencyKey: string }>
}>

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    submissionRequestId: SUBMISSION_ID,
    listingSlug: 'jingan-center-100-monthly',
    buildingSlug: 'jingan-center',
    moveInTime: '2026-10',
    phone: '+86 138-0000-1111',
    consent: { accepted: true, policyVersion: POLICY_VERSION },
    priceSnapshot: {
      amount: 8.5,
      currency: 'CNY',
      period: 'day',
      unit: 'rmb-sqm-day',
    },
    ...overrides,
  }
}

function routeRequest(options: Readonly<{
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
}> = {}): Request {
  return new Request('https://api.example.test/api/mini/v1/inquiries', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'mini-inquiry-http-1',
      'x-real-ip': '192.0.2.200',
      'x-forwarded-for': '203.0.113.20',
      ...options.headers,
    },
    body: options.rawBody ?? JSON.stringify(options.body ?? validBody()),
  })
}

function chunkedOversizedRouteRequest(): Readonly<{
  request: Request
  wasCancelled(): boolean
  pullCount(): number
}> {
  let cancelled = false
  let pulls = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      if (pulls <= 4) controller.enqueue(new TextEncoder().encode('x'.repeat(6_000)))
      else controller.close()
    },
    cancel() {
      cancelled = true
    },
  })
  return {
    request: new Request('https://api.example.test/api/mini/v1/inquiries', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.20',
      },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }),
    wasCancelled: () => cancelled,
    pullCount: () => pulls,
  }
}

beforeEach(() => {
  io.events.length = 0
  io.rateKeys.length = 0
  io.rateCounts.clear()
  io.rateStoreFails = false
  for (const mock of [
    io.getPayload,
    io.createLocalReq,
    io.payloadFind,
    io.payloadCreate,
    io.beginTransaction,
    io.commitTransaction,
    io.rollbackTransaction,
    io.transactionExecute,
    io.loggerInfo,
    io.loggerError,
    io.loggerWarn,
    io.readSigningConfig,
    io.readProxyConfig,
    io.readWechatConfig,
    io.verifyToken,
    io.exchangePhoneCode,
    io.createWechatGateway,
    io.resolveTrustedCity,
    io.submitPublicInquiry,
    io.resolveCityContext,
    io.getSiteConfig,
    io.readAcceptanceConfig,
    io.verifyAcceptancePermitToken,
    io.probeAcceptanceDatabase,
  ]) mock.mockReset()
  io.transactionIndex = 0
  for (const key of Object.keys(io.transactionSessions)) delete io.transactionSessions[key]
  __resetMiniRateLimitStateForTests()

  io.payloadFind.mockImplementation(async () => {
    io.events.push('precheck')
    return { docs: [] }
  })
  io.createLocalReq.mockResolvedValue({ context: {} })
  io.transactionExecute.mockImplementation(async () => {
    const call = io.transactionExecute.mock.calls.length
    if (call % 2 === 1) {
      io.events.push('acceptance-lock')
      return { rows: [{ locked: true }] }
    }
    io.events.push('acceptance-clock')
    return { rows: [{ nowMs: String(ACCEPTANCE_DB_NOW_MS) }] }
  })
  io.beginTransaction.mockImplementation(async () => {
    const transactionID = `acceptance-tx-${++io.transactionIndex}`
    io.events.push('acceptance-begin')
    io.transactionSessions[transactionID] = { db: { execute: io.transactionExecute } }
    return transactionID
  })
  io.commitTransaction.mockImplementation(async (transactionID: string) => {
    io.events.push('acceptance-commit')
    delete io.transactionSessions[transactionID]
  })
  io.rollbackTransaction.mockImplementation(async (transactionID: string) => {
    io.events.push('acceptance-rollback')
    delete io.transactionSessions[transactionID]
  })
  io.getPayload.mockImplementation(async () => {
    io.events.push('payload-init')
    return {
      db: {
        pool: {},
        sessions: io.transactionSessions,
        beginTransaction: io.beginTransaction,
        commitTransaction: io.commitTransaction,
        rollbackTransaction: io.rollbackTransaction,
      },
      find: io.payloadFind,
      create: io.payloadCreate,
      logger: { info: io.loggerInfo, error: io.loggerError, warn: io.loggerWarn },
    }
  })
  io.getSiteConfig.mockReturnValue({
    siteOrigin: 'https://www.sbh.example',
    defaultCity: 'shanghai',
    privacyPolicyVersion: POLICY_VERSION,
  })
  io.readSigningConfig.mockReturnValue({
    ok: true,
    value: { sessionSigningSecret: Uint8Array.from({ length: 32 }, (_, index) => index + 1) },
  })
  io.readProxyConfig.mockReturnValue({ ok: true, value: { trustedProxyHops: 1 } })
  io.readWechatConfig.mockReturnValue({
    ok: true,
    value: {
      appId: 'wx1234567890abcdef',
      appSecret: '0123456789abcdef0123456789abcdef',
    },
  })
  io.verifyToken.mockImplementation(() => {
    io.events.push('verify')
    return {
      ok: true,
      context: {
        subject: 'anonymous-subject',
        jti: 'jti',
        purpose: 'anonymous-context',
        issuedAt: '2027-01-15T08:00:00.000Z',
        expiresAt: '2027-01-15T08:15:00.000Z',
      },
    }
  })
  io.exchangePhoneCode.mockImplementation(async () => {
    io.events.push('phone')
    return { phone: '13800001111' }
  })
  io.createWechatGateway.mockReturnValue({ exchangePhoneCode: io.exchangePhoneCode })
  io.resolveTrustedCity.mockImplementation(async () => {
    io.events.push('city')
    return { id: 1, slug: 'shanghai' }
  })
  io.submitPublicInquiry.mockImplementation(async () => {
    io.events.push('submit')
    return { idempotent: false, targetResolution: 'listing' }
  })
  io.resolveCityContext.mockResolvedValue({ id: 1, slug: 'shanghai' })
  io.readAcceptanceConfig.mockReturnValue(ACCEPTANCE_CONFIG)
  io.verifyAcceptancePermitToken.mockReturnValue(ACCEPTANCE_PAYLOAD)
  io.probeAcceptanceDatabase.mockImplementation(async () => {
    io.events.push('acceptance-probe')
    return {
      identity: { databaseName: 'sbh_staging', serverAddress: '10.0.0.4', serverPort: 5432 },
      fingerprint: ACCEPTANCE_FINGERPRINT,
    }
  })
})

describe('Mini inquiry schema', () => {
  it('白名单化并规范化手填手机号，不接收客户端来源或最终幂等键', () => {
    expect(validateMiniInquiryInput(validBody(), POLICY_VERSION)).toEqual({
      ok: true,
      data: {
        submissionRequestId: SUBMISSION_ID,
        listingSlug: 'jingan-center-100-monthly',
        buildingSlug: 'jingan-center',
        moveInTime: '2026-10',
        phoneCode: null,
        phone: '13800001111',
        consent: { accepted: true, policyVersion: POLICY_VERSION },
        priceSnapshot: {
          amount: 8.5,
          currency: 'CNY',
          period: 'day',
          unit: 'rmb-sqm-day',
        },
      },
    })
  })

  it('授权 code 与手填手机号严格二选一', () => {
    expect(validateMiniInquiryInput(validBody({ phone: undefined, phoneCode: 'phone-code' }), POLICY_VERSION))
      .toMatchObject({ ok: true, data: { phone: null, phoneCode: 'phone-code' } })
    expect(validateMiniInquiryInput(validBody({ phoneCode: 'phone-code' }), POLICY_VERSION))
      .toEqual({ ok: false, errors: ['phone_choice_invalid'] })
    expect(validateMiniInquiryInput(validBody({ phone: undefined }), POLICY_VERSION))
      .toEqual({ ok: false, errors: ['phone_choice_invalid'] })
  })

  it.each(['name', 'source', 'city', 'idempotencyKey', 'targetType', 'requestId']) (
    '拒绝顶层未知或服务端专属字段 %s',
    (field) => {
      expect(validateMiniInquiryInput(validBody({ [field]: 'forged' }), POLICY_VERSION))
        .toEqual({ ok: false, errors: ['invalid_body_fields'] })
    },
  )

  it.each([
    { field: 'consent', value: { accepted: true, policyVersion: POLICY_VERSION, role: 'admin' } },
    {
      field: 'priceSnapshot',
      value: {
        amount: 8.5,
        currency: 'CNY',
        period: 'day',
        unit: 'rmb-sqm-day',
        internalPrice: 1,
      },
    },
  ])('拒绝嵌套未知字段：$field', ({ field, value }) => {
    expect(validateMiniInquiryInput(validBody({ [field]: value }), POLICY_VERSION))
      .toMatchObject({ ok: false })
  })

  it('嵌套合同只接受精确自有字段，不从原型继承必填值', () => {
    const inheritedConsent = Object.create({ accepted: true, policyVersion: POLICY_VERSION })
    const inheritedPrice = Object.create({
      amount: 8.5,
      currency: 'CNY',
      period: 'day',
      unit: 'rmb-sqm-day',
    })

    expect(validateMiniInquiryInput(validBody({ consent: inheritedConsent }), POLICY_VERSION))
      .toEqual({ ok: false, errors: ['consent_invalid'] })
    expect(validateMiniInquiryInput(validBody({ priceSnapshot: inheritedPrice }), POLICY_VERSION))
      .toEqual({ ok: false, errors: ['price_snapshot_invalid'] })
  })

  it.each([
    { override: { submissionRequestId: 'low-entropy' }, error: 'submission_request_id_invalid' },
    { override: { listingSlug: undefined }, error: 'listing_slug_invalid' },
    { override: { listingSlug: 'Unsafe_Slug' }, error: 'listing_slug_invalid' },
    { override: { buildingSlug: 'Unsafe_Slug' }, error: 'building_slug_invalid' },
    { override: { moveInTime: 'x'.repeat(101) }, error: 'move_in_time_invalid' },
    { override: { phone: '12800001111' }, error: 'phone_invalid' },
    { override: { phone: undefined, phoneCode: '' }, error: 'phone_code_invalid' },
    {
      override: { consent: { accepted: false, policyVersion: POLICY_VERSION } },
      error: 'consent_required',
    },
    {
      override: { consent: { accepted: true, policyVersion: 'old-policy' } },
      error: 'consent_version_invalid',
    },
    {
      override: {
        priceSnapshot: {
          amount: Number.NaN,
          currency: 'CNY',
          period: 'day',
          unit: 'rmb-sqm-day',
        },
      },
      error: 'price_snapshot_invalid',
    },
  ])('稳定拒绝畸形输入：$error', ({ override, error }) => {
    expect(validateMiniInquiryInput(validBody(override), POLICY_VERSION))
      .toEqual({ ok: false, errors: [error] })
  })
})

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

describe('POST /api/mini/v1/inquiries', () => {
  it('无 Content-Length 的分块 body 超过 16KB 时立即取消流并不进入 schema/业务', async () => {
    const chunked = chunkedOversizedRouteRequest()
    const response = await POST(chunked.request)

    expect(response.status).toBe(413)
    expect(chunked.wasCancelled()).toBe(true)
    expect(chunked.pullCount()).toBeLessThanOrEqual(4)
    expect(io.getSiteConfig).not.toHaveBeenCalled()
    expect(io.payloadFind).not.toHaveBeenCalled()
  })

  it('缺失受信代理配置或合法链时 fail-closed，不初始化 Payload 或调用业务', async () => {
    io.readProxyConfig.mockReturnValueOnce({
      ok: false,
      errorCode: 'mini_program_config_unavailable',
    })
    const missingConfig = await POST(routeRequest())
    expect(missingConfig.status).toBe(503)
    expect(io.getPayload).not.toHaveBeenCalled()

    io.readProxyConfig.mockReturnValueOnce({ ok: true, value: { trustedProxyHops: 2 } })
    const shortChain = await POST(routeRequest({
      headers: { 'x-forwarded-for': '203.0.113.20' },
    }))
    expect(shortChain.status).toBe(503)
    expect(io.getPayload).not.toHaveBeenCalled()
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.exchangePhoneCode).not.toHaveBeenCalled()
  })

  it('服务端 HTTP requestId 与 submissionRequestId 隔离，客户 header 不回显也不落 Lead', async () => {
    const incoming = '13800001111.AppSecret.token-shape'
    const response = await POST(routeRequest({ headers: { 'x-request-id': incoming } }))
    const body = await json(response)
    const responseRequestId = (body.meta as { requestId: string }).requestId
    const [command] = io.submitPublicInquiry.mock.calls[0]!

    expect(responseRequestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(responseRequestId).toBe(response.headers.get('x-request-id'))
    expect(responseRequestId).not.toBe(incoming)
    expect(command.inquiry.requestId).toBe(responseRequestId)
    expect(command.inquiry.requestId).not.toBe(SUBMISSION_ID)
    expect(JSON.stringify(body)).not.toContain(SUBMISSION_ID)
  })

  it('手填手机号无需 Bearer 或任何微信配置，并构造固定 canonical InquiryRequest', async () => {
    const response = await POST(routeRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const responseRequestId = response.headers.get('x-request-id')
    expect(responseRequestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(responseRequestId).not.toBe('mini-inquiry-http-1')
    expect(await json(response)).toEqual({
      ok: true,
      data: { accepted: true, acceptedExisting: false, targetResolution: 'listing' },
      meta: { requestId: responseRequestId },
    })
    expect(io.events).toEqual(['payload-init', 'rate', 'precheck', 'city', 'submit'])
    expect(io.readSigningConfig).not.toHaveBeenCalled()
    expect(io.readWechatConfig).not.toHaveBeenCalled()
    expect(io.createWechatGateway).not.toHaveBeenCalled()
    expect(io.verifyToken).not.toHaveBeenCalled()
    expect(io.readAcceptanceConfig).not.toHaveBeenCalled()
    expect(io.verifyAcceptancePermitToken).not.toHaveBeenCalled()
    expect(io.probeAcceptanceDatabase).not.toHaveBeenCalled()
    expect(io.beginTransaction).not.toHaveBeenCalled()

    const [command] = io.submitPublicInquiry.mock.calls[0]!
    expect(command).toMatchObject({
      defaultCity: 'shanghai',
      siteOrigin: 'https://www.sbh.example',
      viewingPreference: null,
      inquiry: {
        city: 'shanghai',
        requestId: responseRequestId,
        name: '微信用户1111',
        phone: '13800001111',
        phoneNormalized: '13800001111',
        company: null,
        message: null,
        listingSlug: 'jingan-center-100-monthly',
        buildingSlug: 'jingan-center',
        targetType: 'listing',
        demand: { district: null, budget: null, area: null, moveInTime: '2026-10' },
        consent: { accepted: true, policyVersion: POLICY_VERSION },
        source: {
          pageType: 'listing',
          path: '/listings/jingan-center-100-monthly',
          section: 'mobile-bar',
          currentFilters: null,
          campaign: {
            utm_source: 'wechat-mini-program',
            utm_medium: 'mini-program',
            utm_campaign: 'shanghai',
            utm_content: '',
            utm_term: '',
          },
        },
        priceSnapshot: {
          amount: 8.5,
          currency: 'CNY',
          period: 'day',
          unit: 'rmb-sqm-day',
        },
        activeSupplyGroup: null,
        viewingPreference: null,
      },
    })
    expect(String(command.trustedIdempotencyKey)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('有效 acceptance permit 复用既有写链路并返回精确 Lead locator', async () => {
    const response = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))
    const body = await json(response)
    const [command] = io.submitPublicInquiry.mock.calls[0]!

    expect(response.status).toBe(200)
    expect(io.events).toEqual([
      'payload-init',
      'acceptance-probe',
      'acceptance-begin',
      'acceptance-lock',
      'acceptance-clock',
      'precheck',
      'city',
      'submit',
      'acceptance-commit',
    ])
    expect(io.rateKeys).toEqual([])
    expect(io.verifyAcceptancePermitToken).toHaveBeenNthCalledWith(
      1,
      ACCEPTANCE_TOKEN,
      ACCEPTANCE_CONFIG.permitSigningSecret,
    )
    expect(io.verifyAcceptancePermitToken).toHaveBeenNthCalledWith(
      2,
      ACCEPTANCE_TOKEN,
      ACCEPTANCE_CONFIG.permitSigningSecret,
      ACCEPTANCE_DB_NOW_MS,
    )
    expect(io.probeAcceptanceDatabase).toHaveBeenCalledWith(
      expect.any(Object),
      ACCEPTANCE_CONFIG.attestationSecret,
      ACCEPTANCE_CONFIG.dbFingerprintAllowlist,
    )
    expect(body).toMatchObject({
      ok: true,
      data: {
        accepted: true,
        acceptedExisting: false,
        acceptance: {
          runId: ACCEPTANCE_RUN_ID,
          fixtureNamespace: ACCEPTANCE_FIXTURE_NAMESPACE,
          leadLocator: {
            collection: 'leads',
            idempotencyKey: command.trustedIdempotencyKey,
          },
        },
      },
    })
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(ACCEPTANCE_TOKEN)
    expect(serialized).not.toContain(ACCEPTANCE_FINGERPRINT)
    expect(serialized).not.toContain('ownership')
    expect(JSON.stringify([
      ...io.loggerInfo.mock.calls,
      ...io.loggerError.mock.calls,
      ...io.loggerWarn.mock.calls,
    ])).not.toContain(ACCEPTANCE_TOKEN)
  })

  it('有效 acceptance 在共享限流存储失败时仍走既有写链路', async () => {
    io.rateStoreFails = true

    const response = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))

    expect(response.status).toBe(200)
    expect(io.events).toEqual([
      'payload-init',
      'acceptance-probe',
      'acceptance-begin',
      'acceptance-lock',
      'acceptance-clock',
      'precheck',
      'city',
      'submit',
      'acceptance-commit',
    ])
    expect(io.rateKeys).toEqual([])
    expect(io.submitPublicInquiry).toHaveBeenCalledOnce()
  })

  it.each([
    ['submissionRequestId', { submissionRequestId: '650e8400-e29b-41d4-a716-446655440000' }],
    ['listingSlug', { listingSlug: 'other-listing' }],
  ])('permit 与请求体 %s 不一致时在 transaction 和 Lead 前拒绝', async (_label, change) => {
    io.verifyAcceptancePermitToken.mockReturnValue({ ...ACCEPTANCE_PAYLOAD, ...change })

    const response = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))

    expect(response.status).toBe(404)
    expect(io.beginTransaction).not.toHaveBeenCalled()
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.payloadCreate).not.toHaveBeenCalled()
    expect(io.submitPublicInquiry).not.toHaveBeenCalled()
  })

  it.each(['acceptance-inspect', 'acceptance-recovery'] as const)(
    'inquiry 明确拒绝 %s scope，即使 verifier 测试替身错误放行',
    async (purpose) => {
      io.verifyAcceptancePermitToken.mockReturnValue({ ...ACCEPTANCE_PAYLOAD, purpose })

      const response = await POST(routeRequest({
        headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
      }))

      expect(response.status).toBe(404)
      expect(io.getPayload).not.toHaveBeenCalled()
      expect(io.beginTransaction).not.toHaveBeenCalled()
    },
  )

  it('acceptance 禁止一次性 phoneCode，在事务、Lead 与微信网络前 fail-closed', async () => {
    const response = await POST(routeRequest({
      body: validBody({ phone: undefined, phoneCode: 'must-not-consume' }),
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))

    expect(response.status).toBe(404)
    expect(io.beginTransaction).not.toHaveBeenCalled()
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.readWechatConfig).not.toHaveBeenCalled()
    expect(io.exchangePhoneCode).not.toHaveBeenCalled()
  })

  it('advisory lock busy 时回滚且两个预查、create 与微信网络均为零', async () => {
    io.transactionExecute.mockResolvedValueOnce({ rows: [{ locked: false }] })

    const response = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))

    expect(response.status).toBe(503)
    expect(io.rollbackTransaction).toHaveBeenCalledOnce()
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.payloadCreate).not.toHaveBeenCalled()
    expect(io.submitPublicInquiry).not.toHaveBeenCalled()
    expect(io.exchangePhoneCode).not.toHaveBeenCalled()
  })

  it('拿锁后以 PostgreSQL 时间复验 raw write permit，过期则零 Lead action', async () => {
    io.verifyAcceptancePermitToken.mockImplementation((
      _token: string,
      _secret: Uint8Array,
      now?: number,
    ) => now === undefined ? ACCEPTANCE_PAYLOAD : null)

    const response = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))

    expect(response.status).toBe(503)
    expect(io.verifyAcceptancePermitToken).toHaveBeenNthCalledWith(
      2,
      ACCEPTANCE_TOKEN,
      ACCEPTANCE_CONFIG.permitSigningSecret,
      ACCEPTANCE_DB_NOW_MS,
    )
    expect(io.rollbackTransaction).toHaveBeenCalledOnce()
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.payloadCreate).not.toHaveBeenCalled()
  })

  it('route 首次预查、domain 二次预查、create 与 unique-race reread 共用同一 transaction req', async () => {
    const requestsAtCall: unknown[] = []
    const transactionIDsAtCall: unknown[] = []
    io.payloadFind.mockImplementation(async (args) => {
      io.events.push('precheck')
      requestsAtCall.push(args.req)
      transactionIDsAtCall.push(args.req?.transactionID)
      return { docs: [] }
    })
    io.payloadCreate.mockImplementation(async (args) => {
      requestsAtCall.push(args.req)
      transactionIDsAtCall.push(args.req?.transactionID)
      return { id: 17 }
    })
    io.submitPublicInquiry.mockImplementation(async (command, deps) => {
      io.events.push('submit')
      await deps.findExistingLead(command.trustedIdempotencyKey)
      await deps.createLead({ name: '验收测试' })
      await deps.findExistingLead(command.trustedIdempotencyKey)
      return { idempotent: false, targetResolution: 'listing' }
    })

    const response = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))

    expect(response.status).toBe(200)
    expect(io.payloadFind).toHaveBeenCalledTimes(3)
    expect(io.payloadCreate).toHaveBeenCalledOnce()
    expect(requestsAtCall.every((req) => req === requestsAtCall[0])).toBe(true)
    expect(transactionIDsAtCall).toEqual(Array(4).fill('acceptance-tx-1'))
    expect(Object.prototype.hasOwnProperty.call(requestsAtCall[0], 'transactionID')).toBe(false)
  })

  it('transaction unavailable 或可观察 commit 失败时绝不返回 accepted', async () => {
    io.beginTransaction.mockResolvedValueOnce(null)
    const unavailable = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))
    expect(unavailable.status).toBe(503)
    expect(await json(unavailable)).toMatchObject({ error: { code: 'service_unavailable' } })
    expect(io.payloadFind).not.toHaveBeenCalled()

    io.commitTransaction.mockImplementationOnce(async () => {
      throw new Error(`commit ${ACCEPTANCE_TOKEN}`)
    })
    const commitUnknown = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))
    const serialized = JSON.stringify(await json(commitUnknown))
    expect(commitUnknown.status).toBe(503)
    expect(serialized).not.toContain(ACCEPTANCE_TOKEN)
    expect(io.submitPublicInquiry).toHaveBeenCalledOnce()
    expect(io.rollbackTransaction).not.toHaveBeenCalled()
  })

  it('同 run 同 submission/listing 的 locator 稳定，第二次命中 acceptedExisting', async () => {
    io.payloadFind
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [{ targetType: 'listing' }] })

    const first = await json(await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    })))
    const second = await json(await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    })))
    const firstData = first.data as { acceptedExisting: boolean; acceptance: AcceptanceReceiptForTest }
    const secondData = second.data as { acceptedExisting: boolean; acceptance: AcceptanceReceiptForTest }

    expect(firstData.acceptedExisting).toBe(false)
    expect(secondData.acceptedExisting).toBe(true)
    expect(secondData.acceptance.leadLocator).toEqual(firstData.acceptance.leadLocator)
    expect(io.submitPublicInquiry).toHaveBeenCalledOnce()
  })

  it('不同 run 的相同 submission/listing 使用不同 locator', async () => {
    const secondRunId = '650e8400-e29b-41d4-a716-446655440000'
    const secondToken = 'second-acceptance-permit-marker'
    const secondPermit = {
      ...ACCEPTANCE_PAYLOAD,
      runId: secondRunId,
      fixtureNamespace: acceptanceFixtureNamespace(secondRunId),
    }
    io.verifyAcceptancePermitToken.mockImplementation((token: string) => (
      token === secondToken ? secondPermit : ACCEPTANCE_PAYLOAD
    ))

    const first = await json(await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    })))
    const second = await json(await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': secondToken },
    })))
    const firstReceipt = (first.data as { acceptance: AcceptanceReceiptForTest }).acceptance
    const secondReceipt = (second.data as { acceptance: AcceptanceReceiptForTest }).acceptance

    expect(firstReceipt.runId).toBe(ACCEPTANCE_RUN_ID)
    expect(secondReceipt.runId).toBe(secondRunId)
    expect(firstReceipt.leadLocator.idempotencyKey).not.toBe(secondReceipt.leadLocator.idempotencyKey)
    expect(io.submitPublicInquiry.mock.calls.map(([command]) => command.trustedIdempotencyKey))
      .toEqual([
        firstReceipt.leadLocator.idempotencyKey,
        secondReceipt.leadLocator.idempotencyKey,
      ])
  })

  it('普通 staging Lead 与 acceptance run 使用不同幂等域', async () => {
    await POST(routeRequest())
    await POST(routeRequest({ headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN } }))

    const keys = io.submitPublicInquiry.mock.calls.map(([command]) => command.trustedIdempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('production/disabled 下伪造 acceptance header 同形 404 且零 Payload', async () => {
    io.readAcceptanceConfig.mockReturnValue(null)
    const response = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
    expect(io.verifyAcceptancePermitToken).not.toHaveBeenCalled()
    expect(io.getPayload).not.toHaveBeenCalled()
  })

  it('空、超长或验签失败的 acceptance permit 均在 Payload 前拒绝', async () => {
    const empty = await POST(routeRequest({ headers: { 'x-sbh-acceptance-permit': '' } }))
    expect(empty.status).toBe(404)

    const oversized = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': 'x'.repeat(4097) },
    }))
    expect(oversized.status).toBe(404)
    expect(io.readAcceptanceConfig).not.toHaveBeenCalled()

    io.verifyAcceptancePermitToken.mockReturnValue(null)
    const invalid = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))
    expect(invalid.status).toBe(404)
    expect(io.getPayload).not.toHaveBeenCalled()
    expect(io.probeAcceptanceDatabase).not.toHaveBeenCalled()
  })

  it.each([
    ['SHA', { gitSHA: 'c'.repeat(40) }],
    ['revision', { revision: 'other-revision' }],
    ['fingerprint', { dbFingerprint: 'c'.repeat(64) }],
  ])('已签名 permit 的 %s 与当前部署不匹配时零 Payload', async (_label, change) => {
    io.verifyAcceptancePermitToken.mockReturnValue({ ...ACCEPTANCE_PAYLOAD, ...change })
    const response = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))

    expect(response.status).toBe(404)
    expect(io.getPayload).not.toHaveBeenCalled()
    expect(io.probeAcceptanceDatabase).not.toHaveBeenCalled()
  })

  it('permit 数据库指纹与实际 probe 不一致时 409 且不消费限流或进入业务', async () => {
    io.probeAcceptanceDatabase.mockImplementation(async () => {
      io.events.push('acceptance-probe')
      return {
        identity: { databaseName: 'other', serverAddress: '10.0.0.5', serverPort: 5432 },
        fingerprint: 'd'.repeat(64),
      }
    })
    const response = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))

    expect(response.status).toBe(409)
    expect(io.events).toEqual(['payload-init', 'acceptance-probe'])
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.submitPublicInquiry).not.toHaveBeenCalled()
  })

  it('acceptance 数据库 probe 失败时 503 且不泄漏 permit', async () => {
    io.probeAcceptanceDatabase.mockImplementation(async () => {
      io.events.push('acceptance-probe')
      throw new Error(`db failure ${ACCEPTANCE_TOKEN}`)
    })
    const response = await POST(routeRequest({
      headers: { 'x-sbh-acceptance-permit': ACCEPTANCE_TOKEN },
    }))
    const text = await response.text()

    expect(response.status).toBe(503)
    expect(text).not.toContain(ACCEPTANCE_TOKEN)
    expect(io.events).toEqual(['payload-init', 'acceptance-probe'])
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.submitPublicInquiry).not.toHaveBeenCalled()
  })

  it('getPayload 仅先初始化共享 pool，rate 仍早于 Payload 业务 find/create', async () => {
    io.payloadCreate.mockImplementation(async () => {
      io.events.push('payload-create')
      return { id: 1 }
    })
    io.submitPublicInquiry.mockImplementation(async (_command, deps) => {
      io.events.push('submit')
      await deps.createLead({ name: '安全测试' })
      return { idempotent: false, targetResolution: 'listing' }
    })

    const response = await POST(routeRequest())

    expect(response.status).toBe(200)
    expect(io.events).toEqual([
      'payload-init',
      'rate',
      'precheck',
      'city',
      'submit',
      'payload-create',
    ])
  })

  it('手机号 code 无 Bearer 时只读取微信能力，并严格在预查 miss 后消费', async () => {
    const response = await POST(routeRequest({
      body: validBody({ phone: undefined, phoneCode: 'one-use-phone-code' }),
    }))

    expect(response.status).toBe(200)
    expect(io.events).toEqual(['payload-init', 'rate', 'precheck', 'phone', 'city', 'submit'])
    expect(io.readSigningConfig).not.toHaveBeenCalled()
    expect(io.readWechatConfig).toHaveBeenCalledOnce()
    expect(io.exchangePhoneCode).toHaveBeenCalledWith('one-use-phone-code')
  })

  it('Bearer 只读取签名能力，并在任何幂等预查或 phoneCode 消费前验签', async () => {
    const response = await POST(routeRequest({
      body: validBody({ phone: undefined, phoneCode: 'one-use-phone-code' }),
      headers: { authorization: 'Bearer anonymous-context-token' },
    }))

    expect(response.status).toBe(200)
    expect(io.events).toEqual(['payload-init', 'rate', 'verify', 'precheck', 'phone', 'city', 'submit'])
    expect(io.verifyToken).toHaveBeenCalledWith(
      'anonymous-context-token',
      expect.objectContaining({ signingSecret: expect.any(Uint8Array) }),
    )
  })

  it.each([
    { authorization: 'Basic token' },
    { authorization: 'Bearer' },
    { authorization: 'Bearer token extra' },
  ])('Bearer 语法无效时先返回统一 session_invalid：$authorization', async ({ authorization }) => {
    io.payloadFind.mockResolvedValue({ docs: [{ targetType: 'listing' }] })
    const response = await POST(routeRequest({
      body: validBody({ phone: undefined, phoneCode: 'must-not-consume' }),
      headers: { authorization },
    }))

    expect(response.status).toBe(401)
    expect(await json(response)).toMatchObject({ ok: false, error: { code: 'session_invalid' } })
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.exchangePhoneCode).not.toHaveBeenCalled()
  })

  it.each(['session_invalid', 'session_expired'] as const)(
    '无效/过期 token 均映射 session_invalid 且即使已有 key 也不消费 code：%s',
    async (errorCode) => {
      io.verifyToken.mockImplementation(() => {
        io.events.push('verify')
        return { ok: false, errorCode }
      })
      io.payloadFind.mockResolvedValue({ docs: [{ targetType: 'listing' }] })
      const response = await POST(routeRequest({
        body: validBody({ phone: undefined, phoneCode: 'must-not-consume' }),
        headers: { authorization: 'Bearer invalid-or-expired' },
      }))

      expect(response.status).toBe(401)
      expect(await json(response)).toMatchObject({ ok: false, error: { code: 'session_invalid' } })
      expect(io.events).toEqual(['payload-init', 'rate', 'verify'])
      expect(io.payloadFind).not.toHaveBeenCalled()
      expect(io.exchangePhoneCode).not.toHaveBeenCalled()
    },
  )

  it('幂等命中直接 acceptedExisting，不消费 phoneCode、不解析城市也不二次提交', async () => {
    io.payloadFind.mockImplementation(async () => {
      io.events.push('precheck')
      return { docs: [{ targetType: 'building' }] }
    })
    const response = await POST(routeRequest({
      body: validBody({ phone: undefined, phoneCode: 'must-not-consume' }),
    }))

    expect(response.status).toBe(200)
    expect(await json(response)).toMatchObject({
      data: { accepted: true, acceptedExisting: true, targetResolution: 'building' },
    })
    expect(io.events).toEqual(['payload-init', 'rate', 'precheck'])
    expect(io.readWechatConfig).not.toHaveBeenCalled()
    expect(io.exchangePhoneCode).not.toHaveBeenCalled()
    expect(io.submitPublicInquiry).not.toHaveBeenCalled()
  })

  it('Mini adapter 首次预查异常 fail-closed 503，不消费 phoneCode 且日志不带原文', async () => {
    io.payloadFind.mockRejectedValue(new Error('AppSecret=sensitive complete-phone=13800001111'))
    const response = await POST(routeRequest({
      body: validBody({ phone: undefined, phoneCode: 'must-not-consume' }),
    }))

    expect(response.status).toBe(503)
    expect(await json(response)).toMatchObject({ error: { code: 'service_unavailable' } })
    expect(io.readWechatConfig).not.toHaveBeenCalled()
    expect(io.exchangePhoneCode).not.toHaveBeenCalled()
    expect(io.submitPublicInquiry).not.toHaveBeenCalled()
    expect(JSON.stringify(io.loggerError.mock.calls)).not.toContain('AppSecret')
    expect(JSON.stringify(io.loggerError.mock.calls)).not.toContain('13800001111')
  })

  it.each([
    {
      name: 'content type',
      request: () => routeRequest({ headers: { 'content-type': 'text/plain' } }),
      status: 415,
      field: 'invalid_content_type',
    },
    {
      name: 'json prefix content type',
      request: () => routeRequest({ headers: { 'content-type': 'application/jsonp' } }),
      status: 415,
      field: 'invalid_content_type',
    },
    {
      name: 'invalid json',
      request: () => routeRequest({ rawBody: '{' }),
      status: 400,
      field: 'invalid_json',
    },
    {
      name: 'oversized utf8 body',
      request: () => routeRequest({ rawBody: JSON.stringify({ value: '汉'.repeat(6_000) }) }),
      status: 413,
      field: 'body_too_large',
    },
    {
      name: 'schema',
      request: () => routeRequest({ body: validBody({ name: 'forged' }) }),
      status: 422,
      field: 'invalid_body_fields',
    },
  ])('传输与 schema 拒绝发生在任何业务配置/预查/网关之前：$name', async (testCase) => {
    const response = await POST(testCase.request())

    expect(response.status).toBe(testCase.status)
    expect(await json(response)).toMatchObject({ error: { fields: [testCase.field] } })
    expect(io.events).toEqual(['payload-init', 'rate'])
    expect(io.readSigningConfig).not.toHaveBeenCalled()
    expect(io.readWechatConfig).not.toHaveBeenCalled()
    expect(io.payloadFind).not.toHaveBeenCalled()
  })

  it('限流存储失败 fail-closed 为 503，且不调用网关或 Payload 业务查询', async () => {
    io.rateStoreFails = true
    const response = await POST(routeRequest())

    expect(response.status).toBe(503)
    expect(await json(response)).toMatchObject({ error: { code: 'service_unavailable' } })
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.readWechatConfig).not.toHaveBeenCalled()
    expect(io.submitPublicInquiry).not.toHaveBeenCalled()
  })

  it('缺少的能力只阻断真正需要它的路径', async () => {
    io.readSigningConfig.mockReturnValue({ ok: false, error: 'missing' })
    const bearer = await POST(routeRequest({ headers: { authorization: 'Bearer valid-shape' } }))
    expect(bearer.status).toBe(503)
    expect(io.payloadFind).not.toHaveBeenCalled()

    io.events.length = 0
    io.readWechatConfig.mockReturnValue({ ok: false, error: 'missing' })
    const phoneCode = await POST(routeRequest({
      body: validBody({ phone: undefined, phoneCode: 'one-use-phone-code' }),
    }))
    expect(phoneCode.status).toBe(503)
    expect(io.payloadFind).toHaveBeenCalledOnce()
    expect(io.exchangePhoneCode).not.toHaveBeenCalled()
  })

  it.each([
    'phone_code_invalid',
    'wechat_phone_code_rejected',
    'wechat_phone_rejected',
    'wechat_phone_invalid',
  ] as const)('一次性 phoneCode 上游拒绝稳定映射 phone_code_consumed：%s', async (errorCode) => {
    io.exchangePhoneCode.mockImplementation(async () => {
      io.events.push('phone')
      throw new WechatGatewayError(errorCode)
    })
    const response = await POST(routeRequest({
      body: validBody({ phone: undefined, phoneCode: 'already-consumed' }),
    }))

    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({ error: { code: 'phone_code_consumed' } })
    expect(io.submitPublicInquiry).not.toHaveBeenCalled()
  })

  it('phoneCode 消费后写失败明确 inquiry_submit_failed，绝不伪称 accepted', async () => {
    io.submitPublicInquiry.mockRejectedValue(new PublicInquirySubmissionError('create_failed'))
    const response = await POST(routeRequest({
      body: validBody({ phone: undefined, phoneCode: 'consumed-before-write' }),
    }))

    expect(response.status).toBe(503)
    expect(await json(response)).toMatchObject({
      ok: false,
      error: { code: 'inquiry_submit_failed' },
    })
  })

  it('同 submission/listing 的并发请求即使手机号不同也使用同一 server-only key', async () => {
    io.submitPublicInquiry
      .mockResolvedValueOnce({ idempotent: false, targetResolution: 'listing' })
      .mockResolvedValueOnce({ idempotent: true, targetResolution: 'listing' })
    const [first, second] = await Promise.all([
      POST(routeRequest({ body: validBody({ phone: '13800001111' }) })),
      POST(routeRequest({ body: validBody({ phone: '13900002222' }) })),
    ])

    const keys = io.submitPublicInquiry.mock.calls.map(([command]) => command.trustedIdempotencyKey)
    expect(new Set(keys)).toHaveLength(1)
    const bodies = await Promise.all([json(first), json(second)])
    expect(bodies.map((body) => (body.data as { acceptedExisting: boolean }).acceptedExisting).sort())
      .toEqual([false, true])
  })

  it('logger 同步抛敏感异常不改变结果，响应与全部 logger 参数不泄漏', async () => {
    const sensitive = ['13800001111', '微信用户', SUBMISSION_ID, 'AppSecret-marker']
    io.loggerInfo.mockImplementation(() => {
      throw new Error(sensitive.join('|'))
    })
    const response = await POST(routeRequest())
    const responseText = JSON.stringify(await json(response))

    expect(response.status).toBe(200)
    expect(responseText).not.toContain('13800001111')
    expect(responseText).not.toContain(SUBMISSION_ID)
    expect(JSON.stringify(io.loggerInfo.mock.calls)).not.toContain('13800001111')
    expect(JSON.stringify(io.loggerInfo.mock.calls)).not.toContain(SUBMISSION_ID)
  })
})

describe('Mini 独立限流边界', () => {
  it('inquiry route 中伪造左侧 XFF 不能轮换同一 client 配额', async () => {
    io.readProxyConfig.mockReturnValue({ ok: true, value: { trustedProxyHops: 2 } })
    for (let index = 0; index < 6; index += 1) {
      const response = await POST(routeRequest({ headers: {
        'x-real-ip': `192.0.2.${index + 1}`,
        'x-forwarded-for': `198.51.100.${index + 1}, 203.0.113.20, 10.0.0.8`,
      } }))
      expect(response.status).toBe(index < 5 ? 200 : 429)
    }

    expect(io.submitPublicInquiry).toHaveBeenCalledTimes(5)
    expect(new Set(io.rateKeys)).toHaveLength(1)
    expect(io.rateKeys[0]).toMatch(/^mini-inquiry:[a-f0-9]{32}$/)
  })

  it('按显式 trusted hops 从 XFF 右侧解析 client，左侧伪造和 x-real-ip 不能轮换配额', () => {
    const first = routeRequest({ headers: {
      'x-real-ip': '192.0.2.200',
      'x-forwarded-for': '198.51.100.1, 203.0.113.20, 10.0.0.8',
    } })
    const forgedLeft = routeRequest({ headers: {
      'x-real-ip': '192.0.2.201',
      'x-forwarded-for': '198.51.100.99, 203.0.113.20, 10.0.0.8',
    } })

    expect(resolveMiniTrustedClientIp(first, 2)).toEqual({
      ok: true,
      clientIp: '203.0.113.20',
    })
    expect(resolveMiniTrustedClientIp(forgedLeft, 2)).toEqual({
      ok: true,
      clientIp: '203.0.113.20',
    })
    const firstKey = miniRateLimitKey('203.0.113.20', 'mini-inquiry', 1_800_000_000_000)
    expect(firstKey).not.toContain('203.0.113.20')
  })

  it('代理链缺失、短于 hops 或任一节点非合法 IP 时 fail-closed', () => {
    for (const xForwardedFor of [
      '',
      '203.0.113.20',
      'forged, 203.0.113.20, 10.0.0.8',
      '203.0.113.20, invalid',
    ]) {
      expect(resolveMiniTrustedClientIp(routeRequest({ headers: {
        'x-forwarded-for': xForwardedFor,
      } }), 2)).toEqual({ ok: false })
    }
  })

  it('Mini session、Mini inquiry、Web inquiry 同 IP 配额和 prune ref 完全独立', async () => {
    const counts = new Map<string, number>()
    const deps: RateLimitDeps = {
      acquire: async (key, windowStart) => {
        const count = (counts.get(key) ?? 0) + 1
        counts.set(key, count)
        return { count, windowStart }
      },
      pruneExpired: async () => 0,
      countKeys: async () => counts.size,
      keyExists: async (key) => counts.has(key),
      now: () => 1_800_000_000_000,
    }
    const request = routeRequest()
    const sessionKey = miniRateLimitKey('203.0.113.20', 'mini-session', deps.now())
    const inquiryKey = miniRateLimitKey('203.0.113.20', 'mini-inquiry', deps.now())
    const webKey = hashIpForLog('203.0.113.20', '2027-01-15')
    const webPruneRef = { value: 0 }

    for (let index = 0; index < MINI_SESSION_RATE_LIMIT_CONFIG.max; index += 1) {
      await expect(runDistributedRateLimit(
        deps, MINI_SESSION_RATE_LIMIT_CONFIG, sessionKey, miniSessionRatePruneRef,
      )).resolves.toMatchObject({ allowed: true })
    }
    await expect(runDistributedRateLimit(
      deps, MINI_SESSION_RATE_LIMIT_CONFIG, sessionKey, miniSessionRatePruneRef,
    )).resolves.toMatchObject({ allowed: false })
    await expect(runDistributedRateLimit(
      deps, MINI_INQUIRY_RATE_LIMIT_CONFIG, inquiryKey, miniInquiryRatePruneRef,
    )).resolves.toMatchObject({ allowed: true })
    await expect(runDistributedRateLimit(
      deps, INQUIRY_RATE_LIMIT_CONFIG, webKey, webPruneRef,
    )).resolves.toMatchObject({ allowed: true })
    expect(new Set([sessionKey, inquiryKey, webKey])).toHaveLength(3)
    expect(MINI_SESSION_RATE_LIMIT_CONFIG.failOpen).toBe(false)
    expect(MINI_INQUIRY_RATE_LIMIT_CONFIG.failOpen).toBe(false)
  })
})
