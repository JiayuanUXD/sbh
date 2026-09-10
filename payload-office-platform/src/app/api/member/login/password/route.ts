import { getPayload } from 'payload'
import config from '@payload-config'
import { clientIp } from '@/lib/api/request-guards'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'
import { toMemberDto } from '@/domain/member/member-dto'
import {
  buildMemberServiceDeps,
  checkRateLimit,
  loginWithPassword,
  requirePhone,
} from '@/domain/member/member-service'
import { MEMBER_RATE_LIMITS } from '@/domain/member/rate-limits'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const phone = requirePhone(body.phone)
    if (typeof body.password !== 'string' || body.password.length === 0)
      throw new MemberHttpError('INVALID_CREDENTIALS')
    const payload = await getPayload({ config })
    await checkRateLimit(payload, MEMBER_RATE_LIMITS.loginIp, clientIp(req))
    const deps = await buildMemberServiceDeps(payload)
    const { member, cookie } = await loginWithPassword(deps, { phone, password: body.password })
    return ok({ member: toMemberDto(member) }, { cookie })
  })
}
