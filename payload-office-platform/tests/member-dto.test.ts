import { describe, expect, it } from 'vitest'
import type { Member } from '@/payload-types'
import { toMemberDto } from '@/domain/member/member-dto'

describe('toMemberDto', () => {
  it('只暴露六个字段，手机号脱敏', () => {
    const dto = toMemberDto({
      id: 3,
      username: '13800001234',
      nickname: '小王',
      hasPassword: true,
      wechatUnionId: 'u1',
      status: 'active',
      hash: 'H',
      salt: 'S',
      sessions: [{ id: 'x', expiresAt: '2030-01-01T00:00:00Z' }],
      createdAt: '2026-09-11T00:00:00Z',
      updatedAt: '',
      consentPolicyVersion: 'MVP-R2',
      consentAcceptedAt: '2026-09-11T00:00:00Z',
    } as unknown as Member)
    expect(dto).toEqual({
      id: 3,
      phoneMasked: '138****1234',
      nickname: '小王',
      hasPassword: true,
      wechatBound: true,
      createdAt: '2026-09-11T00:00:00Z',
    })
    expect(Object.keys(dto).sort()).toEqual([
      'createdAt',
      'hasPassword',
      'id',
      'nickname',
      'phoneMasked',
      'wechatBound',
    ])
  })
})
