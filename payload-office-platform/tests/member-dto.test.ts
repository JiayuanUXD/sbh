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
      avatarUrl: null,
      hasPassword: true,
      wechatBound: true,
      createdAt: '2026-09-11T00:00:00Z',
    })
    expect(Object.keys(dto).sort()).toEqual([
      'avatarUrl',
      'createdAt',
      'hasPassword',
      'id',
      'nickname',
      'phoneMasked',
      'wechatBound',
    ])
  })

  it('已关联媒体头像时优先返回 thumb URL，未展开或非安全 URL 时回落 null', () => {
    const base = {
      id: 4,
      username: '13900001234',
      nickname: null,
      hasPassword: false,
      createdAt: '2026-09-11T00:00:00Z',
      updatedAt: '',
      consentPolicyVersion: 'MVP-R2',
      consentAcceptedAt: '2026-09-11T00:00:00Z',
    }
    expect(
      toMemberDto({
        ...base,
        avatar: {
          id: 9,
          alt: '头像',
          url: '/api/media/file/origin.png',
          sizes: { thumb: { url: '/api/media/file/thumb.webp' } },
        },
      } as unknown as Member).avatarUrl,
    ).toBe('/api/media/file/thumb.webp')

    expect(
      toMemberDto({
        ...base,
        avatar: { id: 9, alt: '头像', url: 'javascript:alert(1)' },
      } as unknown as Member).avatarUrl,
    ).toBeNull()
  })
})
