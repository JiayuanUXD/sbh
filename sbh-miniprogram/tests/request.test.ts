import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  MiniApiError,
  createRequestClient,
  type RequestDependencies,
  type RequestTransportInput,
  type RequestTransportResponse,
} from '../miniprogram/services/request.js'
import type { RuntimeEnvironment } from '../miniprogram/config/environment.js'
import type {
  MiniApiReadMeta,
  MiniApiSuccess,
  MiniApiWriteMeta,
  RequestOptions,
} from '../miniprogram/services/mini-api-contracts.js'

const environment = {
  stage: 'development' as const,
  transport: 'http' as const,
  apiBaseUrl: 'http://127.0.0.1:3717',
}

const parseUnknown = (value: unknown): unknown => value

type TransportFailure = Error | Readonly<{ errMsg: string }>
type TransportOutcome = RequestTransportResponse | TransportFailure

function isRequestTransportResponse(outcome: TransportOutcome): outcome is RequestTransportResponse {
  return !(outcome instanceof Error) && 'statusCode' in outcome && 'data' in outcome
}

function createClient(
  outcomes: readonly TransportOutcome[],
  runtimeEnvironment: RuntimeEnvironment = environment,
) {
  let index = 0
  const transport = vi.fn(async (_input: RequestTransportInput): Promise<RequestTransportResponse> => {
    const outcome = outcomes[index]
    index += 1

    if (!outcome) {
      throw new Error('测试 transport 缺少预期响应')
    }

    if (isRequestTransportResponse(outcome)) {
      return outcome
    }

    throw outcome
  })

  const environmentProvider = vi.fn(() => runtimeEnvironment)
  const dependencies: RequestDependencies = {
    environment: environmentProvider,
    transport,
  }

  return { request: createRequestClient(dependencies), transport, environmentProvider }
}

const success = (data: unknown, requestId = 'body-request-id'): RequestTransportResponse => ({
  statusCode: 200,
  data: {
    ok: true,
    data,
    meta: {
      requestId,
      asOf: '2026-08-26T08:00:00.000Z',
      maxAgeSeconds: 300,
    },
  },
  headers: { 'x-request-id': 'header-request-id' },
})

const failure = (
  statusCode: number,
  code: string,
  requestId = 'body-request-id',
): RequestTransportResponse => ({
  statusCode,
  data: {
    ok: false,
    error: {
      code,
      message: '<html>服务器内部堆栈</html>',
    },
    meta: { requestId },
  },
  headers: { 'X-Request-Id': 'header-request-id' },
})

