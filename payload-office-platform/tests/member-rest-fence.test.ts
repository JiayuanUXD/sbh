import { describe, expect, it } from 'vitest'
import { BLOCKED_MEMBER_AUTH_PATHS, isBlockedMemberAuthPath } from '@/domain/member/rest-fence'

describe('members auth REST 封口', () => {
  it('九个 auth 端点全部拦', () => {
    expect(BLOCKED_MEMBER_AUTH_PATHS).toEqual([
      'login',
      'logout',
      'refresh-token',
      'me',
      'first-register',
      'forgot-password',
      'reset-password',
      'unlock',
      'verify',
    ])
    for (const p of BLOCKED_MEMBER_AUTH_PATHS) expect(isBlockedMemberAuthPath(['members', p])).toBe(true)
    expect(isBlockedMemberAuthPath(['members', 'verify', 'some-token'])).toBe(true)
  })
  it('文档 REST 与其它集合不拦', () => {
    expect(isBlockedMemberAuthPath(['members'])).toBe(false)
    expect(isBlockedMemberAuthPath(['members', '123'])).toBe(false)
    expect(isBlockedMemberAuthPath(['users', 'login'])).toBe(false)
    expect(isBlockedMemberAuthPath(undefined)).toBe(false)
    expect(isBlockedMemberAuthPath([])).toBe(false)
  })
})
