import { readFile } from 'node:fs/promises'

import { describe, expect, it, vi } from 'vitest'

import { createSessionService } from '../miniprogram/services/session.js'

const NOW = Date.parse('2026-08-27T12:00:00.000Z')
const VALID_EXPIRY = '2026-08-27T12:10:00.000Z'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('匿名 session 服务', () => {
  it('login 同步抛错后不会留下已完成 inflight，下一次 ensure 可重试', async () => {
    const login = vi.fn()
      .mockImplementationOnce(() => { throw new Error('同步失败') })
      .mockResolvedValueOnce({ code: 'retry-login-code' })
    const request = vi.fn(async () => ({
      anonymousContextToken: 'retry-token',
      expiresAt: VALID_EXPIRY,
    }))
    const service = createSessionService({ login, request, now: () => NOW })

    await expect(service.ensureAnonymousContext()).resolves.toBeNull()
    await expect(service.ensureAnonymousContext()).resolves.toBe('retry-token')
    expect(login).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('并发 ensure 只 login 和 POST 一次，并缓存 token', async () => {
    const login = vi.fn(async () => ({ code: 'login-code' }))
    const request = vi.fn(async () => ({
      anonymousContextToken: 'anonymous-token',
      expiresAt: VALID_EXPIRY,
    }))
    const service = createSessionService({ login, request, now: () => NOW })

    await expect(Promise.all([
      service.ensureAnonymousContext(),
      service.ensureAnonymousContext(),
    ])).resolves.toEqual(['anonymous-token', 'anonymous-token'])
    await expect(service.ensureAnonymousContext()).resolves.toBe('anonymous-token')
    expect(service.getToken()).toBe('anonymous-token')
    expect(login).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['', 'x'.repeat(129)])('login code 长度非法时不 POST：%s', async (code) => {
    const request = vi.fn()
    const service = createSessionService({
      login: vi.fn(async () => ({ code })),
      request,
      now: () => NOW,
    })

    await expect(service.ensureAnonymousContext()).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  it('接受恰好 128 字符的 login code', async () => {
    const request = vi.fn(async () => ({
      anonymousContextToken: 'anonymous-token',
      expiresAt: VALID_EXPIRY,
    }))
    const code = 'x'.repeat(128)
    const service = createSessionService({
      login: vi.fn(async () => ({ code })),
      request,
      now: () => NOW,
    })

    await expect(service.ensureAnonymousContext()).resolves.toBe('anonymous-token')
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ data: { loginCode: code } }))
  })

  it.each([
    ['expired', '2026-08-27T12:00:10.000Z'],
    ['invalid', 'not-a-date'],
  ] as const)('%s expiry 安全失效', async (_label, expiresAt) => {
    const service = createSessionService({
      login: vi.fn(async () => ({ code: 'login-code' })),
      request: vi.fn(async () => ({ anonymousContextToken: 'token', expiresAt })),
      now: () => NOW,
    })

    await expect(service.ensureAnonymousContext()).resolves.toBeNull()
    expect(service.getToken()).toBeNull()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    '时钟值 %s 非安全时间时 fail-closed',
    async (clock) => {
      const service = createSessionService({
        login: vi.fn(async () => ({ code: 'login-code' })),
        request: vi.fn(async () => ({
          anonymousContextToken: 'token',
          expiresAt: VALID_EXPIRY,
        })),
        now: () => clock,
      })

      await expect(service.ensureAnonymousContext()).resolves.toBeNull()
      expect(service.getToken()).toBeNull()
    },
  )

  it('每次有效性判断只读取 now 一次', async () => {
    const now = vi.fn()
      .mockReturnValueOnce(NOW)
      .mockReturnValueOnce(NOW)
    const service = createSessionService({
      login: vi.fn(async () => ({ code: 'login-code' })),
      request: vi.fn(async () => ({
        anonymousContextToken: 'token',
        expiresAt: VALID_EXPIRY,
      })),
      now,
    })

    await expect(service.ensureAnonymousContext()).resolves.toBe('token')
    expect(now).toHaveBeenCalledTimes(1)
    expect(service.getToken()).toBe('token')
    expect(now).toHaveBeenCalledTimes(2)
  })

  it('clear 压过等待 login 的旧 generation，旧 caller 返回 null 且不发送旧 POST', async () => {
    const oldLogin = deferred<Readonly<{ code: string }>>()
    const login = vi.fn()
      .mockImplementationOnce(async () => oldLogin.promise)
      .mockResolvedValueOnce({ code: 'new-login-code' })
    const request = vi.fn(async () => ({
      anonymousContextToken: 'new-token',
      expiresAt: VALID_EXPIRY,
    }))
    const service = createSessionService({ login, request, now: () => NOW })

    const oldCaller = service.ensureAnonymousContext()
    service.clear()
    const newCaller = service.ensureAnonymousContext()
    oldLogin.resolve({ code: 'old-login-code' })

    await expect(oldCaller).resolves.toBeNull()
    await expect(newCaller).resolves.toBe('new-token')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      data: { loginCode: 'new-login-code' },
    }))
  })

  it('clear 压过等待 POST 的旧 generation，旧 finally 不清除新的 inflight', async () => {
    const oldResponse = deferred<Readonly<{ anonymousContextToken: string; expiresAt: string }>>()
    const newResponse = deferred<Readonly<{ anonymousContextToken: string; expiresAt: string }>>()
    const request = vi.fn()
      .mockImplementationOnce(async () => oldResponse.promise)
      .mockImplementationOnce(async () => newResponse.promise)
    const login = vi.fn()
      .mockResolvedValueOnce({ code: 'old-login-code' })
      .mockResolvedValueOnce({ code: 'new-login-code' })
    const service = createSessionService({ login, request, now: () => NOW })

    const oldCaller = service.ensureAnonymousContext()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    service.clear()
    const newCaller = service.ensureAnonymousContext()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))

    oldResponse.resolve({ anonymousContextToken: 'old-token', expiresAt: VALID_EXPIRY })
    await expect(oldCaller).resolves.toBeNull()
    const joiningCaller = service.ensureAnonymousContext()
    expect(login).toHaveBeenCalledTimes(2)

    newResponse.resolve({ anonymousContextToken: 'new-token', expiresAt: VALID_EXPIRY })
    await expect(Promise.all([newCaller, joiningCaller])).resolves.toEqual(['new-token', 'new-token'])
    expect(service.getToken()).toBe('new-token')
    expect(login).toHaveBeenCalledTimes(2)
  })

  it('只接受精确 session data，不信任继承字段或额外字段', async () => {
    const invalidData = [
      { anonymousContextToken: 'token', expiresAt: VALID_EXPIRY, openid: 'private' },
      Object.assign(Object.create({ anonymousContextToken: 'token' }), { expiresAt: VALID_EXPIRY }),
    ]

    for (const value of invalidData) {
      const service = createSessionService({
        login: vi.fn(async () => ({ code: 'login-code' })),
        request: vi.fn(async () => value),
        now: () => NOW,
      })
      await expect(service.ensureAnonymousContext()).resolves.toBeNull()
    }
  })

  it('源码不使用任何 storage API，clear 后内存 token 立即失效', async () => {
    const service = createSessionService({
      login: vi.fn(async () => ({ code: 'login-code' })),
      request: vi.fn(async () => ({ anonymousContextToken: 'token', expiresAt: VALID_EXPIRY })),
      now: () => NOW,
    })
    await expect(service.ensureAnonymousContext()).resolves.toBe('token')
    service.clear()
    expect(service.getToken()).toBeNull()

    const source = await readFile(new URL('../miniprogram/services/session.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/(?:get|set|remove|clear)Storage/)
  })
})
