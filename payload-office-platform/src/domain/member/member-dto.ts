import type { Member } from '@/payload-types'
import { maskPhone } from '@/domain/shared/phone'

/** 会员对外 DTO（OPT-088 §5）。永远不含 hash / salt / sessions / unionid / 完整手机号。 */
export type MemberDto = Readonly<{
  id: number
  phoneMasked: string
  nickname: string | null
  hasPassword: boolean
  wechatBound: boolean
  createdAt: string
}>

export function toMemberDto(member: Member): MemberDto {
  return {
    id: member.id,
    phoneMasked: maskPhone(member.username),
    nickname: member.nickname ?? null,
    hasPassword: Boolean(member.hasPassword),
    wechatBound: typeof member.wechatUnionId === 'string' && member.wechatUnionId.length > 0,
    createdAt: member.createdAt,
  }
}
