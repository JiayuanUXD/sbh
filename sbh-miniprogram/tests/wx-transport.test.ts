import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { RuntimeEnvironment } from '../miniprogram/config/environment.js'
import type { RequestTransportInput } from '../miniprogram/services/request.js'
import {
  createWxTransport,
  type WxTransportApi,
} from '../miniprogram/services/wx-transport.js'

type CloudRuntimeEnvironment = Extract<RuntimeEnvironment, { transport: 'cloud-container' }>
type HttpRuntimeEnvironment = Extract<RuntimeEnvironment, { transport: 'http' }>

const httpEnvironment: HttpRuntimeEnvironment = {
  stage: 'development',
  transport: 'http',
  apiBaseUrl: 'http://127.0.0.1:3717',
}

const stagingEnvironment: CloudRuntimeEnvironment = {
  stage: 'staging',
  transport: 'cloud-container',
  cloudEnvId: 'sbhmini-gateway-d3fbrmn8097478b8',
  cloudServiceName: 'sbhmini',
}

const productionEnvironment: CloudRuntimeEnvironment = {
  stage: 'production',
  transport: 'cloud-container',
  cloudEnvId: 'sbh-d9gnr8h5ef7e22e30',
  cloudServiceName: 'sbh',
}

function createFakeWx(options: Readonly<{
  httpResponse?: Readonly<{ statusCode: number; data: unknown; header: Readonly<Record<string, unknown>> }>
  cloudResponse?: Readonly<{ statusCode: number; data: unknown; header: Readonly<Record<string, unknown>> }>
  httpFailure?: unknown
  cloudFailure?: unknown
}> = {}) {
  const request = vi.fn((input: Parameters<WxTransportApi['request']>[0]) => {
    if (options.httpFailure !== undefined) {
      input.fail(options.httpFailure)
      return
    }

    input.success(options.httpResponse ?? {
      statusCode: 200,
      data: { ok: true },
      header: { 'x-request-id': 'http-id' },
    })
  })
  const init = vi.fn((_input: Parameters<WxTransportApi['cloud']['init']>[0]) => undefined)
  const callContainer = vi.fn((input: Parameters<WxTransportApi['cloud']['callContainer']>[0]) => {
    if (options.cloudFailure !== undefined) {
      input.fail(options.cloudFailure)
      return
    }

    input.success(options.cloudResponse ?? {
      statusCode: 200,
      data: { ok: true },
      header: { 'x-request-id': 'cloud-id' },
    })
  })
  const api: WxTransportApi = {
    request,
    cloud: { init, callContainer },
  }

  return { api, request, init, callContainer }
}

function createInput(
  environment: RuntimeEnvironment,
  overrides: Partial<Omit<RequestTransportInput, 'environment'>> = {},
): RequestTransportInput {
  return {
    environment,
    path: '/api/mini/v1/home?city=shanghai',
    method: 'GET',
    data: undefined,
    timeoutMs: 10_000,
    headers: { Accept: 'application/json' },
    ...overrides,
  }
}

