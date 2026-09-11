import { describe, expect, it } from 'vitest'
import { MEMBER_ERROR_STATUS, fail, ok, readJsonBody } from '@/domain/member/http'

describe('member http helpers', () => {
  it('fail 映射状态码与文案，429 带 Retry-After', async () => {
    const r = fail('RATE_LIMITED', 42)
    expect(r.status).toBe(429)
    expect(r.headers.get('Retry-After')).toBe('42')
    expect(await r.json()).toMatchObject({ ok: false, code: 'RATE_LIMITED' })
    expect(MEMBER_ERROR_STATUS.UNAUTHENTICATED).toBe(401)
    expect(MEMBER_ERROR_STATUS.SMS_UNAVAILABLE).toBe(503)
  })
  it('ok 可带 Set-Cookie', async () => {
    const r = ok({ member: null }, { cookie: 'sbh-member-token=x; Path=/' })
    expect(r.headers.get('set-cookie')).toContain('sbh-member-token=x')
    expect(await r.json()).toEqual({ ok: true, member: null })
  })
  it('readJsonBody：跨站 403、非 JSON 400、非对象 400', async () => {
    const origin = 'http://localhost:3717'
    const mk = (headers: Record<string, string>, body: string) =>
      new Request(`${origin}/api/member/x`, { method: 'POST', headers, body })
    await expect(
      readJsonBody(
        mk(
          {
            host: 'localhost:3717',
            origin: 'https://evil.example',
            'content-type': 'application/json',
          },
          '{}',
        ),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ORIGIN' })
    await expect(
      readJsonBody(
        mk({ host: 'localhost:3717', origin, 'content-type': 'text/plain' }, '{}'),
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      readJsonBody(
        mk({ host: 'localhost:3717', origin, 'content-type': 'application/json' }, '[1]'),
      ),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      readJsonBody(
        mk(
          { host: 'localhost:3717', origin, 'content-type': 'application/json' },
          '{"a":1}',
        ),
      ),
    ).resolves.toEqual({ a: 1 })
  })
})