describe('Mini API 请求层', () => {
  it('MiniApiSuccess 默认 read meta，并可显式约束 write meta', () => {
    expectTypeOf<MiniApiSuccess<{ listings: number }>['meta']>()
      .toEqualTypeOf<MiniApiReadMeta>()
    expectTypeOf<MiniApiSuccess<{ accepted: true }, MiniApiWriteMeta>['meta']>()
      .toEqualTypeOf<MiniApiWriteMeta>()
  })

  it('发送默认 GET、JSON Accept、十秒超时，并返回 success.data', async () => {
    const { request, transport } = createClient([success({ listingIds: ['listing-1'] })])

    await expect(request({ path: '/api/mini/v1/listings?city=shanghai', parse: parseUnknown })).resolves.toEqual({
      listingIds: ['listing-1'],
    })
    expect(transport).toHaveBeenCalledWith({
      environment,
      path: '/api/mini/v1/listings?city=shanghai',
      method: 'GET',
      timeoutMs: 10_000,
      headers: { Accept: 'application/json' },
      data: undefined,
    })
  })

  it('trial 将 CloudBase 环境与原始受控 path 交给 transport，不生成 undefined URL', async () => {
    const cloudEnvironment: RuntimeEnvironment = {
      stage: 'staging',
      transport: 'cloud-container',
      cloudEnvId: 'sbhmini-d5g7d6732b2c64a66',
      cloudServiceName: 'sbhmini',
      deploymentIdentity: {
        gitCommitSha: 'a'.repeat(40),
        serverDeploymentRevision: 'sbhmini-016',
      },
    }
    const { request, transport } = createClient([success({ listings: [] })], cloudEnvironment)

    await expect(request({ path: '/api/mini/v1/listings?city=shanghai', parse: parseUnknown })).resolves.toEqual({ listings: [] })
    expect(transport).toHaveBeenCalledWith({
      environment: cloudEnvironment,
      path: '/api/mini/v1/listings?city=shanghai',
      method: 'GET',
      timeoutMs: 10_000,
      headers: { Accept: 'application/json' },
      data: undefined,
    })
    expect(transport.mock.calls[0]?.[0]).not.toHaveProperty('url')
  })

  it('POST 成功只要求 write requestId，不要求 GET freshness meta，并按受限 token 生成 Authorization', async () => {
    const { request, transport } = createClient([{
      statusCode: 200,
      data: { ok: true, data: { accepted: true }, meta: { requestId: 'write-request-id' } },
    }])

    await expect(request({
      path: '/api/mini/v1/inquiries',
      method: 'POST',
      data: { submissionRequestId: 'submission-1' },
      anonymousContextToken: 'token.with-safe_chars~1',
      parse: parseUnknown,
    })).resolves.toEqual({ accepted: true })
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer token.with-safe_chars~1',
      },
    }))
  })

  it('GET 拒绝 write-only meta，POST 仍校验 outer write requestId 且 parser 只收到 data', async () => {
    const getClient = createClient([{
      statusCode: 200,
      data: { ok: true, data: { listings: 1 }, meta: { requestId: 'read-id' } },
    }])
    await expect(getClient.request({ path: '/api/mini/v1/home', parse: parseUnknown }))
      .rejects.toMatchObject({ kind: 'protocol', code: 'invalid_response' })

    const parser = vi.fn(parseUnknown)
    const postClient = createClient([{
      statusCode: 200,
      data: {
        ok: true,
        data: { accepted: true },
        meta: { requestId: 'write-id' },
      },
    }])
    await expect(postClient.request({
      path: '/api/mini/v1/inquiries',
      method: 'POST',
      data: { submissionRequestId: 'submission-id' },
      parse: parser,
    })).resolves.toEqual({ accepted: true })
    expect(parser).toHaveBeenCalledWith({ accepted: true })

    const invalidWriteClient = createClient([{
      statusCode: 200,
      data: { ok: true, data: { accepted: true }, meta: { requestId: '' } },
    }])
    await expect(invalidWriteClient.request({
      path: '/api/mini/v1/inquiries',
      method: 'POST',
      data: { submissionRequestId: 'submission-id' },
      parse: parseUnknown,
    })).rejects.toMatchObject({ kind: 'protocol', code: 'invalid_response' })
  })

  it('GET 不允许携带匿名 token', async () => {
    const { request, transport } = createClient([success({ unreachable: true })])

    await expect(request({
      path: '/api/mini/v1/home',
      anonymousContextToken: 'token',
      parse: parseUnknown,
    })).rejects.toMatchObject({ kind: 'protocol', code: 'invalid_authentication' })
    expect(transport).not.toHaveBeenCalled()
  })

  it.each(['', 'token with spaces', 'x'.repeat(4097)])(
    '写请求在 transport 前拒绝非法 anonymousContextToken：%s',
    async (anonymousContextToken) => {
      const { request, transport } = createClient([success({ unreachable: true })])

      await expect(request({
        path: '/api/mini/v1/inquiries',
        method: 'POST',
        anonymousContextToken,
        parse: parseUnknown,
      })).rejects.toMatchObject({ kind: 'protocol', code: 'invalid_authentication' })
      expect(transport).not.toHaveBeenCalled()
    },
  )

  it('强制类型传入任意 headers 也不会覆盖受控 Accept/Authorization', async () => {
    const { request, transport } = createClient([{
      statusCode: 200,
      data: { ok: true, data: { accepted: true }, meta: { requestId: 'write-id' } },
    }])
    const unsafeRequest = request as (options: RequestOptions<unknown> & {
      headers: Readonly<Record<string, string>>
    }) => Promise<unknown>

    await unsafeRequest({
      path: '/api/mini/v1/inquiries',
      method: 'POST',
      anonymousContextToken: 'trusted-token',
      headers: { Authorization: 'Bearer attacker', 'X-Admin': 'true' },
      parse: parseUnknown,
    })
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer trusted-token',
      },
    }))
  })

  it('将 200 业务失败转为只依赖稳定 code 的本地错误文案', async () => {
    const { request } = createClient([failure(200, 'city_not_found')])

    await expect(request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
      name: 'MiniApiError',
      kind: 'business',
      code: 'city_not_found',
      requestId: 'body-request-id',
      retryable: false,
      message: '未找到该城市',
    })
  })

  it('将 4xx 的合法 failure envelope 作为业务错误，并保留 body requestId', async () => {
    const { request } = createClient([failure(404, 'listing_not_found')])

    await expect(request({ path: '/api/mini/v1/listings/missing', parse: parseUnknown })).rejects.toMatchObject({
      kind: 'business',
      code: 'listing_not_found',
      requestId: 'body-request-id',
      message: '未找到该房源',
    })
  })

  it('将非 JSON、错误 ok 类型和 2xx 畸形 envelope 作为 protocol 错误', async () => {
    const cases: readonly RequestTransportResponse[] = [
      { statusCode: 200, data: '<html>upstream stack trace</html>' },
      { statusCode: 200, data: { ok: 'true' } },
      { statusCode: 204, data: null },
    ]

    for (const response of cases) {
      const { request } = createClient([response])

      await expect(request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
        kind: 'protocol',
        code: 'invalid_response',
        message: '服务响应异常，请稍后重试',
      })
    }
  })

  it('对无 body requestId 的 HTTP 错误大小写不敏感地读取 X-Request-Id', async () => {
    const { request } = createClient([
      {
        statusCode: 502,
        data: '<html>gateway trace</html>',
        headers: { 'x-ReQuEsT-iD': 'header-fallback-id' },
      },
      {
        statusCode: 502,
        data: '<html>gateway trace</html>',
        headers: { 'x-ReQuEsT-iD': 'header-fallback-id' },
      },
    ])

    await expect(request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
      kind: 'http',
      statusCode: 502,
      requestId: 'header-fallback-id',
      retryable: true,
      message: '服务暂不可用，请稍后重试',
    })
  })

  it('GET 遇到网络错误最多重试一次', async () => {
    const { request, transport } = createClient([
      new Error('request:fail interrupted'),
      success({ ok: true }),
    ])

    await expect(request({ path: '/api/mini/v1/home', parse: parseUnknown })).resolves.toEqual({ ok: true })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it('GET 遇到超时或 5xx 最多重试一次，最终错误保留错误类别与可重试性', async () => {
    const timeoutClient = createClient([
      { errMsg: 'request:fail timeout' },
      { errMsg: 'request:fail timeout' },
    ])

    await expect(timeoutClient.request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
      statusCode: null,
    })
    expect(timeoutClient.transport).toHaveBeenCalledTimes(2)

    const serverClient = createClient([
      { statusCode: 503, data: null, headers: { 'X-Request-Id': 'retry-id' } },
      success({ recovered: true }),
    ])

    await expect(serverClient.request({ path: '/api/mini/v1/home', parse: parseUnknown })).resolves.toEqual({
      recovered: true,
    })
    expect(serverClient.transport).toHaveBeenCalledTimes(2)
  })

  it('GET 的 4xx、业务错误、协议错误都不重试', async () => {
    const httpClient = createClient([{ statusCode: 401, data: null }])
    await expect(httpClient.request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
      kind: 'http',
      retryable: false,
    })
    expect(httpClient.transport).toHaveBeenCalledTimes(1)

    const businessClient = createClient([failure(200, 'service_unavailable')])
    await expect(businessClient.request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
      kind: 'business',
      retryable: false,
    })
    expect(businessClient.transport).toHaveBeenCalledTimes(1)

    const protocolClient = createClient([{ statusCode: 200, data: { ok: true } }])
    await expect(protocolClient.request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toBeInstanceOf(MiniApiError)
    expect(protocolClient.transport).toHaveBeenCalledTimes(1)
  })

  it.each(['POST', 'PUT', 'DELETE'] as const)(
    '写方法 %s 遇到可重试错误也只请求一次',
    async (method) => {
      const { request, transport } = createClient([
        new Error('request:fail timeout'),
        success({ shouldNotReach: true }),
      ])

      await expect(request({
        path: '/api/mini/v1/inquiries',
        method,
        data: { name: '张三' },
        parse: parseUnknown,
      })).rejects.toMatchObject({
        kind: 'timeout',
        retryable: false,
      })
      expect(transport).toHaveBeenCalledTimes(1)
    },
  )

  it('在运行时拒绝越出 Mini API 前缀或注入绝对 URL 的强制类型路径', async () => {
    const { request, transport, environmentProvider } = createClient([success({ unreachable: true })])
    const unsafeRequest = request as (options: { path: string; parse: (value: unknown) => unknown }) => Promise<unknown>

    await expect(unsafeRequest({ path: 'https://evil.example/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
      kind: 'protocol',
      code: 'invalid_path',
    })
    await expect(unsafeRequest({ path: '/api/mini/v1/../admin', parse: parseUnknown })).rejects.toBeInstanceOf(MiniApiError)
    await expect(unsafeRequest({ path: '/api/mini/v1/%2e%2e%2fadmin', parse: parseUnknown })).rejects.toBeInstanceOf(MiniApiError)
    await expect(unsafeRequest({ path: '/api/mini/v1/listings%2f..%2fadmin', parse: parseUnknown })).rejects.toBeInstanceOf(MiniApiError)
    await expect(unsafeRequest({ path: '/api/mini/v1/%252e%252e%252fadmin', parse: parseUnknown })).rejects.toBeInstanceOf(MiniApiError)
    await expect(unsafeRequest({ path: '/api/mini/v1/home#fragment', parse: parseUnknown })).rejects.toMatchObject({
      kind: 'protocol',
      code: 'invalid_path',
    })
    expect(environmentProvider).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('对 success.data 调用端点 parser，并将 parser 异常收口为不可重试的协议错误', async () => {
    const parsedClient = createClient([success({ listingIds: ['listing-1'] })])
    const parseListingIds = vi.fn((value: unknown): readonly string[] => {
      if (typeof value !== 'object' || value === null || !('listingIds' in value)) {
        throw new Error('invalid fixture')
      }
      const { listingIds } = value
      if (!Array.isArray(listingIds) || !listingIds.every((item) => typeof item === 'string')) {
        throw new Error('invalid fixture')
      }
      return listingIds
    })

    await expect(parsedClient.request({
      path: '/api/mini/v1/listings',
      parse: parseListingIds,
    })).resolves.toEqual(['listing-1'])
    expect(parseListingIds).toHaveBeenCalledWith({ listingIds: ['listing-1'] })

    const rejectedClient = createClient([success({ privateServerValue: 'do-not-leak' })])
    const rejectingParser = (): never => {
      throw new Error('parser leaked privateServerValue')
    }

    const rejection = rejectedClient.request({ path: '/api/mini/v1/home', parse: rejectingParser })
    await expect(rejection).rejects.toMatchObject({
      kind: 'protocol',
      code: 'invalid_response',
      requestId: 'body-request-id',
      retryable: false,
      message: '服务响应异常，请稍后重试',
    })
    await expect(rejection).rejects.not.toThrow(/parser|privateServerValue/)
  })

  it('将异步 parser reject 收口为不可重试的协议错误且不泄漏私密信息', async () => {
    const { request, transport } = createClient([success({ privateField: 'do-not-leak' })])
    const rejectingParser = async (): Promise<never> => {
      await Promise.resolve()
      throw new Error('async parser leaked privateField')
    }

    const rejection = request({ path: '/api/mini/v1/home', parse: rejectingParser })
    await expect(rejection).rejects.toMatchObject({
      name: 'MiniApiError',
      kind: 'protocol',
      code: 'invalid_response',
      requestId: 'body-request-id',
      retryable: false,
      message: '服务响应异常，请稍后重试',
    })
    await expect(rejection).rejects.not.toThrow(/async parser|privateField/)
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it('拒绝 meta 不符合 requestId、UTC ISO 时间或精确 TTL 合同的 success envelope', async () => {
    const malformedMeta = [
      { requestId: '', asOf: '2026-08-26T08:00:00.000Z', maxAgeSeconds: 300 },
      { requestId: 'x'.repeat(101), asOf: '2026-08-26T08:00:00.000Z', maxAgeSeconds: 300 },
      { requestId: 'unsafe id', asOf: '2026-08-26T08:00:00.000Z', maxAgeSeconds: 300 },
      { requestId: 'safe-id', asOf: 'x', maxAgeSeconds: 300 },
      { requestId: 'safe-id', asOf: '2026-08-26T08:00:00Z', maxAgeSeconds: 300 },
      { requestId: 'safe-id', asOf: '2026-08-26T08:00:00.000Z', maxAgeSeconds: -1 },
      { requestId: 'safe-id', asOf: '2026-08-26T08:00:00.000Z', maxAgeSeconds: 301 },
    ] as const

    for (const meta of malformedMeta) {
      const { request } = createClient([{
        statusCode: 200,
        data: { ok: true, data: {}, meta },
      }])
      await expect(request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
        kind: 'protocol',
        code: 'invalid_response',
      })
    }
  })

  it('拒绝空白或非 snake_case code、空 message 与非法 requestId 的 failure envelope', async () => {
    const malformedFailures = [
      { code: '', message: '失败', requestId: 'safe-id' },
      { code: 'Bad-Code', message: '失败', requestId: 'safe-id' },
      { code: 'safe_code', message: '', requestId: 'safe-id' },
      { code: 'safe_code', message: '失败', requestId: '' },
    ] as const

    for (const item of malformedFailures) {
      const { request } = createClient([{
        statusCode: 400,
        data: {
          ok: false,
          error: { code: item.code, message: item.message },
          meta: { requestId: item.requestId },
        },
      }])
      await expect(request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
        kind: 'http',
        code: 'http_error',
      })
    }
  })

  it('连续两次 503 failure envelope 保持 http 语义、service code 和 body requestId', async () => {
    const { request, transport } = createClient([
      failure(503, 'service_unavailable', 'service-down-id'),
      failure(503, 'service_unavailable', 'service-down-id'),
    ])

    await expect(request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
      kind: 'http',
      statusCode: 503,
      code: 'service_unavailable',
      requestId: 'service-down-id',
      retryable: true,
      message: '服务暂不可用，请稍后重试',
    })
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    '在读取环境或调用 transport 前拒绝非法 timeoutMs=%s',
    async (timeoutMs) => {
      const { request, transport, environmentProvider } = createClient([success({ unreachable: true })])

      await expect(request({
        path: '/api/mini/v1/home',
        timeoutMs,
        parse: parseUnknown,
      })).rejects.toMatchObject({
        kind: 'protocol',
        code: 'invalid_timeout',
        retryable: false,
        statusCode: null,
        requestId: null,
      })
      expect(environmentProvider).not.toHaveBeenCalled()
      expect(transport).not.toHaveBeenCalled()
    },
  )

  it.each(['PATCH', 'get', 123, null])(
    '在读取环境或调用 transport 前拒绝非法 method=%s',
    async (method) => {
      const { request, transport, environmentProvider } = createClient([success({ unreachable: true })])
      const unsafeRequest = request as (options: {
        path: '/api/mini/v1/home'
        method: unknown
        parse: (value: unknown) => unknown
      }) => Promise<unknown>

      await expect(unsafeRequest({
        path: '/api/mini/v1/home',
        method,
        parse: parseUnknown,
      })).rejects.toMatchObject({
        kind: 'protocol',
        code: 'invalid_method',
        retryable: false,
        statusCode: null,
        requestId: null,
      })
      expect(environmentProvider).not.toHaveBeenCalled()
      expect(transport).not.toHaveBeenCalled()
    },
  )

  it('在读取环境或调用 transport 前将 timeoutMs=null 拒绝为 invalid_timeout', async () => {
    const { request, transport, environmentProvider } = createClient([success({ unreachable: true })])
    const unsafeRequest = request as (options: {
      path: '/api/mini/v1/home'
      timeoutMs: unknown
      parse: (value: unknown) => unknown
    }) => Promise<unknown>

    await expect(unsafeRequest({
      path: '/api/mini/v1/home',
      timeoutMs: null,
      parse: parseUnknown,
    })).rejects.toMatchObject({
      kind: 'protocol',
      code: 'invalid_timeout',
      retryable: false,
      statusCode: null,
      requestId: null,
    })
    expect(environmentProvider).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('原样传递合法的 JSON 对象、字符串与 ArrayBuffer', async () => {
    const buffer = new ArrayBuffer(4)
    const validData = [
      { filters: { city: 'shanghai', active: true }, ids: ['1', '2'], count: 2, empty: null },
      'raw-body',
      buffer,
    ] as const

    for (const data of validData) {
      const { request, transport } = createClient([success({ accepted: true })])
      await expect(request({
        path: '/api/mini/v1/inquiries',
        method: 'POST',
        data,
        parse: parseUnknown,
      })).resolves.toEqual({ accepted: true })
      expect(transport).toHaveBeenCalledWith(expect.objectContaining({ data }))
    }
  })

  it('在读取环境或调用 transport 前递归拒绝非 JSON data 及顶层数组', async () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const invalidData: readonly unknown[] = [
      [{ id: 'top-level-array' }],
      { value: undefined },
      { value: () => 'function' },
      { value: Symbol('symbol') },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: new Date('2026-08-26T00:00:00.000Z') },
      cyclic,
    ]

    for (const data of invalidData) {
      const { request, transport, environmentProvider } = createClient([success({ unreachable: true })])
      const unsafeRequest = request as (options: {
        path: '/api/mini/v1/inquiries'
        method: 'POST'
        data: unknown
        parse: (value: unknown) => unknown
      }) => Promise<unknown>

      await expect(unsafeRequest({
        path: '/api/mini/v1/inquiries',
        method: 'POST',
        data,
        parse: parseUnknown,
      })).rejects.toMatchObject({
        kind: 'protocol',
        code: 'invalid_data',
        retryable: false,
      })
      expect(environmentProvider).not.toHaveBeenCalled()
      expect(transport).not.toHaveBeenCalled()
    }
  })

  it('校验嵌套数组时不读取索引 getter，并在环境与 transport 前拒绝', async () => {
    let getterCalls = 0
    const nested: unknown[] = []
    Object.defineProperty(nested, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1
        return 'private getter value'
      },
    })
    nested.length = 1

    const { request, transport, environmentProvider } = createClient([success({ unreachable: true })])
    const unsafeRequest = request as (options: {
      path: '/api/mini/v1/inquiries'
      method: 'POST'
      data: unknown
      parse: (value: unknown) => unknown
    }) => Promise<unknown>

    await expect(unsafeRequest({
      path: '/api/mini/v1/inquiries',
      method: 'POST',
      data: { nested },
      parse: parseUnknown,
    })).rejects.toMatchObject({
      kind: 'protocol',
      code: 'invalid_data',
      retryable: false,
    })
    expect(getterCalls).toBe(0)
    expect(environmentProvider).not.toHaveBeenCalled()
    expect(transport).not.toHaveBeenCalled()
  })

  it('GET 将正常 3xx 分类为不可重试的 HTTP 错误', async () => {
    const { request, transport } = createClient([
      { statusCode: 302, data: null, headers: { 'X-Request-Id': 'redirect-id' } },
      success({ shouldNotReach: true }),
    ])

    await expect(request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
      kind: 'http',
      code: 'http_error',
      statusCode: 302,
      requestId: 'redirect-id',
      retryable: false,
    })
    expect(transport).toHaveBeenCalledTimes(1)
  })

  it.each([0, 99, 600])('将越出 100..599 的 statusCode=%s 分类为不可重试的协议错误', async (statusCode) => {
    const invalidResponse: RequestTransportResponse = { statusCode, data: null }
    const { request, transport } = createClient([invalidResponse, invalidResponse])

    await expect(request({ path: '/api/mini/v1/home', parse: parseUnknown })).rejects.toMatchObject({
      kind: 'protocol',
      code: 'invalid_response',
      statusCode: null,
      retryable: false,
    })
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
