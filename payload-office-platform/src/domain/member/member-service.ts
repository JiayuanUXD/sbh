/**
 * 会员领域服务（OPT-088 §6.2–6.4）。路由只做参数收口与响应，业务都在这里，便于用内存版 payload 单测。
 * 所有 Local API 调用 overrideAccess:true 并带 context.memberFlow——那是创建闸门与登录闸门的通行证。
 */
import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import type { Member, MemberSmsCode } from '@/payload-types'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import { createPgRateLimitDeps } from '@/lib/rate-limit-pg'
import { runDistributedRateLimit, type RateLimitConfig } from '@/lib/rate-limit-distributed'
import { extractPgPool } from '@/lib/api/request-guards'
import { isValidCnMobile, normalizePhone } from '@/domain/shared/phone'
import { MemberHttpError } from './http'
import { MEMBER_TOKEN_EXPIRATION_SECONDS } from './member-access'
import { MEMBER_RATE_LIMITS, memberRatePruneRef, rateLimitKey } from './rate-limits'
import { issueMemberSession, signMemberToken, tokenToCookie } from './session'
import {
  SMS_CODE_TTL_MS,
  checkSmsCode,
  generateSmsCode,
  hashSmsCode,
  type SmsCodeCheck,
  type SmsPurpose,
} from './sms-code'
import type { SmsProvider } from './sms-provider'

export type MemberServiceDeps = {
  payload: Payload
  now: () => Date
  smsProvider: SmsProvider | null
  codeMode: 'random' | 'fixture'
}

const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)[\x21-\x7e]{8,64}$/
const PRUNE_INTERVAL_MS = 10 * 60_000
let lastCodePruneAt = 0

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && PASSWORD_RE.test(value)
}

export function requirePhone(value: unknown): string {
  if (typeof value !== 'string') throw new MemberHttpError('INVALID_PHONE')
  const normalized = normalizePhone(value)
  if (!isValidCnMobile(normalized)) throw new MemberHttpError('INVALID_PHONE')
  return normalized
}

export async function checkRateLimit(
  payload: Payload,
  limit: { prefix: string; config: RateLimitConfig },
  raw: string,
): Promise<void> {
  const pool = extractPgPool(payload.db)
  if (!pool) {
    if (!limit.config.failOpen) throw new MemberHttpError('RATE_LIMITED', 60)
    return
  }
  const decision = await runDistributedRateLimit(
    createPgRateLimitDeps(pool),
    limit.config,
    rateLimitKey(limit.prefix, raw),
    memberRatePruneRef,
  )
  if (!decision.allowed)
    throw new MemberHttpError('RATE_LIMITED', Math.max(1, decision.retryAfterSeconds))
}

function hashIp(ip: string): string {
  return rateLimitKey('ip', ip).slice(3)
}

async function pruneExpiredCodes(deps: MemberServiceDeps): Promise<void> {
  const now = deps.now().getTime()
  if (now - lastCodePruneAt < PRUNE_INTERVAL_MS) return
  lastCodePruneAt = now
  const cutoff = new Date(now - 24 * 60 * 60_000).toISOString()
  await deps.payload
    .delete({
      collection: 'member-sms-codes',
      where: { expiresAt: { less_than: cutoff } },
      overrideAccess: true,
    })
    .catch(() => undefined)
}

