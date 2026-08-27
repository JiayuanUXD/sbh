import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  events: [] as string[],
  rateKeys: [] as string[],
  rateCounts: new Map<string, number>(),
  rateStoreFails: false,
  getPayload: vi.fn(),
  payloadFind: vi.fn(),
  payloadCreate: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  readConfig: vi.fn(),
  readProxyConfig: vi.fn(),
  exchangeLoginCode: vi.fn(),
  createWechatGateway: vi.fn(),
  issueToken: vi.fn(),
}))

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, getPayload: io.getPayload }
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
    readMiniProgramRuntimeConfig: io.readConfig,
    readMiniTrustedProxyRuntimeConfig: io.readProxyConfig,
  }
})

vi.mock('@/lib/mini-program/wechat-gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mini-program/wechat-gateway')>()
  return { ...actual, createWechatGateway: io.createWechatGateway }
})

vi.mock('@/domain/mini-program/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/mini-program/session')>()
  return { ...actual, issueAnonymousContextToken: io.issueToken }
})

import { POST, runtime } from '@/app/api/mini/v1/session/route'
import { __resetMiniRateLimitStateForTests } from '@/app/api/mini/v1/rate-limit-state'
import { WechatGatewayError } from '@/lib/mini-program/wechat-gateway'

const SIGNING_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1)

function request(options: Readonly<{
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
}> = {}): Request {
  const rawBody = options.rawBody ?? JSON.stringify(options.body ?? { loginCode: 'login-code' })
  return new Request('https://api.example.test/api/mini/v1/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'mini-session-http-1',
      'x-real-ip': '192.0.2.200',
      'x-forwarded-for': '203.0.113.10',
      ...options.headers,
    },
    body: rawBody,
  })
}

function chunkedOversizedRequest(): Readonly<{
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
    request: new Request('https://api.example.test/api/mini/v1/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.10',
      },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }),
    wasCancelled: () => cancelled,
    pullCount: () => pulls,
  }
}

function declaredOversizedRequest(): Readonly<{
  request: Request
  wasCancelled(): boolean
  pullCount(): number
}> {
  let cancelled = false
  let pulls = 0
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      pulls += 1
    },
    cancel() {
      cancelled = true
    },
  })
  return {
    request: new Request('https://api.example.test/api/mini/v1/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(16 * 1024 + 1),
        'x-forwarded-for': '203.0.113.10',
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
  io.getPayload.mockReset()
  io.payloadFind.mockReset()
  io.payloadCreate.mockReset()
  io.loggerInfo.mockReset()
  io.loggerError.mockReset()
  io.loggerWarn.mockReset()
  io.readConfig.mockReset()
  io.readProxyConfig.mockReset()
  io.exchangeLoginCode.mockReset()
  io.createWechatGateway.mockReset()
  io.issueToken.mockReset()
  __resetMiniRateLimitStateForTests()

  io.getPayload.mockImplementation(async () => {
    io.events.push('payload-init')
    return {
      db: { pool: {} },
      find: io.payloadFind,
      create: io.payloadCreate,
      logger: { info: io.loggerInfo, error: io.loggerError, warn: io.loggerWarn },
    }
  })
  io.readConfig.mockImplementation(() => {
    io.events.push('config')
    return {
      ok: true,
      value: {
        appId: 'wx1234567890abcdef',
        appSecret: '0123456789abcdef0123456789abcdef',
        sessionSigningSecret: SIGNING_SECRET,
      },
    }
  })
  io.readProxyConfig.mockReturnValue({ ok: true, value: { trustedProxyHops: 1 } })
  io.exchangeLoginCode.mockImplementation(async () => {
    io.events.push('gateway')
    return { openId: 'openid-sensitive' }
  })
  io.createWechatGateway.mockReturnValue({ exchangeLoginCode: io.exchangeLoginCode })
  io.issueToken.mockReturnValue({
    token: 'anonymous-context-token',
    expiresAt: '2027-01-15T08:15:00.000Z',
  })
})

