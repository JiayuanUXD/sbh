import { cache } from 'react'
import { cookies } from 'next/headers'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { Member } from '@/payload-types'
import { toMemberDto, type MemberDto } from './member-dto'
import { MEMBER_COOKIE_NAME, resolveMemberFromToken } from './session'

/** 只在 Server Component / 路由处理器里调用；请求级缓存，一个请求最多查一次库。 */
export const getCurrentMember = cache(async (): Promise<Member | null> => {
  const store = await cookies()
  const token = store.get(MEMBER_COOKIE_NAME)?.value ?? null
  if (!token) return null
  const payload = await getPayload({ config })
  return resolveMemberFromToken(payload, token)
})

export const getCurrentMemberDto = cache(async (): Promise<MemberDto | null> => {
  const member = await getCurrentMember()
  return member ? toMemberDto(member) : null
})
