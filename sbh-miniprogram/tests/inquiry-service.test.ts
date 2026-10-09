import { readFile } from 'node:fs/promises'

import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  createPhoneCodeAttempt,
  createInquiryService,
  createSubmissionIntentManager,
  generateSubmissionRequestId,
  type InquiryInput,
  type InquiryResult,
  type RandomValueSource,
} from '../miniprogram/services/inquiry.js'
import type { RequestOptions } from '../miniprogram/services/mini-api-contracts.js'
import { createRequestClient } from '../miniprogram/services/request.js'

const SUBMISSION_ID = '550e8400-e29b-41d4-a716-446655440000'
const ZERO_UUID = '00000000-0000-4000-8000-000000000000'
const SUCCESS_DATA = Object.freeze({
  accepted: true as const,
  acceptedExisting: false,
  targetResolution: 'listing' as const,
})
const SUCCESS_RESULT = Object.freeze({ ok: true as const, ...SUCCESS_DATA })

function createAuthenticatedInquiryService(
  request: Parameters<typeof createInquiryService>[0]['request'],
  options: Omit<Parameters<typeof createInquiryService>[0], 'request' | 'getAnonymousContextToken'> = {},
) {
  return createInquiryService({
    request,
    getAnonymousContextToken: () => 'anonymous-token',
    ...options,
  })
}

function manualInput(overrides: Partial<InquiryInput> = {}): InquiryInput {
  return {
    submissionRequestId: SUBMISSION_ID,
    target: { targetType: 'listing', listingSlug: 'listing-1' },
    phone: '13800138000',
    consent: { accepted: true, policyVersion: 'MVP-R1' },
    ...overrides,
  }
}