describe('POST /api/mini/v1/session', () => {
  it('无 Content-Length 的分块 body 超过 16KB 时立即取消流并停止继续读取', async () => {
    const chunked = chunkedOversizedRequest()
    const response = await POST(chunked.request)

    expect(response.status).toBe(413)
    expect(chunked.wasCancelled()).toBe(true)
    expect(chunked.pullCount()).toBeLessThanOrEqual(4)
    expect(io.readConfig).not.toHaveBeenCalled()
  })

  it('声明 Content-Length 超过 16KB 时取消 request body 且不读取流', async () => {
    const declared = declaredOversizedRequest()
    await Promise.resolve()
    const pullsBeforePost = declared.pullCount()
    const response = await POST(declared.request)

    expect(response.status).toBe(413)
    expect(declared.wasCancelled()).toBe(true)
    expect(declared.pullCount()).toBe(pullsBeforePost)
    expect(io.readConfig).not.toHaveBeenCalled()
  })

  it('缺失受信代理配置或链时 fail-closed，不初始化 Payload/微信能力', async () => {
    io.readProxyConfig.mockReturnValueOnce({
      ok: false,
      errorCode: 'mini_program_config_unavailable',
    })
    const missingConfig = await POST(request())
    expect(missingConfig.status).toBe(503)
    expect(io.getPayload).not.toHaveBeenCalled()

    io.readProxyConfig.mockReturnValueOnce({ ok: true, value: { trustedProxyHops: 2 } })
    const shortChain = await POST(request({
      headers: { 'x-forwarded-for': '203.0.113.10' },
    }))
    expect(shortChain.status).toBe(503)
    expect(io.getPayload).not.toHaveBeenCalled()
    expect(io.readConfig).not.toHaveBeenCalled()
    expect(io.exchangeLoginCode).not.toHaveBeenCalled()
  })

  it('限流后交换 loginCode 并立即签发匿名 token，响应只含 write requestId', async () => {
    const response = await POST(request({
      headers: { origin: 'https://evil.example', 'x-forwarded-for': '198.51.100.99' },
    }))
    const body = await response.json()

    expect(runtime).toBe('nodejs')
    expect(io.events).toEqual(['payload-init', 'rate', 'config', 'gateway'])
    expect(io.exchangeLoginCode).toHaveBeenCalledWith('login-code')
    expect(io.issueToken).toHaveBeenCalledWith('openid-sensitive', expect.objectContaining({
      signingSecret: SIGNING_SECRET,
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const requestId = response.headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(requestId).not.toBe('mini-session-http-1')
    expect(body).toEqual({
      ok: true,
      data: {
        anonymousContextToken: 'anonymous-context-token',
        expiresAt: '2027-01-15T08:15:00.000Z',
      },
      meta: { requestId },
    })
    const serialized = JSON.stringify({ body, logs: io.loggerInfo.mock.calls })
    for (const sensitive of ['openid-sensitive', 'session_key', '0123456789abcdef0123456789abcdef', 'login-code']) {
      expect(serialized).not.toContain(sensitive)
    }
  })

  it.each([
    {
      name: 'Content-Type',
      req: () => request({ headers: { 'content-type': 'text/plain' } }),
      status: 415,
      fields: ['invalid_content_type'],
    },
    {
      name: 'JSON 前缀伪造 Content-Type',
      req: () => request({ headers: { 'content-type': 'application/jsonp' } }),
      status: 415,
      fields: ['invalid_content_type'],
    },
    {
      name: '声明长度',
      req: () => request({ headers: { 'content-length': String(16 * 1024 + 1) } }),
      status: 413,
      fields: ['body_too_large'],
    },
    {
      name: '真实 UTF-8 长度',
      req: () => request({ rawBody: JSON.stringify({ loginCode: '中'.repeat(6_000) }) }),
      status: 413,
      fields: ['body_too_large'],
    },
    {
      name: 'JSON',
      req: () => request({ rawBody: '{broken' }),
      status: 400,
      fields: ['invalid_json'],
    },
    {
      name: '未知字段',
      req: () => request({ body: { loginCode: 'login-code', role: 'admin' } }),
      status: 422,
      fields: ['invalid_body_fields'],
    },
    {
      name: 'loginCode',
      req: () => request({ body: { loginCode: '' } }),
      status: 422,
      fields: ['login_code_invalid'],
    },
  ])('在微信配置和 gateway 前拒绝非法 $name', async ({ req, status, fields }) => {
    const response = await POST(req())

    expect(response.status).toBe(status)
    const responseBody = await response.json()
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(responseBody).toMatchObject({
      ok: false,
      error: { code: 'invalid_request', fields },
      meta: { requestId: response.headers.get('x-request-id') },
    })
    expect(io.readConfig).not.toHaveBeenCalled()
    expect(io.exchangeLoginCode).not.toHaveBeenCalled()
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.payloadCreate).not.toHaveBeenCalled()
  })

  it('限流存储失败时 fail-closed，且在配置、gateway 和 Payload 业务查询之前停止', async () => {
    io.rateStoreFails = true

    const response = await POST(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'service_unavailable' },
    })
    expect(io.readConfig).not.toHaveBeenCalled()
    expect(io.exchangeLoginCode).not.toHaveBeenCalled()
    expect(io.payloadFind).not.toHaveBeenCalled()
    expect(io.payloadCreate).not.toHaveBeenCalled()
  })

  it('伪造 XFF 左侧与 x-real-ip 不能轮换受信右侧 client 的配额', async () => {
    io.readProxyConfig.mockReturnValue({ ok: true, value: { trustedProxyHops: 2 } })
    for (let index = 0; index < 6; index += 1) {
      const response = await POST(request({
        headers: {
          'x-real-ip': `192.0.2.${index + 1}`,
          'x-forwarded-for': `198.51.100.${index + 1}, 203.0.113.10, 10.0.0.8`,
        },
      }))
      expect(response.status).toBe(index < 5 ? 200 : 429)
    }

    expect(io.exchangeLoginCode).toHaveBeenCalledTimes(5)
    expect(new Set(io.rateKeys)).toHaveLength(1)
    expect(io.rateKeys[0]).toMatch(/^mini-session:[a-f0-9]{32}$/)
    expect(io.rateKeys[0]).not.toContain('198.51.100')
  })

  it('配置缺失与微信拒绝使用稳定安全映射', async () => {
    io.readConfig.mockReturnValueOnce({ ok: false, errorCode: 'mini_program_config_unavailable' })
    const missingConfig = await POST(request())
    expect(missingConfig.status).toBe(503)
    expect(io.exchangeLoginCode).not.toHaveBeenCalled()

    io.exchangeLoginCode.mockRejectedValueOnce(new WechatGatewayError('wechat_login_rejected'))
    const rejected = await POST(request({ headers: { 'x-real-ip': '203.0.113.11' } }))
    expect(rejected.status).toBe(422)
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: 'login_code_invalid' },
    })
  })

  it('logger 同步抛含敏感信息异常不改变成功响应', async () => {
    const sensitive = 'AppSecret:openid:session_key:13800001111:login-code'
    io.loggerInfo.mockImplementation(() => { throw new Error(sensitive) })
    io.loggerError.mockImplementation(() => { throw new Error(sensitive) })

    const response = await POST(request())
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(200)
    expect(serialized).not.toContain(sensitive)
    expect(serialized).not.toContain('openid')
  })
})