describe('微信请求传输适配器', () => {
  it('保持严格环境判别联合，cloud 分支不暴露 apiBaseUrl', () => {
    expectTypeOf<HttpRuntimeEnvironment['transport']>().toEqualTypeOf<'http'>()
    expectTypeOf<HttpRuntimeEnvironment['apiBaseUrl']>().toEqualTypeOf<string>()
    expectTypeOf<CloudRuntimeEnvironment['transport']>().toEqualTypeOf<'cloud-container'>()
    expectTypeOf<CloudRuntimeEnvironment>().not.toHaveProperty('apiBaseUrl')
  })

  it('development 拼接受控 API 基址并只调用 wx.request', async () => {
    const fakeWx = createFakeWx()
    const transport = createWxTransport(fakeWx.api)

    await expect(transport(createInput(httpEnvironment))).resolves.toEqual({
      statusCode: 200,
      data: { ok: true },
      headers: { 'x-request-id': 'http-id' },
    })
    expect(fakeWx.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://127.0.0.1:3717/api/mini/v1/home?city=shanghai',
      method: 'GET',
      timeout: 10_000,
      redirect: 'manual',
      header: { Accept: 'application/json' },
    }))
    expect(fakeWx.init).not.toHaveBeenCalled()
    expect(fakeWx.callContainer).not.toHaveBeenCalled()
  })

  it('cloud-container 初始化指定 env，并以平台 service header 调用 callContainer', async () => {
    const fakeWx = createFakeWx({
      cloudResponse: {
        statusCode: 201,
        data: { accepted: true },
        header: { 'X-Request-Id': 'container-id' },
      },
    })
    const transport = createWxTransport(fakeWx.api)
    const input = createInput(stagingEnvironment, {
      path: '/api/mini/v1/inquiries',
      method: 'POST',
      data: { submissionRequestId: 'submission-1' },
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer safe-token',
        'X-WX-SERVICE': 'attacker-service',
      },
    })

    await expect(transport(input)).resolves.toEqual({
      statusCode: 201,
      data: { accepted: true },
      headers: { 'X-Request-Id': 'container-id' },
    })
    expect(fakeWx.init).toHaveBeenCalledTimes(1)
    expect(fakeWx.init).toHaveBeenCalledWith({ env: stagingEnvironment.cloudEnvId })
    expect(fakeWx.callContainer).toHaveBeenCalledWith(expect.objectContaining({
      path: input.path,
      method: input.method,
      data: input.data,
      timeout: input.timeoutMs,
      followRedirect: false,
      header: {
        Accept: 'application/json',
        Authorization: 'Bearer safe-token',
        'X-WX-SERVICE': 'sbhmini',
      },
    }))
    expect(fakeWx.request).not.toHaveBeenCalled()
  })

  it('同一 cloud env 多次请求只 init 一次', async () => {
    const fakeWx = createFakeWx()
    const transport = createWxTransport(fakeWx.api)

    await transport(createInput(stagingEnvironment))
    await transport(createInput(stagingEnvironment, { path: '/api/mini/v1/listings' }))

    expect(fakeWx.init).toHaveBeenCalledTimes(1)
    expect(fakeWx.callContainer).toHaveBeenCalledTimes(2)
  })

  it('初始化后切换 cloud env fail-closed，不二次 init 或发请求', async () => {
    const fakeWx = createFakeWx()
    const transport = createWxTransport(fakeWx.api)

    await transport(createInput(stagingEnvironment))
    await expect(transport(createInput(productionEnvironment))).rejects.toThrow('cloud runtime environment changed')

    expect(fakeWx.init).toHaveBeenCalledTimes(1)
    expect(fakeWx.callContainer).toHaveBeenCalledTimes(1)
  })

  it('callContainer 固定不跟随 3xx，并原样映射响应', async () => {
    const fakeWx = createFakeWx({
      cloudResponse: {
        statusCode: 302,
        data: 'redirect body',
        header: { Location: 'https://evil.example' },
      },
    })
    const transport = createWxTransport(fakeWx.api)

    await expect(transport(createInput(stagingEnvironment))).resolves.toEqual({
      statusCode: 302,
      data: 'redirect body',
      headers: { Location: 'https://evil.example' },
    })
    expect(fakeWx.callContainer).toHaveBeenCalledWith(expect.objectContaining({ followRedirect: false }))
  })

  it.each(['http', 'cloud'] as const)('%s fail 原样 reject，交给上层分类', async (branch) => {
    const failure = { errMsg: `${branch}:fail timeout`, privateValue: 'do-not-log' }
    const fakeWx = createFakeWx(branch === 'http'
      ? { httpFailure: failure }
      : { cloudFailure: failure })
    const transport = createWxTransport(fakeWx.api)

    await expect(transport(createInput(branch === 'http' ? httpEnvironment : stagingEnvironment))).rejects.toBe(failure)
  })
})
