import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  issueAnonymousContextToken,
  verifyAnonymousContextToken,
  type MiniSessionCryptoDeps,
} from '@/domain/mini-program/session'
import {
  readMiniProgramRuntimeConfig,
  readMiniSessionSigningRuntimeConfig,
  readMiniTrustedProxyRuntimeConfig,
  readMiniWechatRuntimeConfig,
} from '@/lib/mini-program/runtime-config'

const NOW_MS = 1_800_000_000_000
const SIGNING_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const APP_ID = 'wx1234567890abcdef'
const APP_SECRET = '0123456789abcdef0123456789abcdef'

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function signToken(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`
  const signature = createHmac('sha256', SIGNING_SECRET).update(signingInput).digest('base64url')
  return `${signingInput}.${signature}`
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(NOW_MS / 1000)
  return {
    iss: 'sbh-platform',
    aud: 'sbh-wechat-mini-program',
    purpose: 'anonymous-context',
    version: 1,
    sub: 'subject',
    jti: 'jti',
    iat: now,
    exp: now + 900,
    ...overrides,
  }
}

function deps(overrides: Partial<MiniSessionCryptoDeps> = {}): MiniSessionCryptoDeps {
  return {
    signingSecret: SIGNING_SECRET,
    now: () => NOW_MS,
    randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index + 11),
    ...overrides,
  }
}

function validEnv(): Record<string, string | undefined> {
  return {
    WECHAT_MINIPROGRAM_APP_ID: APP_ID,
    WECHAT_MINIPROGRAM_APP_SECRET: APP_SECRET,
    MINI_SESSION_SIGNING_SECRET: Buffer.from(SIGNING_SECRET).toString('base64url'),
  }
}

describe('Mini 运行时配置', () => {
  it('受信代理 hop 只接受服务端 1..5 整数', () => {
    expect(readMiniTrustedProxyRuntimeConfig({ MINI_TRUSTED_PROXY_HOPS: '2' }))
      .toEqual({ ok: true, value: { trustedProxyHops: 2 } })
    for (const value of [undefined, '', '0', '6', '1.5', 'one', ' 1 ']) {
      expect(readMiniTrustedProxyRuntimeConfig({ MINI_TRUSTED_PROXY_HOPS: value }))
        .toEqual({ ok: false, errorCode: 'mini_program_config_unavailable' })
    }
  })

  it('手填路径可独立跳过微信配置，Bearer 与 phoneCode 各只读取所需能力', () => {
    expect(readMiniSessionSigningRuntimeConfig({
      MINI_SESSION_SIGNING_SECRET: validEnv().MINI_SESSION_SIGNING_SECRET,
    })).toEqual({
      ok: true,
      value: { sessionSigningSecret: SIGNING_SECRET },
    })
    expect(readMiniWechatRuntimeConfig({
      WECHAT_MINIPROGRAM_APP_ID: APP_ID,
      WECHAT_MINIPROGRAM_APP_SECRET: APP_SECRET,
    })).toEqual({
      ok: true,
      value: { appId: APP_ID, appSecret: APP_SECRET },
    })
  })

  it('只从三个服务端变量解析微信配置与已解码签名密钥', () => {
    const result = readMiniProgramRuntimeConfig(validEnv())

    expect(result).toEqual({
      ok: true,
      value: {
        appId: APP_ID,
        appSecret: APP_SECRET,
        sessionSigningSecret: SIGNING_SECRET,
      },
    })
  })

  it.each([
    'WECHAT_MINIPROGRAM_APP_ID',
    'WECHAT_MINIPROGRAM_APP_SECRET',
    'MINI_SESSION_SIGNING_SECRET',
  ] as const)('缺少 %s 时局部 fail-closed', (key) => {
    const env = validEnv()
    delete env[key]

    expect(readMiniProgramRuntimeConfig(env)).toEqual({
      ok: false,
      errorCode: 'mini_program_config_unavailable',
    })
  })

  it.each([
    { key: 'WECHAT_MINIPROGRAM_APP_ID', value: 'not-an-app-id' },
    { key: 'WECHAT_MINIPROGRAM_APP_SECRET', value: 'short-secret' },
    { key: 'MINI_SESSION_SIGNING_SECRET', value: 'not+base64url' },
    {
      key: 'MINI_SESSION_SIGNING_SECRET',
      value: Buffer.from(Uint8Array.from({ length: 31 }, (_, index) => index + 1)).toString('base64url'),
    },
    {
      key: 'MINI_SESSION_SIGNING_SECRET',
      value: Buffer.alloc(32, 7).toString('base64url'),
    },
    {
      key: 'MINI_SESSION_SIGNING_SECRET',
      value: Buffer.from('replace-with-a-random-secret-value!', 'utf8').toString('base64url'),
    },
  ])('拒绝格式错误或低熵配置：$key', ({ key, value }) => {
    expect(readMiniProgramRuntimeConfig({ ...validEnv(), [key]: value })).toEqual({
      ok: false,
      errorCode: 'mini_program_config_unavailable',
    })
  })

  it('NEXT_PUBLIC 同名变量不能替代服务端变量，模块也不在导入时读取配置', async () => {
    expect(readMiniProgramRuntimeConfig({
      NEXT_PUBLIC_WECHAT_MINIPROGRAM_APP_ID: APP_ID,
      NEXT_PUBLIC_WECHAT_MINIPROGRAM_APP_SECRET: APP_SECRET,
      NEXT_PUBLIC_MINI_SESSION_SIGNING_SECRET: Buffer.from(SIGNING_SECRET).toString('base64url'),
    })).toEqual({ ok: false, errorCode: 'mini_program_config_unavailable' })

    const source = await readFile(
      resolve(process.cwd(), 'src/lib/mini-program/runtime-config.ts'),
      'utf8',
    )
    expect(source).not.toContain('NEXT_PUBLIC_')
    expect(source).not.toMatch(/^const\s+\w+\s*=\s*readMiniProgramRuntimeConfig\(/m)
  })

  it('即使传入完整变量，浏览器环境也 fail-closed', () => {
    vi.stubGlobal('window', {})
    try {
      expect(readMiniProgramRuntimeConfig(validEnv())).toEqual({
        ok: false,
        errorCode: 'mini_program_config_unavailable',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Mini 匿名上下文 token', () => {
  it('签发固定 HS256/iss/aud/purpose/version 与 15 分钟声明，不包含微信敏感身份', () => {
    const openId = 'openid-sensitive-value'
    const sessionKey = 'session_key-sensitive-value'
    const issued = issueAnonymousContextToken(openId, deps())
    const [headerPart, payloadPart] = issued.token.split('.')
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'))
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'))

    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(payload).toMatchObject({
      iss: 'sbh-platform',
      aud: 'sbh-wechat-mini-program',
      purpose: 'anonymous-context',
      version: 1,
      iat: Math.floor(NOW_MS / 1000),
      exp: Math.floor(NOW_MS / 1000) + 15 * 60,
    })
    expect(payload.sub).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(payload.jti).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(JSON.stringify({ header, payload })).not.toContain(openId)
    expect(JSON.stringify({ header, payload })).not.toContain(sessionKey)
    expect(issued.expiresAt).toBe(new Date(NOW_MS + 15 * 60 * 1000).toISOString())
  })

  it('有效 token 可重复验证并返回相同匿名上下文', () => {
    const issued = issueAnonymousContextToken('openid-replay', deps())

    const first = verifyAnonymousContextToken(issued.token, deps())
    const second = verifyAnonymousContextToken(issued.token, deps())

    expect(first).toEqual(second)
    expect(first).toMatchObject({ ok: true, context: { purpose: 'anonymous-context' } })
  })

  it('每次签发使用随机 jti，但同 openid 的 HMAC 匿名主体稳定', () => {
    let seed = 1
    const cryptoDeps = deps({
      randomBytes: (size) => Uint8Array.from({ length: size }, () => seed++),
    })

    const first = issueAnonymousContextToken('openid-stable-sub', cryptoDeps)
    const second = issueAnonymousContextToken('openid-stable-sub', cryptoDeps)
    const firstPayload = JSON.parse(Buffer.from(first.token.split('.')[1], 'base64url').toString('utf8'))
    const secondPayload = JSON.parse(Buffer.from(second.token.split('.')[1], 'base64url').toString('utf8'))

    expect(firstPayload.sub).toBe(secondPayload.sub)
    expect(firstPayload.jti).not.toBe(secondPayload.jti)
    expect(first.token).not.toBe(second.token)
  })

  it.each([
    'missing-segments',
    'a.b.c.d',
    '***.e30.signature',
  ])('拒绝畸形/base64url 非法 token：%s', (token) => {
    expect(verifyAnonymousContextToken(token, deps())).toEqual({
      ok: false,
      errorCode: 'session_invalid',
    })
  })

  it('拒绝签名篡改', () => {
    const issued = issueAnonymousContextToken('openid-tampered', deps())
    const parts = issued.token.split('.')
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`

    expect(verifyAnonymousContextToken(parts.join('.'), deps())).toEqual({
      ok: false,
      errorCode: 'session_invalid',
    })
  })

  it('即使签名正确也拒绝算法混淆', () => {
    const token = signToken(validPayload(), { alg: 'HS512', typ: 'JWT' })

    expect(verifyAnonymousContextToken(token, deps())).toEqual({
      ok: false,
      errorCode: 'session_invalid',
    })
  })

  it('拒绝过期 token', () => {
    const issued = issueAnonymousContextToken('openid-expired', deps())

    expect(verifyAnonymousContextToken(issued.token, deps({ now: () => NOW_MS + 901_000 })))
      .toEqual({ ok: false, errorCode: 'session_expired' })
  })

  it('拒绝签名正确但有效跨度超过 15 分钟的 token', () => {
    const now = Math.floor(NOW_MS / 1000)
    const token = signToken(validPayload({ exp: now + 901 }))

    expect(verifyAnonymousContextToken(token, deps())).toEqual({
      ok: false,
      errorCode: 'session_invalid',
    })
  })

  it.each([
    {
      name: 'header 多余字段',
      token: signToken(validPayload(), { alg: 'HS256', typ: 'JWT', kid: 'unexpected' }),
    },
    {
      name: 'payload 多余字段',
      token: signToken(validPayload({ role: 'admin' })),
    },
  ])('拒绝签名正确但声明键不精确：$name', ({ token }) => {
    expect(verifyAnonymousContextToken(token, deps())).toEqual({
      ok: false,
      errorCode: 'session_invalid',
    })
  })

  it('header 固定字段必须是自身属性，不能从原型链继承', () => {
    Object.defineProperty(Object.prototype, 'alg', {
      configurable: true,
      value: 'HS256',
    })
    try {
      const token = signToken(validPayload(), { typ: 'JWT' })
      expect(verifyAnonymousContextToken(token, deps())).toEqual({
        ok: false,
        errorCode: 'session_invalid',
      })
    } finally {
      delete (Object.prototype as { alg?: unknown }).alg
    }
  })

  it('payload 固定字段必须是自身属性，不能从原型链继承', () => {
    Object.defineProperty(Object.prototype, 'iss', {
      configurable: true,
      value: 'sbh-platform',
    })
    try {
      const payload = validPayload()
      delete payload.iss
      const token = signToken(payload)
      expect(verifyAnonymousContextToken(token, deps())).toEqual({
        ok: false,
        errorCode: 'session_invalid',
      })
    } finally {
      delete (Object.prototype as { iss?: unknown }).iss
    }
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
  ])('签发遇到非法时钟 %s 时抛稳定错误', (now) => {
    expect(() => issueAnonymousContextToken('openid-clock-invalid', deps({ now: () => now })))
      .toThrowError('mini_session_clock_invalid')
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
  ])('验签遇到非法时钟 %s 时 fail-closed', (now) => {
    const issued = issueAnonymousContextToken('openid-clock-verification', deps())
    expect(verifyAnonymousContextToken(issued.token, deps({ now: () => now }))).toEqual({
      ok: false,
      errorCode: 'session_invalid',
    })
  })

  it('验签实现使用常量时间比较', async () => {
    const source = await readFile(
      resolve(process.cwd(), 'src/domain/mini-program/session.ts'),
      'utf8',
    )
    expect(source).toContain('timingSafeEqual')
  })
})
