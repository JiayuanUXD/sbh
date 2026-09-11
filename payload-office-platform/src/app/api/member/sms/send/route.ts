import { getPayload } from 'payload'
import config from '@payload-config'
import { clientIp } from '@/lib/api/request-guards'
import { handleMemberRoute, ok, readJsonBody, MemberHttpError } from '@/domain/member/http'
import { buildMemberServiceDeps, requirePhone, sendSmsCode } from '@/domain/member/member-service'
import { isSmsPurpose } from '@/domain/member/sms-code'

export async function POST(req: Request): Promise<Response> {
  return handleMemberRoute(async () => {
    const body = await readJsonBody(req)
    const phone = requirePhone(body.phone)
    if (!isSmsPurpose(body.purpose)) throw new MemberHttpError('BAD_REQUEST')
    const payload = await getPayload({ config })
    const deps = await buildMemberServiceDeps(payload)
    await sendSmsCode(deps, { phone, purpose: body.purpose, ip: clientIp(req) })
    // 不论号码是否已注册都 200：不泄露注册状态
    return ok({})
  })
}
