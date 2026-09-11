import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import type { Member, MemberSmsCode } from '@/payload-types'
import { hashSmsCode } from '@/domain/member/sms-code'
import {
  consumeSmsCode,
  isValidPassword,
  loginWithPassword,
  loginWithSms,
  sendSmsCode,
  setPasswordWithSms,
  type MemberServiceDeps,
} from '@/domain/member/member-service'
import { MemberHttpError } from '@/domain/member/http'

const secret = 'service-test-secret-0123456789-0123456789'
const now = new Date('2026-09-11T00:00:00Z')
const phone = '13800001234'

type Store = { codes: MemberSmsCode[]; members: Member[] }

/** 极简内存版 payload：只实现服务用到的 find / create / update / findByID / login。 */
function fakePayload(store: Store) {
  let nextId = 100
  const payload = {
    secret,
    logger: { info: vi.fn(), warn: vi.fn() },
    db: {
      pool: {
        // 假 pool：把 member-service 用到的两条原子 SQL 映射到内存 store，其余当限流表
        query: vi.fn(async (args: { text: string; values?: unknown[] }) => {
          if (args.text.includes('SET attempts = attempts + 1')) {
            const row = store.codes.find((c) => c.id === args.values?.[0])
            if (!row) return { rows: [], rowCount: 0 }
            ;(row as unknown as { attempts: number }).attempts = (row.attempts ?? 0) + 1
            return { rows: [{ attempts: row.attempts }], rowCount: 1 }
          }
          if (args.text.includes('SET consumed_at = NOW()')) {
            const row = store.codes.find((c) => c.id === args.values?.[0])
            if (!row || row.consumedAt) return { rows: [], rowCount: 0 }
            ;(row as unknown as { consumedAt: string }).consumedAt = now.toISOString()
            return { rows: [{ id: row.id }], rowCount: 1 }
          }
          return { rows: [{ count: 1, window_start: args?.values?.[1] ?? 0 }], rowCount: 1 }
        }),
      },
    },
    find: vi.fn(
      async (args: { collection: string; where: Record<string, unknown>; sort?: string }) => {
        if (args.collection === 'member-sms-codes') {
          const w = args.where as {
            and: Array<Record<string, { equals?: unknown; exists?: boolean }>>
          }
          const docs = store.codes
            .filter((c) =>
              w.and.every((clause) => {
                const [k, cond] = Object.entries(clause)[0]
                if (cond.exists === false)
                  return (c as unknown as Record<string, unknown>)[k] == null
                return (c as unknown as Record<string, unknown>)[k] === cond.equals
              }),
            )
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          return { docs }
        }
        if (args.collection === 'members') {
          const eq = (args.where as { username: { equals: string } }).username.equals
          return { docs: store.members.filter((m) => m.username === eq) }
        }
        return { docs: [] }
      },
    ),
    create: vi.fn(async (args: { collection: string; data: Record<string, unknown> }) => {
      const doc = {
        id: nextId++,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        ...args.data,
      }
      if (args.collection === 'member-sms-codes') store.codes.push(doc as unknown as MemberSmsCode)
      if (args.collection === 'members')
        store.members.push({ ...doc, sessions: [] } as unknown as Member)
      return doc
    }),
    update: vi.fn(
      async (args: { collection: string; id: number; data: Record<string, unknown> }) => {
        const list = args.collection === 'member-sms-codes' ? store.codes : store.members
        const doc = (list as unknown as Array<Record<string, unknown>>).find(
          (d) => d.id === args.id,
        )!
        Object.assign(doc, args.data)
        return doc
      },
    ),
    findByID: vi.fn(
      async (args: { id: number }) => store.members.find((m) => m.id === args.id) ?? null,
    ),
    login: vi.fn(async (args: { data: { username: string; password: string } }) => {
      const m = store.members.find((x) => x.username === args.data.username)
      if (!m || args.data.password !== 'Member1234!') throw new Error('AuthenticationError')
      return { token: 'payload-token-value', user: m, exp: 0 }
    }),
    delete: vi.fn(async () => ({ docs: [] })),
  }
  return payload as unknown as Payload
}

function deps(store: Store, overrides: Partial<MemberServiceDeps> = {}): MemberServiceDeps {
  return {
    payload: fakePayload(store),
    now: () => now,
    smsProvider: { name: 'fixture', send: vi.fn(async () => undefined) },
    codeMode: 'fixture',
    ...overrides,
  }
}

