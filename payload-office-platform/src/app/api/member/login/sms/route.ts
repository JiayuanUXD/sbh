import { getPayload } from 'payload'
import config from '@payload-config'
import { clientIp } from '@/lib/api/request-guards'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'
import { toMemberDto } from '@/domain/member/member-dto'
import {
  buildMemberServiceDeps,
  checkRateLimit,
  loginWithSms,
  requirePhone,
} from '@/domain/member/member-service'
import { MEMBER_RATE_LIMITS } from '@/domain/member/rate-limits'

function readConsent(value: unknown): { accepted: boolean; policyVersion: string } | null {
  if (value === null || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  return {
    accepted: v.accepted === true,
    policyVersion: typeof v.policyVersion === 'string' ? v.policyVersion : '',
  }
}

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const phone = requirePhone(body.phone)
    if (typeof body.code !== 'string') throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    await checkRateLimit(payload, MEMBER_RATE_LIMITS.loginIp, clientIp(req))
    const deps = await buildMemberServiceDeps(payload)
    const { member, isNew, cookie } = await loginWithSms(deps, {
      phone,
      code: body.code,
      consent: readConsent(body.consent),
    })
    return ok({ member: toMemberDto(member), isNew }, { cookie })
  })
}
