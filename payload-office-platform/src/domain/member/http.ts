/** 会员路由的响应约定（OPT-088 §6）：错误码、状态码、文案单一来源。 */
import { NextResponse } from 'next/server'
import { isSameOriginHost, isStrictJsonContentType } from '@/lib/api/request-guards'

export type MemberErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_PHONE'
  | 'CONSENT_REQUIRED'
  | 'CODE_INVALID'
  | 'CODE_EXPIRED'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'ACCOUNT_DISABLED'
  | 'FORBIDDEN_ORIGIN'
  | 'WECHAT_ALREADY_BOUND'
  | 'FAVORITE_LIMIT'
  | 'RATE_LIMITED'
  | 'SMS_UNAVAILABLE'

export const MEMBER_ERROR_STATUS: Record<MemberErrorCode, number> = {
  BAD_REQUEST: 400,
  INVALID_PHONE: 400,
  CONSENT_REQUIRED: 400,
  CODE_INVALID: 400,
  CODE_EXPIRED: 400,
  INVALID_CREDENTIALS: 401,
  UNAUTHENTICATED: 401,
  ACCOUNT_DISABLED: 403,
  FORBIDDEN_ORIGIN: 403,
  WECHAT_ALREADY_BOUND: 409,
  FAVORITE_LIMIT: 409,
  RATE_LIMITED: 429,
  SMS_UNAVAILABLE: 503,
}

export const MEMBER_ERROR_MESSAGE: Record<MemberErrorCode, string> = {
  BAD_REQUEST: '请求格式不正确',
  INVALID_PHONE: '请输入正确的大陆手机号',
  CONSENT_REQUIRED: '请先阅读并同意隐私政策',
  CODE_INVALID: '验证码错误或已失效',
  CODE_EXPIRED: '验证码已过期，请重新获取',
  INVALID_CREDENTIALS: '手机号或密码错误',
  UNAUTHENTICATED: '请先登录',
  ACCOUNT_DISABLED: '账号已停用，请联系客服',
  FORBIDDEN_ORIGIN: '请求来源不被允许',
  WECHAT_ALREADY_BOUND: '该微信已绑定其他账号，请先在原账号解绑',
  FAVORITE_LIMIT: '收藏已达上限 200 条，请先清理',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  SMS_UNAVAILABLE: '短信服务暂不可用，请稍后再试',
}

export class MemberHttpError extends Error {
  readonly code: MemberErrorCode
  readonly retryAfterSeconds?: number
  constructor(code: MemberErrorCode, retryAfterSeconds?: number) {
    super(MEMBER_ERROR_MESSAGE[code])
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function fail(code: MemberErrorCode, retryAfterSeconds?: number): Response {
  const headers: Record<string, string> = {}
  if (code === 'RATE_LIMITED' && retryAfterSeconds !== undefined)
    headers['Retry-After'] = String(retryAfterSeconds)
  return NextResponse.json(
    { ok: false, code, message: MEMBER_ERROR_MESSAGE[code] },
    { status: MEMBER_ERROR_STATUS[code], headers },
  )
}

export function ok(
  body: Record<string, unknown>,
  init: { cookie?: string; status?: number } = {},
): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (init.cookie) headers['Set-Cookie'] = init.cookie
  return NextResponse.json({ ok: true, ...body }, { status: init.status ?? 200, headers })
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  if (!isSameOriginHost(req)) throw new MemberHttpError('FORBIDDEN_ORIGIN')
  if (!isStrictJsonContentType(req.headers.get('content-type')))
    throw new MemberHttpError('BAD_REQUEST')
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    throw new MemberHttpError('BAD_REQUEST')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new MemberHttpError('BAD_REQUEST')
  return parsed as Record<string, unknown>
}

export async function handleMemberRoute(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof MemberHttpError) return fail(error.code, error.retryAfterSeconds)
    console.error('[member-route] unexpected error', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { ok: false, code: 'INTERNAL', message: '服务暂时不可用' },
      { status: 500 },
    )
  }
}
