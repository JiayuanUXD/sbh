/**
 * 会员会话（OPT-088 §5）。
 * token 是 HS256 JWT，claims 只有 { id, collection:'members', sid }，用 Payload 的 jwtSign 签、jose 验；
 * sid 写进会员的 sessions 数组（Payload 自带字段），撤销即从数组删除。
 * cookie 名 sbh-member-token，与后台的 payload-token 完全分开。
 */
import { createHmac, randomUUID } from 'node:crypto'
import { jwtVerify } from 'jose'
import { jwtSign, type Payload } from 'payload'
import type { Member } from '@/payload-types'
import { MEMBER_TOKEN_EXPIRATION_SECONDS } from './member-access'

export const MEMBER_COOKIE_NAME = 'sbh-member-token'

export type MemberTokenClaims = Readonly<{ id: number; collection: 'members'; sid: string }>

/**
 * 派生会员 Token 签名专用密钥（OPT-088 S1 防御）：
 * 绝对不可使用 payload.secret 直签，避免客户端经 Authorization: JWT 头被 Payload 原生策略识别并成为 req.user。
 */
export function getMemberTokenSecret(payloadSecret: string): string {
  return createHmac('sha256', payloadSecret).update('sbh:member:token:v1').digest('hex')
}

export function serializeMemberCookie(
  token: string,
  opts: { secure: boolean; maxAgeSeconds: number },
): string {
  const parts = [
    `${MEMBER_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${opts.maxAgeSeconds}`,
  ]
  if (opts.secure) parts.push('Secure')
  return parts.join('; ')
}

export function expiredMemberCookie(opts: { secure: boolean }): string {
  return serializeMemberCookie('', { secure: opts.secure, maxAgeSeconds: 0 })
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=') || null
  }
  return null
}

export async function signMemberToken(
  claims: MemberTokenClaims,
  payloadSecret: string,
  expiresInSeconds: number,
): Promise<string> {
  const secret = getMemberTokenSecret(payloadSecret)
  const { token } = await jwtSign({
    fieldsToSign: { ...claims },
    secret,
    tokenExpiration: expiresInSeconds,
  })
  return token
}

export async function verifyMemberToken(
  token: string,
  payloadSecret: string,
): Promise<MemberTokenClaims | null> {
  try {
    const secret = getMemberTokenSecret(payloadSecret)
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    })
    if (payload.collection !== 'members') return null
    if (
      typeof payload.id !== 'number' ||
      typeof payload.sid !== 'string' ||
      payload.sid.length === 0
    ) {
      return null
    }
    return { id: payload.id, collection: 'members', sid: payload.sid }
  } catch {
    return null
  }
}

type Session = NonNullable<Member['sessions']>[number]

export const MAX_MEMBER_SESSIONS = 10

export function newSession(
  existing: Member['sessions'],
  now: Date,
  ttlSeconds: number,
): { sid: string; sessions: Session[] } {
  const sid = randomUUID()
  const live = (existing ?? []).filter((s) => new Date(s.expiresAt).getTime() > now.getTime())
  const session: Session = {
    id: sid,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  }
  // 保留最近 (MAX_MEMBER_SESSIONS - 1) 条有效会话 + 当前新会话，封顶 10 条（D6）
  const trimmed = live.slice(-(MAX_MEMBER_SESSIONS - 1))
  return { sid, sessions: [...trimmed, session] }
}

export function sessionIsLive(sessions: Member['sessions'], sid: string, now: Date): boolean {
  return (sessions ?? []).some(
    (s) => s.id === sid && new Date(s.expiresAt).getTime() > now.getTime(),
  )
}

function secure(): boolean {
  return process.env.NODE_ENV === 'production'
}

export async function tokenToCookie(_payload: Payload, token: string): Promise<string> {
  return serializeMemberCookie(token, {
    secure: secure(),
    maxAgeSeconds: MEMBER_TOKEN_EXPIRATION_SECONDS,
  })
}

/** 短信 / 微信登录用：写 session、更新 lastLoginAt、签 token。密码登录走 payload.login，只需 tokenToCookie。 */
export async function issueMemberSession(
  payload: Payload,
  member: Member,
  now: Date = new Date(),
): Promise<{ token: string; cookie: string }> {
  const { sid, sessions } = newSession(member.sessions, now, MEMBER_TOKEN_EXPIRATION_SECONDS)
  await payload.update({
    collection: 'members',
    id: member.id,
    data: { sessions, lastLoginAt: now.toISOString() },
    overrideAccess: true,
    context: { memberFlow: 'session' },
  })
  const token = await signMemberToken(
    { id: member.id, collection: 'members', sid },
    payload.secret,
    MEMBER_TOKEN_EXPIRATION_SECONDS,
  )
  return { token, cookie: await tokenToCookie(payload, token) }
}

export async function resolveMemberFromToken(
  payload: Payload,
  token: string | null,
  now: Date = new Date(),
): Promise<Member | null> {
  if (!token) return null
  const claims = await verifyMemberToken(token, payload.secret)
  if (!claims) return null
  const member = await payload
    .findByID({ collection: 'members', id: claims.id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!member || member.status !== 'active') return null
  if (!sessionIsLive(member.sessions, claims.sid, now)) return null
  return member
}

export async function revokeMemberSession(
  payload: Payload,
  member: Member,
  sid: string,
): Promise<void> {
  await payload.update({
    collection: 'members',
    id: member.id,
    data: { sessions: (member.sessions ?? []).filter((s) => s.id !== sid) },
    overrideAccess: true,
    context: { memberFlow: 'session' },
  })
}