export async function sendSmsCode(
  deps: MemberServiceDeps,
  input: { phone: string; purpose: SmsPurpose; ip: string },
): Promise<void> {
  if (!deps.smsProvider) throw new MemberHttpError('SMS_UNAVAILABLE')
  await checkRateLimit(deps.payload, MEMBER_RATE_LIMITS.smsPhoneMinute, input.phone)
  await checkRateLimit(deps.payload, MEMBER_RATE_LIMITS.smsPhoneDay, input.phone)
  await checkRateLimit(deps.payload, MEMBER_RATE_LIMITS.smsIp, input.ip)
  await pruneExpiredCodes(deps)
  const code = generateSmsCode(deps.codeMode)
  const now = deps.now()
  await deps.payload.create({
    collection: 'member-sms-codes',
    data: {
      phone: input.phone,
      purpose: input.purpose,
      codeHash: hashSmsCode(deps.payload.secret, input.phone, input.purpose, code),
      expiresAt: new Date(now.getTime() + SMS_CODE_TTL_MS).toISOString(),
      attempts: 0,
      ipHash: hashIp(input.ip),
    },
    overrideAccess: true,
  })
  try {
    await deps.smsProvider.send({ phone: input.phone, code, minutes: 5 })
  } catch (error) {
    deps.payload.logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'member_sms_send_failed',
    )
    throw new MemberHttpError('SMS_UNAVAILABLE')
  }
}

