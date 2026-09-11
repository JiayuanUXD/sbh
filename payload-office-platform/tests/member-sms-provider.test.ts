import { describe, expect, it } from 'vitest'
import {
  collectSmsProductionViolations,
  expandTemplateParams,
  resolveSmsProvider,
} from '@/domain/member/sms-provider'

describe('sms-provider', () => {
  it('模板占位展开', () => {
    expect(expandTemplateParams(undefined, '123456', 5)).toEqual(['123456', '5'])
    expect(expandTemplateParams('{code}', '123456', 5)).toEqual(['123456'])
    expect(expandTemplateParams('{minutes},{code}', '1', 5)).toEqual(['5', '1'])
  })
  it('非生产缺省 console；fixture 可选；生产未配返回 null', () => {
    expect(resolveSmsProvider({ NODE_ENV: 'development' }, () => {})?.name).toBe('console')
    expect(
      resolveSmsProvider({ NODE_ENV: 'test', SMS_PROVIDER: 'fixture' }, () => {})?.name,
    ).toBe('fixture')
    expect(resolveSmsProvider({ NODE_ENV: 'production' }, () => {})).toBeNull()
  })
  it('tencent 缺凭据抛错，凭据齐全返回 tencent', () => {
    expect(() =>
      resolveSmsProvider({ NODE_ENV: 'development', SMS_PROVIDER: 'tencent' }, () => {}),
    ).toThrow(/TENCENT_SMS/)
    const full = {
      NODE_ENV: 'development',
      SMS_PROVIDER: 'tencent',
      TENCENT_SMS_SECRET_ID: 'a',
      TENCENT_SMS_SECRET_KEY: 'b',
      TENCENT_SMS_SDK_APP_ID: '1400',
      TENCENT_SMS_SIGN_NAME: '签名',
      TENCENT_SMS_TEMPLATE_ID: '1',
    }
    expect(resolveSmsProvider(full, () => {})?.name).toBe('tencent')
  })
  it('生产拒绝 console / fixture，允许 tencent；CI 环境仅在显式 MEMBER_SMS_FIXTURE 且非生产域名时允许 fixture', () => {
    expect(
      collectSmsProductionViolations({ NODE_ENV: 'production', SMS_PROVIDER: 'console' }),
    ).toHaveLength(1)
    expect(
      collectSmsProductionViolations({ NODE_ENV: 'production', SMS_PROVIDER: 'fixture' }),
    ).toHaveLength(1)
    // 仅有 CI 未设 MEMBER_SMS_FIXTURE=1 仍应拒绝
    expect(
      collectSmsProductionViolations({ NODE_ENV: 'production', SMS_PROVIDER: 'fixture', CI: '1' }),
    ).toHaveLength(1)
    // CI + MEMBER_SMS_FIXTURE=1 + 测试域名 允许通过
    expect(
      collectSmsProductionViolations({
        NODE_ENV: 'production',
        SMS_PROVIDER: 'fixture',
        CI: '1',
        MEMBER_SMS_FIXTURE: '1',
        NEXT_PUBLIC_SITE_URL: 'https://sbh-e2e.example.com',
      }),
    ).toEqual([])
    // 生产真实域名下即便带 CI 仍严格拒绝
    expect(
      collectSmsProductionViolations({
        NODE_ENV: 'production',
        SMS_PROVIDER: 'fixture',
        CI: '1',
        MEMBER_SMS_FIXTURE: '1',
        NEXT_PUBLIC_SITE_URL: 'https://www.shanghai-office.cn',
      }),
    ).toHaveLength(1)
    expect(
      resolveSmsProvider(
        {
          NODE_ENV: 'production',
          SMS_PROVIDER: 'fixture',
          CI: '1',
          MEMBER_SMS_FIXTURE: '1',
          NEXT_PUBLIC_SITE_URL: 'https://sbh-e2e.example.com',
        },
        () => {},
      )?.name,
    ).toBe('fixture')
    expect(
      resolveSmsProvider({ NODE_ENV: 'production', SMS_PROVIDER: 'fixture' }, () => {}),
    ).toBeNull()
    expect(
      collectSmsProductionViolations({
        NODE_ENV: 'production',
        SMS_PROVIDER: 'tencent',
        TENCENT_SMS_SECRET_ID: 'a',
        TENCENT_SMS_SECRET_KEY: 'b',
        TENCENT_SMS_SDK_APP_ID: '1',
        TENCENT_SMS_SIGN_NAME: 's',
        TENCENT_SMS_TEMPLATE_ID: 't',
      }),
    ).toEqual([])
    expect(collectSmsProductionViolations({ NODE_ENV: 'production' })).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────
// cloudmarket：腾讯云云市场 API 网关（杭州华际云数「短信验证码」，产品 32818）
// ────────────────────────────────────────────────────────────
import { createHmac } from 'node:crypto'
import {
  CLOUDMARKET_SMS_DEFAULT_ENDPOINT,
  buildCloudMarketAuthorization,
  cloudMarketSignature,
  type CloudMarketSmsDeps,
} from '@/domain/member/sms-provider'

const CM_ENV = {
  NODE_ENV: 'production',
  SMS_PROVIDER: 'cloudmarket',
  CLOUDMARKET_SMS_SECRET_ID: 'AKIDtest',
  CLOUDMARKET_SMS_SECRET_KEY: 'sk-test-key',
  CLOUDMARKET_SMS_TEMPLATE_ID: 'tpl-001',
}

function fakeDeps(reply: { status: number; body: unknown }): CloudMarketSmsDeps & { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  return {
    calls,
    now: () => new Date('2026-09-11T08:00:00Z'),
    requestId: () => 'req-uuid-1',
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch,
  }
}

describe('sms-provider cloudmarket', () => {
  it('签名 = Base64(HMAC-SHA1(secretKey, "x-date: <GMT>"))，Authorization 是含 id / x-date / signature 的 JSON', () => {
    const xDate = 'Fri, 11 Sep 2026 08:00:00 GMT'
    const expected = createHmac('sha1', 'sk-test-key').update(`x-date: ${xDate}`, 'utf8').digest('base64')
    expect(cloudMarketSignature('sk-test-key', xDate)).toBe(expected)
    const auth = buildCloudMarketAuthorization('AKIDtest', 'sk-test-key', new Date('2026-09-11T08:00:00Z'))
    expect(auth.xDate).toBe(xDate)
    expect(JSON.parse(auth.authorization)).toEqual({ id: 'AKIDtest', 'x-date': xDate, signature: expected })
  })

  it('发送：POST 表单 mobile / templateId / tag，带 Authorization 与 request-id；code=200 视为成功', async () => {
    const deps = fakeDeps({ status: 200, body: { code: 200, msg: '', requestid: 'r', data: { taskId: 't' } } })
    const provider = resolveSmsProvider(CM_ENV, () => {}, deps)
    expect(provider?.name).toBe('cloudmarket')
    await provider!.send({ phone: '13800001234', code: '654321', minutes: 5 })
    expect(deps.calls).toHaveLength(1)
    const { url, init } = deps.calls[0]
    expect(url).toBe(CLOUDMARKET_SMS_DEFAULT_ENDPOINT)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(headers['request-id']).toBe('req-uuid-1')
    expect(JSON.parse(headers.Authorization).id).toBe('AKIDtest')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('mobile')).toBe('13800001234')
    expect(body.get('templateId')).toBe('tpl-001')
    expect(body.get('tag')).toBe('654321')
  })

  it('CLOUDMARKET_SMS_TAG_PARAMS 控制 tag 的变量顺序，多个用竖线拼接；CLOUDMARKET_SMS_ENDPOINT 可覆盖地址', async () => {
    const deps = fakeDeps({ status: 200, body: { code: 200 } })
    const provider = resolveSmsProvider(
      { ...CM_ENV, CLOUDMARKET_SMS_TAG_PARAMS: '{code},{minutes}', CLOUDMARKET_SMS_ENDPOINT: 'https://example.invalid/send' },
      () => {},
      deps,
    )
    await provider!.send({ phone: '13800001234', code: '111222', minutes: 5 })
    expect(deps.calls[0].url).toBe('https://example.invalid/send')
    expect(new URLSearchParams(String(deps.calls[0].init.body)).get('tag')).toBe('111222|5')
  })

  it('HTTP >= 300 或 code != 200 都抛错，错误信息不含验证码', async () => {
    const http = resolveSmsProvider(CM_ENV, () => {}, fakeDeps({ status: 403, body: { message: 'forbidden' } }))
    await expect(http!.send({ phone: '13800001234', code: '999999', minutes: 5 })).rejects.toThrow(/403/)
    const biz = resolveSmsProvider(CM_ENV, () => {}, fakeDeps({ status: 200, body: { code: 400, msg: '参数[mobile]输入有误' } }))
    await expect(biz!.send({ phone: '13800001234', code: '999999', minutes: 5 })).rejects.toThrow(/参数\[mobile\]/)
    await expect(biz!.send({ phone: '13800001234', code: '999999', minutes: 5 })).rejects.not.toThrow(/999999/)
  })

  it('缺凭据：resolve 抛错；生产守卫列出缺失字段；凭据齐全无违例', () => {
    expect(() => resolveSmsProvider({ NODE_ENV: 'development', SMS_PROVIDER: 'cloudmarket' }, () => {})).toThrow(/CLOUDMARKET_SMS/)
    expect(collectSmsProductionViolations({ NODE_ENV: 'production', SMS_PROVIDER: 'cloudmarket' }).map((v) => v.field)).toEqual([
      'CLOUDMARKET_SMS_SECRET_ID',
      'CLOUDMARKET_SMS_SECRET_KEY',
      'CLOUDMARKET_SMS_TEMPLATE_ID',
    ])
    expect(collectSmsProductionViolations(CM_ENV)).toEqual([])
  })
})
