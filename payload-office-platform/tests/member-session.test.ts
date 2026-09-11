import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import type { Member } from '@/payload-types'
import {
  MEMBER_COOKIE_NAME,
  expiredMemberCookie,
  newSession,
  readCookie,
  resolveMemberFromToken,
  serializeMemberCookie,
  sessionIsLive,
  signMemberToken,
  verifyMemberToken,
} from '@/domain/member/session'

const secret = 'unit-test-secret-0123456789-0123456789'
const now = new Date('2026-09-11T00:00:00Z')

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 7,
    username: '13800001234',
    status: 'active',
    hasPassword: false,
    sessions: [],
    consentPolicyVersion: 'MVP-R2',
    consentAcceptedAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  } as unknown as Member
}

describe('member session', () => {
  it('cookie 序列化属性', () => {
    const c = serializeMemberCookie('tok', { secure: true, maxAgeSeconds: 2592000 })
    expect(c).toBe(
      `${MEMBER_COOKIE_NAME}=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure`,
    )
    expect(serializeMemberCookie('tok', { secure: false, maxAgeSeconds: 10 })).not.toContain(
      'Secure',
    )
    expect(expiredMemberCookie({ secure: false })).toContain('Max-Age=0')
    expect(readCookie('a=1; sbh-member-token=xyz; b=2', MEMBER_COOKIE_NAME)).toBe('xyz')
    expect(readCookie(null, MEMBER_COOKIE_NAME)).toBeNull()
  })

  it('签发 → 校验往返；错密钥 / 篡改 / 非 members 集合 → null', async () => {
    const token = await signMemberToken({ id: 7, collection: 'members', sid: 's1' }, secret, 60)
    expect(await verifyMemberToken(token, secret)).toEqual({
      id: 7,
      collection: 'members',
      sid: 's1',
    })
    expect(await verifyMemberToken(token, 'wrong-secret-wrong-secret-wrong-secret')).toBeNull()
    expect(await verifyMemberToken(token + 'x', secret)).toBeNull()
    const users = await signMemberToken(
      { id: 7, collection: 'users' as unknown as 'members', sid: 's1' },
      secret,
      60,
    )
    expect(await verifyMemberToken(users, secret)).toBeNull()
  })

  it('newSession 追加并清理过期；sessionIsLive 判 sid 与到期', () => {
    const expired = {
      id: 'old',
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-01-02T00:00:00Z',
    }
    const { sid, sessions } = newSession([expired], now, 60)
    expect(sessions.map((s) => s.id)).toEqual([sid])
    expect(sessionIsLive(sessions, sid, now)).toBe(true)
    expect(sessionIsLive(sessions, 'other', now)).toBe(false)
    expect(sessionIsLive(sessions, sid, new Date(now.getTime() + 61_000))).toBe(false)
  })

  it('resolveMemberFromToken：sid 在 sessions 且启用才返回；停用 / sid 不在 / 过期 → null', async () => {
    const live = {
      id: 'sid-1',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    }
    const doc = member({ sessions: [live] })
    const payload = { secret, findByID: vi.fn(async () => doc) } as unknown as Payload
    const token = await signMemberToken({ id: 7, collection: 'members', sid: 'sid-1' }, secret, 60)
    expect(await resolveMemberFromToken(payload, token, now)).toEqual(doc)
    expect(await resolveMemberFromToken(payload, null, now)).toBeNull()
    const disabled = {
      secret,
      findByID: vi.fn(async () => member({ sessions: [live], status: 'disabled' })),
    } as unknown as Payload
    expect(await resolveMemberFromToken(disabled, token, now)).toBeNull()
    const other = await signMemberToken(
      { id: 7, collection: 'members', sid: 'nope' },
      secret,
      60,
    )
    expect(await resolveMemberFromToken(payload, other, now)).toBeNull()
    expect(
      await resolveMemberFromToken(payload, token, new Date(now.getTime() + 61_000)),
    ).toBeNull()
  })
})