async function latestCode(
  deps: MemberServiceDeps,
  phone: string,
  purpose: SmsPurpose,
): Promise<MemberSmsCode | null> {
  const result = await deps.payload.find({
    collection: 'member-sms-codes',
    where: {
      and: [
        { phone: { equals: phone } },
        { purpose: { equals: purpose } },
        { consumedAt: { exists: false } },
      ],
    },
    sort: '-createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs[0] ?? null
}

export async function consumeSmsCode(
  deps: MemberServiceDeps,
  input: { phone: string; purpose: SmsPurpose; code: string },
): Promise<SmsCodeCheck> {
  const stored = await latestCode(deps, input.phone, input.purpose)
  if (!stored) return 'invalid'
  const attempts = (stored.attempts ?? 0) + 1
  await deps.payload.update({
    collection: 'member-sms-codes',
    id: stored.id,
    data: { attempts },
    overrideAccess: true,
  })
  const check = checkSmsCode({
    secret: deps.payload.secret,
    phone: input.phone,
    purpose: input.purpose,
    code: input.code,
    now: deps.now(),
    stored: {
      codeHash: stored.codeHash,
      expiresAt: stored.expiresAt,
      attempts,
      consumedAt: stored.consumedAt ?? null,
    },
  })
  if (check === 'ok') {
    await deps.payload.update({
      collection: 'member-sms-codes',
      id: stored.id,
      data: { consumedAt: deps.now().toISOString() },
      overrideAccess: true,
    })
  }
  return check
}

function throwOnCode(check: SmsCodeCheck): void {
  if (check === 'expired') throw new MemberHttpError('CODE_EXPIRED')
  if (check === 'invalid') throw new MemberHttpError('CODE_INVALID')
}

export async function findMemberByPhone(
  deps: MemberServiceDeps,
  phone: string,
): Promise<Member | null> {
  const result = await deps.payload.find({
    collection: 'members',
    where: { username: { equals: phone } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return result.docs[0] ?? null
}

export async function createMemberFromVerifiedPhone(
  deps: MemberServiceDeps,
  input: { phone: string; policyVersion: string; flow: string },
): Promise<Member> {
  const now = deps.now().toISOString()
  return (await deps.payload.create({
    collection: 'members',
    data: {
      username: input.phone,
      // 本地策略要求 create 带 password；未设密码的会员给一个不可猜的随机值，hasPassword 标记状态
      password: randomBytes(32).toString('hex'),
      hasPassword: false,
      status: 'active',
      consentPolicyVersion: input.policyVersion,
      consentAcceptedAt: now,
    },
    overrideAccess: true,
    context: { memberFlow: input.flow },
  })) as Member
}

function assertActive(member: Member): void {
  if (member.status !== 'active') throw new MemberHttpError('ACCOUNT_DISABLED')
}

export async function loginWithSms(
  deps: MemberServiceDeps,
  input: {
    phone: string
    code: string
    consent: { accepted: boolean; policyVersion: string } | null
  },
): Promise<{ member: Member; isNew: boolean; cookie: string }> {
  throwOnCode(
    await consumeSmsCode(deps, { phone: input.phone, purpose: 'login', code: input.code }),
  )
  let member = await findMemberByPhone(deps, input.phone)
  let isNew = false
  if (!member) {
    const consentOk =
      input.consent?.accepted === true && input.consent.policyVersion === PRIVACY_POLICY_VERSION
    if (!consentOk) throw new MemberHttpError('CONSENT_REQUIRED')
    member = await createMemberFromVerifiedPhone(deps, {
      phone: input.phone,
      policyVersion: PRIVACY_POLICY_VERSION,
      flow: 'sms',
    })
    isNew = true
  }
  assertActive(member)
  const { cookie } = await issueMemberSession(deps.payload, member, deps.now())
  return { member, isNew, cookie }
}

export async function loginWithPassword(
  deps: MemberServiceDeps,
  input: { phone: string; password: string },
): Promise<{ member: Member; cookie: string }> {
  let result: { token?: string; user: Member }
  try {
    result = (await deps.payload.login({
      collection: 'members',
      data: { username: input.phone, password: input.password },
      context: { memberFlow: 'password' },
      depth: 0,
    })) as { token?: string; user: Member }
  } catch {
    // 密码错、账号锁定、账号停用、不存在：一律同一文案，不泄露存在性与锁定态
    throw new MemberHttpError('INVALID_CREDENTIALS')
  }
  if (!result.token) throw new MemberHttpError('INVALID_CREDENTIALS')
  await deps.payload.update({
    collection: 'members',
    id: result.user.id,
    data: { lastLoginAt: deps.now().toISOString() },
    overrideAccess: true,
    context: { memberFlow: 'session' },
  })
  return { member: result.user, cookie: await tokenToCookie(deps.payload, result.token) }
}

export async function setPasswordWithSms(
  deps: MemberServiceDeps,
  input: { phone: string; code: string; newPassword: string; currentSid: string | null },
): Promise<{ member: Member; cookie: string }> {
  if (!isValidPassword(input.newPassword)) throw new MemberHttpError('BAD_REQUEST')
  throwOnCode(
    await consumeSmsCode(deps, {
      phone: input.phone,
      purpose: 'set-password',
      code: input.code,
    }),
  )
  const member = await findMemberByPhone(deps, input.phone)
  if (!member) throw new MemberHttpError('CODE_INVALID')
  assertActive(member)
  const kept = (member.sessions ?? []).filter((s) => s.id === input.currentSid)
  const updated = (await deps.payload.update({
    collection: 'members',
    id: member.id,
    data: { password: input.newPassword, hasPassword: true, sessions: kept },
    overrideAccess: true,
    context: { memberFlow: 'password-set' },
  })) as Member
  if (input.currentSid) {
    // 已登录改密码：保留当前 sid、重签 token，本设备不掉线，其它设备全部下线
    const token = await signMemberToken(
      { id: member.id, collection: 'members', sid: input.currentSid },
      deps.payload.secret,
      MEMBER_TOKEN_EXPIRATION_SECONDS,
    )
    return { member: updated, cookie: await tokenToCookie(deps.payload, token) }
  }
  const { cookie } = await issueMemberSession(deps.payload, updated, deps.now())
  return { member: updated, cookie }
}

export async function updateNickname(
  deps: MemberServiceDeps,
  member: Member,
  nickname: string,
): Promise<Member> {
  const trimmed = nickname.trim()
  if (trimmed.length < 1 || trimmed.length > 30) throw new MemberHttpError('BAD_REQUEST')
  return (await deps.payload.update({
    collection: 'members',
    id: member.id,
    data: { nickname: trimmed },
    overrideAccess: true,
    context: { memberFlow: 'profile' },
  })) as Member
}

/** 路由用：从环境装配 deps。 */
export async function buildMemberServiceDeps(payload: Payload): Promise<MemberServiceDeps> {
  const { resolveSmsProvider } = await import('./sms-provider')
  const provider = resolveSmsProvider(process.env, (msg) => payload.logger.info(msg))
  return {
    payload,
    now: () => new Date(),
    smsProvider: provider,
    codeMode: provider?.name === 'fixture' ? 'fixture' : 'random',
  }
}
