import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMember } from '@/domain/member/current-member'
import { addFavorite, isFavoriteInput, listFavorites, removeFavorite } from '@/domain/member/favorites'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'

export async function GET(): Promise<Response> {
  return handleMemberRoute(async () => {
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')
    const payload = await getPayload({ config })
    return ok({ items: await listFavorites(payload, member.id) })
  })
}

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')
    if (!isFavoriteInput(body)) throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    return ok({ items: await addFavorite(payload, member.id, body) })
  })
}

export async function DELETE(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const member = await getCurrentMember()
    if (!member) throw new MemberHttpError('UNAUTHENTICATED')
    const type = body.type
    const id = body.id
    if ((type !== 'listing' && type !== 'building') || typeof id !== 'number') throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    return ok({ items: await removeFavorite(payload, member.id, { type, id }) })
  })
}
