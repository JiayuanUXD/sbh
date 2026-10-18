import { describe, expect, it } from 'vitest'

import type { RuntimeEnvironment } from '../miniprogram/config/environment.js'
import { createRequestClient } from '../miniprogram/services/request.js'
import { createWxTransport, type WxTransportApi } from '../miniprogram/services/wx-transport.js'

function client(transport: 'http' | 'cloud-container') {
  const outgoing: string[] = []
  const response = {
    statusCode: 200,
    data: {
      ok: true, data: {},
      meta: { requestId: 'grade-schema-test', asOf: '2026-10-18T00:00:00.000Z', maxAgeSeconds: 300 },
    },
    header: {},
  }
  const api: WxTransportApi = {
    request(input) { outgoing.push(input.url); input.success(response) },
    cloud: {
      init() {},
      callContainer(input) { outgoing.push(input.path); input.success(response) },
    },
  }
  const environment: RuntimeEnvironment = transport === 'http'
    ? { stage: 'development', transport, apiBaseUrl: 'http://127.0.0.1:3717' }
    : { stage: 'staging', transport, cloudEnvId: 'test-env', cloudServiceName: 'test-service' }
  return {
    outgoing,
    request: createRequestClient({ environment: () => environment, transport: createWxTransport(api) }),
  }
}

describe.each(['http', 'cloud-container'] as const)('%s 等级能力协商', (transport) => {
  const base = transport === 'http' ? 'http://127.0.0.1:3717' : ''

  it.each([
    '/api/mini/v1/home?city=shanghai',
    '/api/mini/v1/listings?city=shanghai&page=2',
    '/api/mini/v1/listings/test-listing?city=shanghai',
    '/api/mini/v1/buildings?city=shanghai&grade=grade-b',
    '/api/mini/v1/buildings/test-building?city=shanghai',
  ] as const)('%s 的实际传输 URL 携带固定 schema', async (path) => {
    const { request, outgoing } = client(transport)
    await request({ path, parse: (value) => value })
    expect(outgoing).toEqual([`${base}${path}&gradeSchema=quality-v1`])
  })

  it.each([
    ['GET', '/api/mini/v1/me'],
    ['PUT', '/api/mini/v1/favorites'],
    ['DELETE', '/api/mini/v1/favorites'],
    ['POST', '/api/mini/v1/session'],
  ] as const)('%s %s 与目录请求共享能力协商', async (method, path) => {
    const { request, outgoing } = client(transport)
    await request({
      path, method, parse: (value) => value,
      ...(path === '/api/mini/v1/session' ? {} : { anonymousContextToken: 'safe-token' }),
    })
    expect(outgoing).toEqual([`${base}${path}?gradeSchema=quality-v1`])
  })

  it.each([
    '/api/mini/v1/home?gradeSchema=legacy&city=shanghai&gradeSchema=quality-v1',
    '/api/mini/v1/home?%67radeSchema=legacy&city=shanghai&gradeSchema=attacker',
    '/api/mini/v1/home?city=shanghai&gradeSchema',
  ] as const)('移除调用端 %s 中的同名参数且仅追加一次固定 schema', async (path) => {
    const { request, outgoing } = client(transport)
    await request({ path, parse: (value) => value })
    expect(outgoing).toEqual([`${base}/api/mini/v1/home?city=shanghai&gradeSchema=quality-v1`])
  })

  it('保留已有查询字节，避免破坏编码和多值筛选', async () => {
    const { request, outgoing } = client(transport)
    await request({
      path: '/api/mini/v1/buildings?district=%E9%9D%99%E5%AE%89&tag=a%20b&tag=c+d',
      parse: (value) => value,
    })
    expect(outgoing).toEqual([
      `${base}/api/mini/v1/buildings?district=%E9%9D%99%E5%AE%89&tag=a%20b&tag=c+d&gradeSchema=quality-v1`,
    ])
  })

  it('外部 URL 与非 Mini 路径继续在发出请求前拒绝', async () => {
    const { request, outgoing } = client(transport)
    const unsafeRequest = request as (options: { path: string; parse(value: unknown): unknown }) => Promise<unknown>
    for (const path of ['https://external.example/api/mini/v1/home', '/api/other', '/api/mini/v10/home']) {
      await expect(unsafeRequest({ path, parse: (value) => value }))
        .rejects.toMatchObject({ code: 'invalid_path' })
    }
    expect(outgoing).toEqual([])
  })
})
