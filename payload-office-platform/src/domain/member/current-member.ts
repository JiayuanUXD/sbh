import { cache } from 'react'
import { cookies } from 'next/headers'
import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Member } from '@/payload-types'
import { toMemberDto, type MemberDto } from './member-dto'
import { MEMBER_COOKIE_NAME, resolveMemberFromToken } from './session'

/** 只在 Server Component / 路由处理器里调用；请求级缓存，一个请求最多查一次库。 */
export const getCurrentMember = cache(async (): Promise<Member | null> => {
  let token: string | null = null
  try {
    const store = await cookies()
    token = store.get(MEMBER_COOKIE_NAME)?.value ?? null
  } catch {
    return null
  }
  if (!token) return null
  const payload = await getPayload({ config })
  return resolveMemberFromToken(payload, token)
})

export const getCurrentMemberDto = cache(async (): Promise<MemberDto | null> => {
  const member = await getCurrentMember()
  if (!member) return null
  if (typeof member.avatar === 'number') {
    const payload = await getPayload({ config })
    const media = await payload
      .findByID({ collection: 'media', id: member.avatar, depth: 0, overrideAccess: true })
      .catch(() => null)
    return toMemberDto({ ...member, avatar: media })
  }
  return toMemberDto(member)
})
