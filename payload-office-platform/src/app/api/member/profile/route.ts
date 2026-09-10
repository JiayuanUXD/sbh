import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMember } from '@/domain/member/current-member'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'
import { toMemberDto } from '@/domain/member/member-dto'
import { buildMemberServiceDeps, updateNickname } from '@/domain/member/member-service'

export async function PATCH(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')
    if (typeof body.nickname !== 'string') throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    const updated = await updateNickname(
      await buildMemberServiceDeps(payload),
      member,
      body.nickname,
    )
    return ok({ member: toMemberDto(updated) })
  })
}
