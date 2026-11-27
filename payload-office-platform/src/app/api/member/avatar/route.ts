import { getPayload } from 'payload'
import config from '@payload-config'
import { isSameOriginHost } from '@/lib/api/request-guards'
import { getCurrentMember } from '@/domain/member/current-member'
import { handleMemberRoute, ok, MemberHttpError } from '@/domain/member/http'
import { toMemberDto } from '@/domain/member/member-dto'
import {
  buildMemberServiceDeps,
  clearMemberAvatar,
  updateMemberAvatar,
} from '@/domain/member/member-service'
import { AvatarUploadError, validateAvatarFile } from '@/domain/media/avatar-upload'

export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    if (!isSameOriginHost(req)) throw new MemberHttpError('FORBIDDEN_ORIGIN')
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')

    const formData = await req.formData().catch(() => null)
    if (!formData) throw new MemberHttpError('BAD_REQUEST')

    let validated
    try {
      validated = await validateAvatarFile(formData.get('file'))
    } catch (error) {
      if (error instanceof AvatarUploadError) {
        throw new MemberHttpError(error.code)
      }
      throw error
    }

    const payload = await getPayload({ config })
    const updated = await updateMemberAvatar(
      await buildMemberServiceDeps(payload),
      member,
      validated,
    )
    return ok({ member: toMemberDto(updated) })
  })
}

export async function DELETE(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    if (!isSameOriginHost(req)) throw new MemberHttpError('FORBIDDEN_ORIGIN')
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')

    const payload = await getPayload({ config })
    const updated = await clearMemberAvatar(await buildMemberServiceDeps(payload), member)
    return ok({ member: toMemberDto(updated) })
  })
}
