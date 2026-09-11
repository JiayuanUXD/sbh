import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMember } from '@/domain/member/current-member'
import { handleMemberRoute, ok, readJsonBody } from '@/domain/member/http'
import {
  MEMBER_COOKIE_NAME,
  expiredMemberCookie,
  readCookie,
  revokeMemberSession,
  verifyMemberToken,
} from '@/domain/member/session'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    await readJsonBody(req) // 只为同源校验；body 可为 {}
    const payload = await getPayload({ config })
    const member = await getCurrentMember()
    const token = readCookie(req.headers.get('cookie'), MEMBER_COOKIE_NAME)
    const claims = token ? await verifyMemberToken(token, payload.secret) : null
    if (member && claims) await revokeMemberSession(payload, member, claims.sid)
    return ok(
      {},
      { cookie: expiredMemberCookie({ secure: process.env.NODE_ENV === 'production' }) },
    )
  })
}