function parsedSuccessRequest() {
  return vi.fn(async (options: RequestOptions<unknown>) => options.parse(SUCCESS_DATA))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('咨询请求运行时合同', () => {
  it.each([
    {
      target: { targetType: 'listing', listingSlug: 'listing-1', buildingSlug: 'building-1' },
    },
    { target: { targetType: 'building', buildingSlug: 'building-1' } },
    { target: { targetType: 'general' } },
  ] as const)('精确序列化 $target.targetType 联合目标', async ({ target }) => {
    const request = parsedSuccessRequest()
    const service = createAuthenticatedInquiryService(request)

    await service.submit({
      submissionRequestId: SUBMISSION_ID,
      target,
      phone: '13800138000',
      consent: { accepted: true, policyVersion: 'MVP-R1' },
    })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining(target),
    }))
  })

  it.each([
    { targetType: 'listing', buildingSlug: 'building-1' },
    { targetType: 'building', listingSlug: 'listing-1', buildingSlug: 'building-1' },
    { targetType: 'general', listingSlug: 'listing-1' },
    { targetType: 'general', buildingSlug: 'building-1' },
  ])('本地拒绝缺失或互斥目标字段：$targetType', async (target) => {
    const request = parsedSuccessRequest()
    const service = createAuthenticatedInquiryService(request)

    await expect(service.submit({
      submissionRequestId: SUBMISSION_ID,
      target,
      phone: '13800138000',
      consent: { accepted: true, policyVersion: 'MVP-R1' },
    })).resolves.toEqual({ ok: false, code: 'invalid_request' })
    expect(request).not.toHaveBeenCalled()
  })

  it('导出 Task8 所需输入与结果类型', () => {
    expectTypeOf<InquiryInput>().toMatchTypeOf<object>()
    expectTypeOf<InquiryResult>().toMatchTypeOf<
      | Readonly<{ ok: true; accepted: true; acceptedExisting: boolean; targetResolution: 'listing' | 'building' | 'general' }>
      | Readonly<{ ok: false; code: string; requiresNewPhoneAuthorization?: true }>
    >()
  })

  it('精确发送白名单 body，并规范化手填手机号与 moveInTime', async () => {
    const request = parsedSuccessRequest()
    const service = createAuthenticatedInquiryService(request)

    await expect(service.submit(manualInput({
      target: { targetType: 'listing', listingSlug: 'listing-1', buildingSlug: 'building-1' },
      moveInTime: '  2026 年 10 月  ',
      phone: '+86 138-0013-(8000)',
      priceSnapshot: {
        amount: 88.5,
        currency: 'CNY',
        period: 'month',
        unit: 'rmb-sqm-month',
      },
    }))).resolves.toEqual(SUCCESS_RESULT)

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        submissionRequestId: SUBMISSION_ID,
        targetType: 'listing',
        listingSlug: 'listing-1',
        buildingSlug: 'building-1',
        moveInTime: '2026 年 10 月',
        phone: '13800138000',
        consent: { accepted: true, policyVersion: 'MVP-R1' },
        priceSnapshot: {
          amount: 88.5,
          currency: 'CNY',
          period: 'month',
          unit: 'rmb-sqm-month',
        },
      },
    }))
  })

  it.each([
    ['uppercase UUID', { submissionRequestId: SUBMISSION_ID.toUpperCase() }],
    ['non-v4 UUID', { submissionRequestId: '550e8400-e29b-11d4-a716-446655440000' }],
    ['unsafe listing slug', { target: { targetType: 'listing', listingSlug: '../listing-1' } }],
    ['unsafe building slug', {
      target: { targetType: 'listing', listingSlug: 'listing-1', buildingSlug: 'Building-1' },
    }],
    ['non-string moveInTime', { moveInTime: 123 }],
    ['too-long trimmed moveInTime', { moveInTime: `  ${'入'.repeat(101)}  ` }],
    ['empty policy version', { consent: { accepted: true, policyVersion: '' } }],
    ['unsafe policy version', { consent: { accepted: true, policyVersion: 'MVP R1' } }],
    ['too-long policy version', { consent: { accepted: true, policyVersion: 'v'.repeat(101) } }],
  ] as const)('本地拒绝 %s，且不调用 transport', async (_label, override) => {
    const request = parsedSuccessRequest()
    const service = createAuthenticatedInquiryService(request)

    await expect(service.submit({ ...manualInput(), ...override })).resolves.toEqual({
      ok: false,
      code: 'invalid_request',
    })
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    ['missing amount', { currency: 'CNY', period: 'month', unit: 'rmb-month' }],
    ['extra key', { amount: 1, currency: 'CNY', period: 'month', unit: 'rmb-month', total: 1 }],
    ['zero', { amount: 0, currency: 'CNY', period: 'month', unit: 'rmb-month' }],
    ['negative', { amount: -1, currency: 'CNY', period: 'month', unit: 'rmb-month' }],
    ['NaN', { amount: Number.NaN, currency: 'CNY', period: 'month', unit: 'rmb-month' }],
    ['infinite', { amount: Number.POSITIVE_INFINITY, currency: 'CNY', period: 'month', unit: 'rmb-month' }],
    ['above upper bound', { amount: 1_000_000_000_001, currency: 'CNY', period: 'month', unit: 'rmb-month' }],
    ['bad currency', { amount: 1, currency: 'USD', period: 'month', unit: 'rmb-month' }],
    ['bad period', { amount: 1, currency: 'CNY', period: 'week', unit: 'rmb-month' }],
    ['bad unit', { amount: 1, currency: 'CNY', period: 'month', unit: 'free-text' }],
  ] as const)('本地拒绝畸形 priceSnapshot：%s', async (_label, priceSnapshot) => {
    const request = parsedSuccessRequest()
    const service = createAuthenticatedInquiryService(request)

    await expect(service.submit({
      ...manualInput(),
      priceSnapshot,
    })).resolves.toEqual({ ok: false, code: 'invalid_request' })
    expect(request).not.toHaveBeenCalled()
  })

  it('拒绝未知 own key、继承字段、原型污染和嵌套非 own 字段', async () => {
    const request = parsedSuccessRequest()
    const service = createAuthenticatedInquiryService(request)
    const unknownTopLevel = { ...manualInput(), name: '客户端伪造姓名' }
    const pollutedTopLevel = Object.assign(Object.create({ role: 'admin' }), manualInput())
    const inheritedConsent = Object.create({ accepted: true, policyVersion: 'MVP-R1' })
    const inheritedPrice = Object.assign(
      Object.create({ amount: 1 }),
      { currency: 'CNY', period: 'month', unit: 'rmb-month' },
    )

    for (const input of [
      unknownTopLevel,
      pollutedTopLevel,
      { ...manualInput(), consent: inheritedConsent },
      { ...manualInput(), priceSnapshot: inheritedPrice },
    ]) {
      await expect(service.submit(input)).resolves.toEqual({
        ok: false,
        code: 'invalid_request',
      })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('严格要求 phoneCode xor phone，并拒绝不合法的手填手机号', async () => {
    const request = parsedSuccessRequest()
    const service = createAuthenticatedInquiryService(request)
    const attempt = createPhoneCodeAttempt('phone-code')

    await expect(service.submit({ ...manualInput(), phoneCode: attempt }))
      .resolves.toEqual({ ok: false, code: 'invalid_request' })
    const withoutPhone = { ...manualInput() } as Record<string, unknown>
    delete withoutPhone.phone
    await expect(service.submit(withoutPhone))
      .resolves.toEqual({ ok: false, code: 'invalid_request' })
    await expect(service.submit(manualInput({ phone: '+86 128-0000-1111' })))
      .resolves.toEqual({ ok: false, code: 'invalid_request' })
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['', 'x'.repeat(129)])('拒绝非法 phoneCode 长度且不消费 cleanup：%s', async (code) => {
    const request = parsedSuccessRequest()
    const cleanup = vi.fn()
    const service = createAuthenticatedInquiryService(request)

    await expect(service.submit({
      submissionRequestId: SUBMISSION_ID,
      target: { targetType: 'listing', listingSlug: 'listing-1' },
      phoneCode: createPhoneCodeAttempt(code, cleanup),
      consent: { accepted: true, policyVersion: 'MVP-R1' },
    })).resolves.toEqual({ ok: false, code: 'invalid_request' })
    expect(cleanup).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it.each([
    { accepted: true, acceptedExisting: 'false', targetResolution: 'listing' },
    { accepted: true, acceptedExisting: false, targetResolution: 'unknown' },
    { accepted: true, acceptedExisting: false, targetResolution: 'listing', meta: {} },
  ])('严格解析 acceptedExisting/targetResolution 且拒绝 data 额外字段', async (response) => {
    const request = vi.fn(async (options: RequestOptions<unknown>) => options.parse(response))
    const service = createAuthenticatedInquiryService(request)

    await expect(service.submit(manualInput())).resolves.toEqual({
      ok: false,
      code: 'network_error',
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('phoneCode 一次性边界与错误映射', () => {
  it('本地校验失败不消费 code，修正输入后仍可完成唯一一次 POST', async () => {
    const request = parsedSuccessRequest()
    const cleanup = vi.fn()
    const attempt = createPhoneCodeAttempt('phone-code', cleanup)
    const service = createAuthenticatedInquiryService(request)

    await expect(service.submit({
      submissionRequestId: 'invalid-id',
      target: { targetType: 'listing', listingSlug: 'listing-1' },
      phoneCode: attempt,
      consent: { accepted: true, policyVersion: 'MVP-R1' },
    })).resolves.toEqual({ ok: false, code: 'invalid_request' })
    expect(cleanup).not.toHaveBeenCalled()

    await expect(service.submit({
      submissionRequestId: SUBMISSION_ID,
      target: { targetType: 'listing', listingSlug: 'listing-1' },
      phoneCode: attempt,
      consent: { accepted: true, policyVersion: 'MVP-R1' },
    })).resolves.toEqual(SUCCESS_RESULT)
    expect(request).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('cleanup 抛错也保持 code one-shot，第二次不进入 transport 并提示重新授权', async () => {
    const request = parsedSuccessRequest()
    const attempt = createPhoneCodeAttempt('phone-code', () => {
      throw new Error('cleanup secret')
    })
    const input: InquiryInput = {
      submissionRequestId: SUBMISSION_ID,
      target: { targetType: 'listing', listingSlug: 'listing-1' },
      phoneCode: attempt,
      consent: { accepted: true, policyVersion: 'MVP-R1' },
    }
    const service = createAuthenticatedInquiryService(request)

    await expect(service.submit(input)).resolves.toEqual(SUCCESS_RESULT)
    await expect(service.submit(input)).resolves.toEqual({
      ok: false,
      code: 'phone_code_consumed',
      requiresNewPhoneAuthorization: true,
    })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([
    'phone_code_consumed',
    'inquiry_submit_failed',
    'session_invalid',
    'invalid_request',
    'rate_limited',
    'service_unavailable',
    'network_error',
    'request_timeout',
  ] as const)('已发起授权 POST 后稳定映射 %s 并要求新授权', async (code) => {
    const sensitiveError = Object.create(null) as { code: string; message?: string }
    Object.defineProperty(sensitiveError, 'code', { value: code, enumerable: true })
    Object.defineProperty(sensitiveError, 'message', {
      enumerable: true,
      get: () => { throw new Error('不应读取中文文案或敏感 message') },
    })
    const request = vi.fn(async () => { throw sensitiveError })
    const clearAnonymousContext = vi.fn(() => {
      if (code === 'session_invalid') throw new Error('clear failure with secret')
    })
    const attempt = createPhoneCodeAttempt('phone-code')
    const service = createAuthenticatedInquiryService(request, { clearAnonymousContext })

    const input: InquiryInput = {
      submissionRequestId: SUBMISSION_ID,
      target: { targetType: 'listing', listingSlug: 'listing-1' },
      phoneCode: attempt,
      consent: { accepted: true, policyVersion: 'MVP-R1' },
    }
    await expect(service.submit(input)).resolves.toEqual({
      ok: false,
      code,
      requiresNewPhoneAuthorization: true,
    })
    await expect(service.submit(input)).resolves.toEqual({
      ok: false,
      code: 'phone_code_consumed',
      requiresNewPhoneAuthorization: true,
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(clearAnonymousContext).toHaveBeenCalledTimes(code === 'session_invalid' ? 1 : 0)
  })

  it('手填 POST 失败保留号码，不返回重新授权提示', async () => {
    const request = vi.fn(async () => { throw { code: 'session_invalid', message: 'ignored' } })
    const clearAnonymousContext = vi.fn()
    const service = createAuthenticatedInquiryService(request, { clearAnonymousContext })

    await expect(service.submit(manualInput())).resolves.toEqual({
      ok: false,
      code: 'session_invalid',
    })
    expect(clearAnonymousContext).toHaveBeenCalledTimes(1)
  })

  it('未知异常稳定折叠为 network_error，且授权 code 仍视为已消费', async () => {
    const request = vi.fn(async () => { throw new Error('private upstream payload') })
    const service = createAuthenticatedInquiryService(request)

    await expect(service.submit({
      submissionRequestId: SUBMISSION_ID,
      target: { targetType: 'listing', listingSlug: 'listing-1' },
      phoneCode: createPhoneCodeAttempt('phone-code'),
      consent: { accepted: true, policyVersion: 'MVP-R1' },
    })).resolves.toEqual({
      ok: false,
      code: 'network_error',
      requiresNewPhoneAuthorization: true,
    })
  })

  it('匿名 token 只读取一次快照，null 时在 transport 与 phoneCode 消费前失败', async () => {
    const request = parsedSuccessRequest()
    const getAnonymousContextToken = vi.fn()
      .mockReturnValueOnce('anonymous-token')
      .mockReturnValueOnce('different-token-must-not-be-read')
    const service = createInquiryService({ request, getAnonymousContextToken })

    await service.submit(manualInput())
    expect(getAnonymousContextToken).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      anonymousContextToken: 'anonymous-token',
    }))

    const noTokenRequest = parsedSuccessRequest()
    const noTokenService = createInquiryService({
      request: noTokenRequest,
      getAnonymousContextToken: () => null,
    })
    const cleanup = vi.fn()
    await expect(noTokenService.submit({
      ...manualInput(),
      phone: undefined,
      phoneCode: createPhoneCodeAttempt('phone-code', cleanup),
    })).resolves.toEqual({ ok: false, code: 'session_invalid' })
    expect(noTokenRequest).not.toHaveBeenCalled()
    expect(cleanup).not.toHaveBeenCalled()
  })
})

describe('submissionRequestId 高熵生成与 intent 生命周期', () => {
  it('默认路径适配真实 wx.getRandomValues callback 结果并设置 UUID v4/variant', async () => {
    const getRandomValues = vi.fn((options: {
      length: number
      success?: (result: { randomValues: ArrayBuffer; errMsg: string }) => void
    }) => {
      const bytes = Uint8Array.from({ length: 16 }, (_, index) => index)
      options.success?.({ randomValues: bytes.buffer, errMsg: 'getRandomValues:ok' })
    })
    vi.stubGlobal('wx', { getRandomValues })

    await expect(generateSubmissionRequestId()).resolves.toBe(
      '00010203-0405-4607-8809-0a0b0c0d0e0f',
    )
    expect(getRandomValues).toHaveBeenCalledWith(expect.objectContaining({
      length: 16,
      success: expect.any(Function),
      fail: expect.any(Function),
    }))
  })

  it('默认随机 API 失败、缺失或返回错误长度时 fail-closed', async () => {
    vi.stubGlobal('wx', {
      getRandomValues: (options: { fail?: (error: unknown) => void }) => {
        options.fail?.({ errMsg: 'secret random failure' })
      },
    })
    await expect(generateSubmissionRequestId()).rejects.toThrow('random values unavailable')

    vi.stubGlobal('wx', {})
    await expect(generateSubmissionRequestId()).rejects.toThrow('random values unavailable')

    vi.stubGlobal('wx', {
      getRandomValues: (options: {
        success?: (result: { randomValues: ArrayBuffer }) => void
      }) => options.success?.({ randomValues: new Uint8Array(15).buffer }),
    })
    await expect(generateSubmissionRequestId()).rejects.toThrow('invalid random length')

    const shortSource: RandomValueSource = async () => new Uint8Array(15)
    await expect(generateSubmissionRequestId(shortSource)).rejects.toThrow('invalid random length')
  })

  it('异步注入固定 16 字节向量，且不修改调用方缓冲区', async () => {
    const bytes = new Uint8Array(16)
    const source: RandomValueSource = vi.fn(async ({ length }) => {
      expect(length).toBe(16)
      return bytes
    })

    await expect(generateSubmissionRequestId(source)).resolves.toBe(ZERO_UUID)
    expect(bytes).toEqual(new Uint8Array(16))
  })

  it('同 target 并发 open 只生成一次，并复用 current intent', async () => {
    const random = deferred<Uint8Array>()
    const source = vi.fn(async () => random.promise)
    const manager = createSubmissionIntentManager(source)

    const first = manager.open('listing-1')
    const second = manager.open('listing-1')
    expect(source).toHaveBeenCalledTimes(1)
    random.resolve(new Uint8Array(16))
    await expect(Promise.all([first, second])).resolves.toEqual([ZERO_UUID, ZERO_UUID])
    expect(manager.current()).toEqual({ target: 'listing-1', submissionRequestId: ZERO_UUID })
    await expect(manager.open('listing-1')).resolves.toBe(ZERO_UUID)
    expect(source).toHaveBeenCalledTimes(1)
  })

  it('target 变化启动新 generation，旧 target 迟到不能覆盖 current', async () => {
    const firstRandom = deferred<Uint8Array>()
    const secondRandom = deferred<Uint8Array>()
    const source = vi.fn()
      .mockImplementationOnce(async () => firstRandom.promise)
      .mockImplementationOnce(async () => secondRandom.promise)
    const manager = createSubmissionIntentManager(source)

    const oldOpen = manager.open('listing-old')
    const newOpen = manager.open('listing-new')
    const secondBytes = new Uint8Array(16)
    secondBytes[15] = 1
    secondRandom.resolve(secondBytes)
    const newId = await newOpen
    expect(manager.current()).toEqual({ target: 'listing-new', submissionRequestId: newId })

    firstRandom.resolve(new Uint8Array(16))
    await expect(oldOpen).resolves.toBeNull()
    expect(manager.current()).toEqual({ target: 'listing-new', submissionRequestId: newId })
  })

  it('invalidate 压过 pending，之后同 target 会生成新 intent', async () => {
    const firstRandom = deferred<Uint8Array>()
    const source = vi.fn()
      .mockImplementationOnce(async () => firstRandom.promise)
      .mockImplementationOnce(async () => {
        const bytes = new Uint8Array(16)
        bytes[15] = 2
        return bytes
      })
    const manager = createSubmissionIntentManager(source)
    const stale = manager.open('listing-1')

    manager.invalidate()
    expect(manager.current()).toBeNull()
    firstRandom.resolve(new Uint8Array(16))
    await expect(stale).resolves.toBeNull()

    const fresh = await manager.open('listing-1')
    expect(fresh).not.toBe(ZERO_UUID)
    expect(manager.current()?.submissionRequestId).toBe(fresh)
    expect(source).toHaveBeenCalledTimes(2)
  })

  it('生成器源码不含 Math.random 降级', async () => {
    const source = await readFile(new URL('../miniprogram/services/inquiry.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('Math.random')
  })
})

describe('真实 request client → inquiry 集成', () => {
  it('outer meta 使用不同 HTTP ID，结果不含 requestId，submission 保持且 POST 仅一次', async () => {
    const transport = vi.fn(async (input: { data: unknown }) => ({
      statusCode: 200,
      data: {
        ok: true,
        data: { accepted: true, acceptedExisting: true, targetResolution: 'general' },
        meta: { requestId: 'server-http-request-id' },
      },
      headers: { 'x-request-id': 'server-http-request-id' },
      input,
    }))
    const request = createRequestClient({
      environment: () => ({ stage: 'development' as const, transport: 'http' as const, apiBaseUrl: 'http://127.0.0.1:3717' }),
      transport,
    })
    const service = createAuthenticatedInquiryService(request)

    const result = await service.submit(manualInput())

    expect(result).toEqual({
      ok: true,
      accepted: true,
      acceptedExisting: true,
      targetResolution: 'general',
    })
    expect(result).not.toHaveProperty('requestId')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      data: expect.objectContaining({ submissionRequestId: SUBMISSION_ID }),
    }))
  })
})
