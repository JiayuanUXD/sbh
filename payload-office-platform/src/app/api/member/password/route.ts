import { getPayload } from 'payload'
import config from '@payload-config'
import { clientIp } from '@/lib/api/request-guards'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'
import { toMemberDto } from '@/domain/member/member-dto'
import {
  buildMemberServiceDeps,
  checkRateLimit,
  requirePhone,
  setPasswordWithSms,
} from '@/domain/member/member-service'
import { MEMBER_RATE_LIMITS } from '@/domain/member/rate-limits'
import { MEMBER_COOKIE_NAME, readCookie, verifyMemberToken } from '@/domain/member/session'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const phone = requirePhone(body.phone)
    if (typeof body.code !== 'string' || typeof body.newPassword !== 'string')
      throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    await checkRateLimit(payload, MEMBER_RATE_LIMITS.loginIp, clientIp(req))
    const token = readCookie(req.headers.get('cookie'), MEMBER_COOKIE_NAME)
    const claims = token ? await verifyMemberToken(token, payload.secret) : null
    const deps = await buildMemberServiceDeps(payload)
    const { member, cookie } = await setPasswordWithSms(deps, {
      phone,
      code: body.code,
      newPassword: body.newPassword,
      currentSid: claims?.sid ?? null,
    })
    return ok({ member: toMemberDto(member) }, { cookie })
  })
}