describe('member-service', () => {
  it('sendSmsCode 写入哈希而非明文，并调用适配器', async () => {
    const store: Store = { codes: [], members: [] }
    const d = deps(store)
    await sendSmsCode(d, { phone, purpose: 'login', ip: '1.1.1.1' })
    expect(store.codes).toHaveLength(1)
    expect(store.codes[0].codeHash).toBe(hashSmsCode(secret, phone, 'login', '123456'))
    expect(JSON.stringify(store.codes[0])).not.toContain('123456')
    expect(d.smsProvider?.send).toHaveBeenCalledWith({ phone, code: '123456', minutes: 5 })
  })

  it('sendSmsCode 无适配器 → SMS_UNAVAILABLE 且不落库', async () => {
    const store: Store = { codes: [], members: [] }
    await expect(
      sendSmsCode(deps(store, { smsProvider: null }), { phone, purpose: 'login', ip: 'x' }),
    ).rejects.toMatchObject({ code: 'SMS_UNAVAILABLE' })
    expect(store.codes).toHaveLength(0)
  })

  it('consumeSmsCode：正确码 ok 且标记消费；再次使用 invalid；错码累计 attempts', async () => {
    const store: Store = { codes: [], members: [] }
    const d = deps(store)
    await sendSmsCode(d, { phone, purpose: 'login', ip: 'x' })
    expect(await consumeSmsCode(d, { phone, purpose: 'login', code: '000000' })).toBe('invalid')
    expect(store.codes[0].attempts).toBe(1)
    expect(await consumeSmsCode(d, { phone, purpose: 'login', code: '123456' })).toBe('ok')
    expect(store.codes[0].consumedAt).toBeTruthy()
    expect(await consumeSmsCode(d, { phone, purpose: 'login', code: '123456' })).toBe('invalid')
  })

  it('loginWithSms：新号码需同意；同意后创建会员并发 cookie', async () => {
    const store: Store = { codes: [], members: [] }
    const d = deps(store)
    await sendSmsCode(d, { phone, purpose: 'login', ip: 'x' })
    await expect(
      loginWithSms(d, { phone, code: '123456', consent: null }),
    ).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' })
    await sendSmsCode(d, { phone, purpose: 'login', ip: 'x' })
    const result = await loginWithSms(d, {
      phone,
      code: '123456',
      consent: { accepted: true, policyVersion: 'MVP-R2' },
    })
    expect(result.isNew).toBe(true)
    expect(result.member.username).toBe(phone)
    expect(result.cookie).toMatch(/^sbh-member-token=/)
    expect(store.members[0].sessions).toHaveLength(1)
  })

  it('loginWithPassword：错密码 → INVALID_CREDENTIALS；对 → cookie', async () => {
    const store: Store = {
      codes: [],
      members: [
        {
          id: 1,
          username: phone,
          status: 'active',
          hasPassword: true,
          sessions: [],
        } as unknown as Member,
      ],
    }
    const d = deps(store)
    await expect(
      loginWithPassword(d, { phone, password: 'wrong' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    const r = await loginWithPassword(d, { phone, password: 'Member1234!' })
    expect(r.cookie).toMatch(/^sbh-member-token=eyJ/)
    expect(r.cookie).toContain('HttpOnly')
  })

  it('setPasswordWithSms：校验码后写密码、hasPassword、只留当前 sid（核验 currentMemberId）', async () => {
    const store: Store = {
      codes: [],
      members: [
        {
          id: 1,
          username: phone,
          status: 'active',
          hasPassword: false,
          sessions: [
            { id: 'keep', expiresAt: '2030-01-01T00:00:00Z' },
            { id: 'drop', expiresAt: '2030-01-01T00:00:00Z' },
          ],
        } as unknown as Member,
      ],
    }
    const d = deps(store)
    await sendSmsCode(d, { phone, purpose: 'set-password', ip: 'x' })
    await expect(
      setPasswordWithSms(d, {
        phone,
        code: '123456',
        newPassword: 'short',
        currentSid: 'keep',
        currentMemberId: 1,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const r = await setPasswordWithSms(d, {
      phone,
      code: '123456',
      newPassword: 'Member1234!',
      currentSid: 'keep',
      currentMemberId: 1,
    })
    expect(r.member.hasPassword).toBe(true)
    expect(store.members[0].sessions?.map((s) => s.id)).toEqual(['keep'])

    // 当 currentMemberId 不匹配（未登录或串号）时，不保留目标会员的 currentSid，而是签发新 sid
    await sendSmsCode(d, { phone, purpose: 'set-password', ip: 'x' })
    const r2 = await setPasswordWithSms(d, {
      phone,
      code: '123456',
      newPassword: 'Member1234!',
      currentSid: 'keep',
      currentMemberId: 999,
    })
    expect(store.members[0].sessions?.map((s) => s.id)).not.toContain('keep')
    expect(store.members[0].sessions).toHaveLength(1)
  })

  it('isValidPassword', () => {
    expect(isValidPassword('Abcdefg1')).toBe(true)
    expect(isValidPassword('abcdefgh')).toBe(false)
    expect(isValidPassword('12345678')).toBe(false)
    expect(isValidPassword('Ab1')).toBe(false)
    expect(isValidPassword(42)).toBe(false)
  })

  it('MemberHttpError 带 code', () => {
    expect(new MemberHttpError('RATE_LIMITED', 30)).toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 30,
    })
  })

  it('同一有效码并发登录只有一个能成功（条件更新抢占消费权）', async () => {
    const store: Store = { codes: [], members: [{ id: 1, username: phone, status: 'active', hasPassword: false, sessions: [] } as unknown as Member] }
    const d = deps(store)
    await sendSmsCode(d, { phone, purpose: 'login', ip: 'x' })
    const results = await Promise.allSettled([
      loginWithSms(d, { phone, code: '123456', consent: null }),
      loginWithSms(d, { phone, code: '123456', consent: null }),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled')
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0].reason).toMatchObject({ code: 'CODE_INVALID' })
    expect(store.codes[0].consumedAt).toBeTruthy()
  })

  it('带着已被撤销的 sid 改密：不当作已登录改密，走找回路径并发放新会话', async () => {
    const store: Store = { codes: [], members: [{ id: 1, username: phone, status: 'active', hasPassword: true, sessions: [] } as unknown as Member] }
    const d = deps(store)
    await sendSmsCode(d, { phone, purpose: 'set-password', ip: 'x' })
    const r = await setPasswordWithSms(d, { phone, code: '123456', newPassword: 'Member1234!', currentSid: 'revoked-sid', currentMemberId: 1 })
    const sessions = store.members[0].sessions ?? []
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).not.toBe('revoked-sid')
    expect(r.cookie).toMatch(/^sbh-member-token=/)
  })
})
