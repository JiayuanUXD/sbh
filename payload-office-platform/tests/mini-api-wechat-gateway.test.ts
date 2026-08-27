import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetWechatGatewayTokenStateForTests,
  createWechatGateway,
  type WechatFetch,
  type WechatGatewayLogger,
} from '@/lib/mini-program/wechat-gateway'

beforeEach(() => {
  __resetWechatGatewayTokenStateForTests()
})

const APP_ID = 'wx1234567890abcdef'
const APP_SECRET = '0123456789abcdef0123456789abcdef'
const LOGIN_CODE = 'login-code-only'
const PHONE_CODE = 'phone-code-only'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function gateway(
  fetchImpl: WechatFetch,
  options: { now?: () => number; logger?: WechatGatewayLogger } = {},
) {
  return createWechatGateway(
    { appId: APP_ID, appSecret: APP_SECRET },
    {
      fetchImpl,
      now: options.now ?? (() => 1_800_000_000_000),
      logger: options.logger ?? { error: vi.fn() },
    },
  )
}

function urlOf(input: string | URL): URL {
  return input instanceof URL ? input : new URL(input)
}

function deferred<T>(): Readonly<{
  promise: Promise<T>
  resolve(value: T): void
}> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('微信 code 独立交换', () => {
  it.each(['', 'x'.repeat(129)])('loginCode 仅接受 1–128 字符：%s', async (loginCode) => {
    const fetchImpl = vi.fn<WechatFetch>()
    await expect(gateway(fetchImpl).exchangeLoginCode(loginCode))
      .rejects.toMatchObject({ errorCode: 'login_code_invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['', 'x'.repeat(129)])('phoneCode 仅接受 1–128 字符：%s', async (phoneCode) => {
    const fetchImpl = vi.fn<WechatFetch>()
    await expect(gateway(fetchImpl).exchangePhoneCode(phoneCode))
      .rejects.toMatchObject({ errorCode: 'phone_code_invalid' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('loginCode 只进入 code2Session，且 session_key 不离开 gateway', async () => {
    const fetchImpl = vi.fn<WechatFetch>(async () => jsonResponse({
      openid: 'openid-sensitive',
      session_key: 'session-key-sensitive',
    }))

    await expect(gateway(fetchImpl).exchangeLoginCode(LOGIN_CODE))
      .resolves.toEqual({ openId: 'openid-sensitive' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [input, init] = fetchImpl.mock.calls[0]
    const url = urlOf(input)
    expect(url.origin + url.pathname).toBe('https://api.weixin.qq.com/sns/jscode2session')
    expect(url.searchParams.get('appid')).toBe(APP_ID)
    expect(url.searchParams.get('secret')).toBe(APP_SECRET)
    expect(url.searchParams.get('js_code')).toBe(LOGIN_CODE)
    expect(url.searchParams.get('grant_type')).toBe('authorization_code')
    expect(url.toString()).not.toContain(PHONE_CODE)
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('phoneCode 只进入 getuserphonenumber body，使用 stable token 普通模式', async () => {
    const fetchImpl = vi.fn<WechatFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'stable-token-1', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({
        errcode: 0,
        phone_info: {
          phoneNumber: '+86 138-0000-1111',
          purePhoneNumber: '13800001111',
          countryCode: '86',
        },
      }))

    await expect(gateway(fetchImpl).exchangePhoneCode(PHONE_CODE))
      .resolves.toEqual({ phone: '13800001111' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const [tokenInput, tokenInit] = fetchImpl.mock.calls[0]
    expect(urlOf(tokenInput).toString()).toBe('https://api.weixin.qq.com/cgi-bin/stable_token')
    expect(tokenInit?.method).toBe('POST')
    expect(JSON.parse(String(tokenInit?.body))).toEqual({
      grant_type: 'client_credential',
      appid: APP_ID,
      secret: APP_SECRET,
      force_refresh: false,
    })
    const [phoneInput, phoneInit] = fetchImpl.mock.calls[1]
    const phoneUrl = urlOf(phoneInput)
    expect(phoneUrl.origin + phoneUrl.pathname)
      .toBe('https://api.weixin.qq.com/wxa/business/getuserphonenumber')
    expect(phoneUrl.searchParams.get('access_token')).toBe('stable-token-1')
    expect(JSON.parse(String(phoneInit?.body))).toEqual({ code: PHONE_CODE })
    expect(phoneUrl.toString()).not.toContain(LOGIN_CODE)
  })

  it('登录失败不回退手机号端点，手机号失败也不回退 code2Session', async () => {
    const loginFetch = vi.fn<WechatFetch>(async () => jsonResponse({ errcode: 40029, errmsg: 'bad code' }))
    await expect(gateway(loginFetch).exchangeLoginCode(LOGIN_CODE))
      .rejects.toMatchObject({ errorCode: 'wechat_login_rejected' })
    expect(loginFetch).toHaveBeenCalledTimes(1)
    expect(urlOf(loginFetch.mock.calls[0][0]).pathname).toBe('/sns/jscode2session')

    const phoneFetch = vi.fn<WechatFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 40029, errmsg: 'bad phone code' }))
    await expect(gateway(phoneFetch).exchangePhoneCode(PHONE_CODE))
      .rejects.toMatchObject({ errorCode: 'wechat_phone_code_rejected' })
    expect(phoneFetch).toHaveBeenCalledTimes(2)
    expect(phoneFetch.mock.calls.some(([input]) => urlOf(input).pathname === '/sns/jscode2session'))
      .toBe(false)
  })

  it('不缓存 loginCode 或 phoneCode，同 code 重放仍交由微信判定', async () => {
    const fetchImpl = vi.fn<WechatFetch>()
      .mockResolvedValueOnce(jsonResponse({ openid: 'openid-1', session_key: 'session-1' }))
      .mockResolvedValueOnce(jsonResponse({ openid: 'openid-1', session_key: 'session-2' }))
    const loginGateway = gateway(fetchImpl)
    await loginGateway.exchangeLoginCode(LOGIN_CODE)
    await loginGateway.exchangeLoginCode(LOGIN_CODE)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    const phoneFetch = vi.fn<WechatFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockImplementation(async () => jsonResponse({
        errcode: 0,
        phone_info: { phoneNumber: '13800001111', purePhoneNumber: '13800001111' },
      }))
    const phoneGateway = gateway(phoneFetch)
    await phoneGateway.exchangePhoneCode(PHONE_CODE)
    await phoneGateway.exchangePhoneCode(PHONE_CODE)
    expect(phoneFetch).toHaveBeenCalledTimes(3)
  })
})

describe('stable access token 缓存、并发与刷新', () => {
  it('同 appId 的不同 gateway 实例共享 stable token，secret 轮换后立即隔离旧缓存', async () => {
    const tokenRequests: Array<Record<string, unknown>> = []
    const fetchImpl = vi.fn<WechatFetch>(async (input, init) => {
      const url = urlOf(input)
      if (url.pathname === '/cgi-bin/stable_token') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        tokenRequests.push(body)
        return jsonResponse({
          access_token: `token-${tokenRequests.length}`,
          expires_in: 7200,
        })
      }
      return jsonResponse({
        errcode: 0,
        phone_info: { phoneNumber: '13800001111', purePhoneNumber: '13800001111' },
      })
    })

    const first = gateway(fetchImpl)
    const second = gateway(fetchImpl)
    await Promise.all([
      first.exchangePhoneCode('phone-from-request-1'),
      second.exchangePhoneCode('phone-from-request-2'),
    ])

    const rotated = createWechatGateway(
      { appId: APP_ID, appSecret: 'fedcba9876543210fedcba9876543210' },
      { fetchImpl, now: () => 1_800_000_000_000, logger: { error: vi.fn() } },
    )
    await rotated.exchangePhoneCode('phone-after-secret-rotation')

    expect(tokenRequests).toHaveLength(2)
    expect(tokenRequests[0]?.secret).toBe(APP_SECRET)
    expect(tokenRequests[1]?.secret).toBe('fedcba9876543210fedcba9876543210')
  })

  it('共享 token in-flight 不共享请求 logger，每个 gateway 只写自己的安全事件', async () => {
    const firstLogger = vi.fn()
    const secondLogger = vi.fn()
    const fetchImpl = vi.fn<WechatFetch>(async () => jsonResponse({ errcode: 40013 }))
    const first = gateway(fetchImpl, { logger: { error: firstLogger } })
    const second = gateway(fetchImpl, { logger: { error: secondLogger } })

    const results = await Promise.allSettled([
      first.exchangePhoneCode('phone-from-request-1'),
      second.exchangePhoneCode('phone-from-request-2'),
    ])

    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(firstLogger).toHaveBeenCalledOnce()
    expect(secondLogger).toHaveBeenCalledOnce()
    expect(firstLogger).toHaveBeenCalledWith({
      operation: 'exchange_phone_code',
      errorCode: 'wechat_access_token_rejected',
    })
    expect(secondLogger).toHaveBeenCalledWith({
      operation: 'exchange_phone_code',
      errorCode: 'wechat_access_token_rejected',
    })
  })

  it('有效期内复用并在到期前 5 分钟刷新', async () => {
    let now = 1_800_000_000_000
    let tokenCounter = 0
    const fetchImpl = vi.fn<WechatFetch>(async (input) => {
      const url = urlOf(input)
      if (url.pathname === '/cgi-bin/stable_token') {
        tokenCounter += 1
        return jsonResponse({ access_token: `token-${tokenCounter}`, expires_in: 7200 })
      }
      return jsonResponse({
        errcode: 0,
        phone_info: { phoneNumber: '13800001111', purePhoneNumber: '13800001111' },
      })
    })
    const service = gateway(fetchImpl, { now: () => now })

    await service.exchangePhoneCode('phone-1')
    now += 6_899_999
    await service.exchangePhoneCode('phone-2')
    now += 1
    await service.exchangePhoneCode('phone-3')

    expect(fetchImpl.mock.calls.filter(([input]) => urlOf(input).pathname === '/cgi-bin/stable_token'))
      .toHaveLength(2)
  })

  it('并发 miss 只发一个 stable token 请求', async () => {
    let resolveToken!: (response: Response) => void
    const tokenResponse = new Promise<Response>((resolvePromise) => { resolveToken = resolvePromise })
    const fetchImpl = vi.fn<WechatFetch>((input) => {
      if (urlOf(input).pathname === '/cgi-bin/stable_token') return tokenResponse
      return Promise.resolve(jsonResponse({
        errcode: 0,
        phone_info: { phoneNumber: '13800001111', purePhoneNumber: '13800001111' },
      }))
    })
    const service = gateway(fetchImpl)

    const first = service.exchangePhoneCode('phone-1')
    const second = service.exchangePhoneCode('phone-2')
    await vi.waitFor(() => {
      expect(fetchImpl.mock.calls.filter(([input]) => urlOf(input).pathname === '/cgi-bin/stable_token'))
        .toHaveLength(1)
    })
    resolveToken(jsonResponse({ access_token: 'shared-token', expires_in: 7200 }))

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('强刷不 join 普通刷新、普通请求 join 强刷，且迟到普通结果不覆盖强刷缓存', async () => {
    let now = 1_800_000_000_000
    const invalidPhoneResponse = deferred<Response>()
    const ordinaryTokenResponse = deferred<Response>()
    const forcedTokenResponse = deferred<Response>()
    const tokenRequestBodies: Array<Record<string, unknown>> = []
    const phoneRequests: Array<Readonly<{ code: string; token: string }>> = []
    const fetchImpl = vi.fn<WechatFetch>(async (input, init) => {
      const url = urlOf(input)
      if (url.pathname === '/cgi-bin/stable_token') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        tokenRequestBodies.push(body)
        if (tokenRequestBodies.length === 1) {
          return jsonResponse({ access_token: 'cached-token', expires_in: 7200 })
        }
        return body.force_refresh === true
          ? forcedTokenResponse.promise
          : ordinaryTokenResponse.promise
      }
      const body = JSON.parse(String(init?.body)) as { code: string }
      const token = url.searchParams.get('access_token') ?? ''
      phoneRequests.push({ code: body.code, token })
      if (body.code === 'invalid-phone' && token === 'cached-token') {
        return invalidPhoneResponse.promise
      }
      return jsonResponse({
        errcode: 0,
        phone_info: { phoneNumber: '13800001111', purePhoneNumber: '13800001111' },
      })
    })
    const service = gateway(fetchImpl, { now: () => now })

    await service.exchangePhoneCode('warm-cache')
    const invalidRequest = service.exchangePhoneCode('invalid-phone')
    await vi.waitFor(() => {
      expect(phoneRequests).toContainEqual({ code: 'invalid-phone', token: 'cached-token' })
    })

    now += 6_900_000
    const ordinaryRequest = service.exchangePhoneCode('ordinary-refresh')
    await vi.waitFor(() => expect(tokenRequestBodies).toHaveLength(2))

    invalidPhoneResponse.resolve(jsonResponse({ errcode: 40014 }))
    await vi.waitFor(() => {
      expect(tokenRequestBodies).toHaveLength(3)
      expect(tokenRequestBodies[2]?.force_refresh).toBe(true)
    })

    const ordinaryFollower = service.exchangePhoneCode('ordinary-follows-force')
    await Promise.resolve()
    expect(tokenRequestBodies).toHaveLength(3)

    forcedTokenResponse.resolve(jsonResponse({ access_token: 'forced-token', expires_in: 7200 }))
    await expect(Promise.all([invalidRequest, ordinaryFollower])).resolves.toHaveLength(2)

    ordinaryTokenResponse.resolve(jsonResponse({ access_token: 'ordinary-token', expires_in: 7200 }))
    await expect(ordinaryRequest).resolves.toEqual({ phone: '13800001111' })
    await expect(service.exchangePhoneCode('after-late-ordinary'))
      .resolves.toEqual({ phone: '13800001111' })

    expect(phoneRequests).toEqual(expect.arrayContaining([
      { code: 'invalid-phone', token: 'forced-token' },
      { code: 'ordinary-follows-force', token: 'forced-token' },
      { code: 'ordinary-refresh', token: 'ordinary-token' },
      { code: 'after-late-ordinary', token: 'forced-token' },
    ]))
    expect(tokenRequestBodies).toHaveLength(3)
  })

  it('迟到的旧 token 失效响应复用已强刷的新 token，不再二次强刷', async () => {
    const firstInvalidResponse = deferred<Response>()
    const secondInvalidResponse = deferred<Response>()
    const tokenRequestBodies: Array<Record<string, unknown>> = []
    const phoneRequests: Array<Readonly<{ code: string; token: string }>> = []
    const fetchImpl = vi.fn<WechatFetch>(async (input, init) => {
      const url = urlOf(input)
      if (url.pathname === '/cgi-bin/stable_token') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        tokenRequestBodies.push(body)
        const forcedCount = tokenRequestBodies.filter((request) => request.force_refresh === true).length
        return jsonResponse({
          access_token: forcedCount === 0 ? 'token-a' : `token-${forcedCount === 1 ? 'b' : 'c'}`,
          expires_in: 7200,
        })
      }
      const body = JSON.parse(String(init?.body)) as { code: string }
      const token = url.searchParams.get('access_token') ?? ''
      phoneRequests.push({ code: body.code, token })
      if (token === 'token-a' && body.code === 'first-old-token') return firstInvalidResponse.promise
      if (token === 'token-a' && body.code === 'second-old-token') return secondInvalidResponse.promise
      return jsonResponse({
        errcode: 0,
        phone_info: { phoneNumber: '13800001111', purePhoneNumber: '13800001111' },
      })
    })
    const service = gateway(fetchImpl)

    const first = service.exchangePhoneCode('first-old-token')
    const second = service.exchangePhoneCode('second-old-token')
    await vi.waitFor(() => {
      expect(phoneRequests.filter((request) => request.token === 'token-a')).toHaveLength(2)
    })

    firstInvalidResponse.resolve(jsonResponse({ errcode: 40014 }))
    await expect(first).resolves.toEqual({ phone: '13800001111' })
    expect(phoneRequests).toContainEqual({ code: 'first-old-token', token: 'token-b' })

    secondInvalidResponse.resolve(jsonResponse({ errcode: 40014 }))
    await expect(second).resolves.toEqual({ phone: '13800001111' })

    expect(phoneRequests).toContainEqual({ code: 'second-old-token', token: 'token-b' })
    expect(tokenRequestBodies.filter((request) => request.force_refresh === true)).toHaveLength(1)
  })

  it('明确 token 失效时清缓存、强制刷新并只重试手机号一次', async () => {
    const fetchImpl = vi.fn<WechatFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'expired-token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 40014, errmsg: 'invalid access token' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh-token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({
        errcode: 0,
        phone_info: { phoneNumber: '13800001111', purePhoneNumber: '13800001111' },
      }))

    await expect(gateway(fetchImpl).exchangePhoneCode(PHONE_CODE))
      .resolves.toEqual({ phone: '13800001111' })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(JSON.parse(String(fetchImpl.mock.calls[2][1]?.body)).force_refresh).toBe(true)
    expect(JSON.parse(String(fetchImpl.mock.calls[3][1]?.body))).toEqual({ code: PHONE_CODE })
  })

  it('手机号 code 错误不刷新 token、不重试手机号请求', async () => {
    const fetchImpl = vi.fn<WechatFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'valid-token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 40029, errmsg: 'invalid code' }))

    await expect(gateway(fetchImpl).exchangePhoneCode(PHONE_CODE))
      .rejects.toMatchObject({ errorCode: 'wechat_phone_code_rejected' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('刷新后再次 token 失效也只重试一次', async () => {
    const fetchImpl = vi.fn<WechatFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'expired-token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 42001 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh-token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ errcode: 40014 }))

    await expect(gateway(fetchImpl).exchangePhoneCode(PHONE_CODE))
      .rejects.toMatchObject({ errorCode: 'wechat_phone_rejected' })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })
})

describe('微信上游失败与隐私边界', () => {
  it.each([
    { response: new Response('down', { status: 502 }), errorCode: 'wechat_http_error' },
    { response: new Response('{broken', { status: 200 }), errorCode: 'wechat_response_invalid' },
    { response: jsonResponse({ errcode: 40029, errmsg: 'invalid code' }), errorCode: 'wechat_login_rejected' },
  ])('登录上游失败映射稳定错误：$errorCode', async ({ response, errorCode }) => {
    const fetchImpl = vi.fn<WechatFetch>(async () => response)
    await expect(gateway(fetchImpl).exchangeLoginCode(LOGIN_CODE))
      .rejects.toMatchObject({ errorCode })
  })

  it.each([
    { tokenResponse: new Response('down', { status: 503 }), errorCode: 'wechat_http_error' },
    { tokenResponse: new Response('{broken', { status: 200 }), errorCode: 'wechat_response_invalid' },
    { tokenResponse: jsonResponse({ errcode: 40013 }), errorCode: 'wechat_access_token_rejected' },
    { tokenResponse: jsonResponse({ access_token: '', expires_in: 7200 }), errorCode: 'wechat_response_invalid' },
  ])('stable token 失败映射稳定错误：$errorCode', async ({ tokenResponse, errorCode }) => {
    const fetchImpl = vi.fn<WechatFetch>(async () => tokenResponse)
    await expect(gateway(fetchImpl).exchangePhoneCode(PHONE_CODE))
      .rejects.toMatchObject({ errorCode })
  })

  it.each([
    { phoneResponse: new Response('down', { status: 502 }), errorCode: 'wechat_http_error' },
    { phoneResponse: new Response('{broken', { status: 200 }), errorCode: 'wechat_response_invalid' },
    { phoneResponse: jsonResponse({ errcode: 45011 }), errorCode: 'wechat_phone_rejected' },
  ])('手机号端点失败映射稳定错误：$errorCode', async ({ phoneResponse, errorCode }) => {
    const fetchImpl = vi.fn<WechatFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(phoneResponse)
    await expect(gateway(fetchImpl).exchangePhoneCode(PHONE_CODE))
      .rejects.toMatchObject({ errorCode })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([
    { phone: '+1 2025550100' },
    { phone: '12800001111' },
    { phone: '' },
  ])('只接受并规范化中国大陆手机号：$phone', async ({ phone }) => {
    const fetchImpl = vi.fn<WechatFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({
        errcode: 0,
        phone_info: { phoneNumber: phone, purePhoneNumber: phone },
      }))
    await expect(gateway(fetchImpl).exchangePhoneCode(PHONE_CODE))
      .rejects.toMatchObject({ errorCode: 'wechat_phone_invalid' })
  })

  it('异常与所有 logger 参数不含 secret/token/openid/session_key/完整手机号/code', async () => {
    const accessToken = 'access-token-sensitive'
    const openId = 'openid-sensitive'
    const sessionKey = 'session_key-sensitive'
    const phone = '13899998888'
    const loggerError = vi.fn()
    const logger: WechatGatewayLogger = { error: loggerError }
    const fetchImpl = vi.fn<WechatFetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: accessToken, expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({
        errcode: 45011,
        errmsg: `${APP_SECRET}:${accessToken}:${openId}:${sessionKey}:${phone}:${PHONE_CODE}`,
      }))

    let caught: unknown
    try {
      await gateway(fetchImpl, { logger }).exchangePhoneCode(PHONE_CODE)
    } catch (error) {
      caught = error
    }

    const serialized = JSON.stringify({ caught, logs: loggerError.mock.calls })
    for (const sensitive of [APP_SECRET, accessToken, openId, sessionKey, phone, PHONE_CODE]) {
      expect(serialized).not.toContain(sensitive)
    }
    expect(loggerError).toHaveBeenCalledWith({
      operation: 'exchange_phone_code',
      errorCode: 'wechat_phone_rejected',
    })
  })

  it('fetch 抛出的敏感异常也只记录安全 operation + errorCode', async () => {
    const loggerError = vi.fn()
    const sensitive = `${APP_SECRET}:${LOGIN_CODE}:openid:session_key:13899998888`
    const fetchImpl = vi.fn<WechatFetch>(async () => {
      throw Object.assign(new Error(sensitive), { cause: { sensitive } })
    })

    await expect(gateway(fetchImpl, { logger: { error: loggerError } }).exchangeLoginCode(LOGIN_CODE))
      .rejects.toMatchObject({ errorCode: 'wechat_network_error' })
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(sensitive)
    expect(loggerError).toHaveBeenCalledWith({
      operation: 'exchange_login_code',
      errorCode: 'wechat_network_error',
    })
  })

  it('logger 同步抛错也隔离，仍抛原始映射后的安全 gateway 错误', async () => {
    const sensitive = `${APP_SECRET}:${LOGIN_CODE}:openid:session_key:13899998888`
    const loggerError = vi.fn(() => {
      throw Object.assign(new Error(sensitive), { cause: { sensitive } })
    })
    const fetchImpl = vi.fn<WechatFetch>(async () => jsonResponse({
      errcode: 40029,
      errmsg: sensitive,
    }))

    let caught: unknown
    try {
      await gateway(fetchImpl, { logger: { error: loggerError } }).exchangeLoginCode(LOGIN_CODE)
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      name: 'WechatGatewayError',
      message: 'wechat_login_rejected',
      errorCode: 'wechat_login_rejected',
    })
    expect(JSON.stringify(caught)).not.toContain(sensitive)
    expect(loggerError).toHaveBeenCalledWith({
      operation: 'exchange_login_code',
      errorCode: 'wechat_login_rejected',
    })
  })

  it('公开源码没有通用 exchangeCode(kind) 或 code 消费缓存', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'src/lib/mini-program/wechat-gateway.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/\bexchangeCode\b/)
    expect(source).not.toMatch(/(?:login|phone)CodeCache/)
  })
})
