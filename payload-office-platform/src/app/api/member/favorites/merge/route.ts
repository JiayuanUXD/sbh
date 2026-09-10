import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMember } from '@/domain/member/current-member'
import { isFavoriteMergeItem, mergeLocalFavorites } from '@/domain/member/favorites'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')
    if (!Array.isArray(body.items) || body.items.length > 100) throw new MemberHttpError('BAD_REQUEST')
    const items = body.items.filter(isFavoriteMergeItem)
    const payload = await getPayload({ config })
    return ok({ items: await mergeLocalFavorites(payload, member.id, items) })
  })
}
