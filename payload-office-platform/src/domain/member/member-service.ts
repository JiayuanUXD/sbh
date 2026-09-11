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
import { isUniqueViolation } from '@/domain/shared/unique-violation'
import { MemberHttpError } from './http'
import { MEMBER_TOKEN_EXPIRATION_SECONDS } from './member-access'
import { MEMBER_RATE_LIMITS, memberRatePruneRef, rateLimitKey } from './rate-limits'
import { issueMemberSession, sessionIsLive, signMemberToken, tokenToCookie } from './session'
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
  const created = await deps.payload.create({
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
    // D9 防御：短信网关发送失败时立即删除新插入的记录，防止残留孤立验证码行
    await deps.payload
      .delete({
        collection: 'member-sms-codes',
        id: created.id,
        overrideAccess: true,
      })
      .catch(() => undefined)
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

/**
 * 验证码表的两个写操作必须原子：
 *   - 尝试次数用 `attempts = attempts + 1 ... RETURNING attempts`，并发猜码不会互相覆盖计数；
 *   - 消费用 `WHERE consumed_at IS NULL` 的条件更新，只有抢到那一行的请求算数——
 *     两个并发请求带同一个有效码，先 SELECT 再各自 UPDATE 会让两个都通过（Codex 评论 3）。
 * Payload Local API 没有条件更新，直接走 pg pool；pool 拿不到是部署问题，直接抛，不静默降级。
 */
function requirePool(payload: Payload) {
  const pool = extractPgPool(payload.db)
  if (!pool) throw new Error('member-sms-codes 需要 PostgreSQL 连接池做原子更新')
  return pool
}

async function incrementSmsAttempts(deps: MemberServiceDeps, codeId: number): Promise<number> {
  const result = await requirePool(deps.payload).query({
    text: 'UPDATE member_sms_codes SET attempts = attempts + 1, updated_at = NOW() WHERE id = $1 RETURNING attempts',
    values: [codeId],
  })
  const raw = result.rows[0]?.attempts
  return typeof raw === 'number' ? raw : Number(raw ?? 0)
}

/** 仅核验验证码合法性并记录错误尝试次数，不打上已消费标记（D1） */
export async function verifySmsCode(
  deps: MemberServiceDeps,
  input: { phone: string; purpose: SmsPurpose; code: string },
): Promise<{ check: SmsCodeCheck; codeId: number | null }> {
  const stored = await latestCode(deps, input.phone, input.purpose)
  if (!stored) return { check: 'invalid', codeId: null }
  const attempts = await incrementSmsAttempts(deps, stored.id)
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
  return { check, codeId: check === 'ok' ? stored.id : null }
}

/** 原子地把验证码标为已消费；返回 false 表示已被别的请求抢先消费。 */
export async function markSmsCodeConsumed(
  deps: MemberServiceDeps,
  codeId: number,
): Promise<boolean> {
  const result = await requirePool(deps.payload).query({
    text: 'UPDATE member_sms_codes SET consumed_at = NOW(), updated_at = NOW() WHERE id = $1 AND consumed_at IS NULL RETURNING id',
    values: [codeId],
  })
  return (result.rowCount ?? result.rows.length) > 0
}

/** 校验通过后必须抢到消费权，抢不到就当无效码。 */
async function claimSmsCodeOrThrow(deps: MemberServiceDeps, codeId: number | null): Promise<void> {
  if (codeId === null) throw new MemberHttpError('CODE_INVALID')
  const claimed = await markSmsCodeConsumed(deps, codeId)
  if (!claimed) throw new MemberHttpError('CODE_INVALID')
}

export async function consumeSmsCode(
  deps: MemberServiceDeps,
  input: { phone: string; purpose: SmsPurpose; code: string },
): Promise<SmsCodeCheck> {
  const { check, codeId } = await verifySmsCode(deps, input)
  if (check !== 'ok' || codeId === null) return check
  return (await markSmsCodeConsumed(deps, codeId)) ? 'ok' : 'invalid'
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
  // D1 防御：先核验验证码，但不立即标记消费。若未勾选协议则抛 CONSENT_REQUIRED，验证码依然有效
  const { check, codeId } = await verifySmsCode(deps, {
    phone: input.phone,
    purpose: 'login',
    code: input.code,
  })
  throwOnCode(check)
  let member = await findMemberByPhone(deps, input.phone)
  if (!member) {
    const consentOk =
      input.consent?.accepted === true && input.consent.policyVersion === PRIVACY_POLICY_VERSION
    if (!consentOk) throw new MemberHttpError('CONSENT_REQUIRED')
  }
  if (member) assertActive(member)
  // 消费权必须在建号之前抢：两个并发的首次登录若都走到建号，输的那个会撞手机号唯一索引
  // 变成 500，而不是干净的 CODE_INVALID
  await claimSmsCodeOrThrow(deps, codeId)
  let isNew = false
  if (!member) {
    try {
      member = await createMemberFromVerifiedPhone(deps, {
        phone: input.phone,
        policyVersion: PRIVACY_POLICY_VERSION,
        flow: 'sms',
      })
      isNew = true
    } catch (error) {
      // 抢到了消费权却仍撞唯一索引：说明对方用另一个码刚建了号，直接用它
      if (!isUniqueViolation(error, { tableName: 'members', column: 'username' })) throw error
      member = await findMemberByPhone(deps, input.phone)
      if (!member) throw error
      assertActive(member)
    }
  }
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
  if (!result.user) throw new MemberHttpError('INVALID_CREDENTIALS')
  // S1 防御：丢弃 payload.login 返回的原生 Token（它使用 payload.secret 签发），
  // 必须经由 issueMemberSession 用独立派生子密钥签发 Token，断绝成为后台 req.user 的途径
  const { cookie } = await issueMemberSession(deps.payload, result.user, deps.now())
  return { member: result.user, cookie }
}

export async function setPasswordWithSms(
  deps: MemberServiceDeps,
  input: {
    phone: string
    code: string
    newPassword: string
    currentSid: string | null
    currentMemberId?: number | null
  },
): Promise<{ member: Member; cookie: string }> {
  if (!isValidPassword(input.newPassword)) throw new MemberHttpError('BAD_REQUEST')
  const { check, codeId } = await verifySmsCode(deps, {
    phone: input.phone,
    purpose: 'set-password',
    code: input.code,
  })
  throwOnCode(check)
  const member = await findMemberByPhone(deps, input.phone)
  if (!member) throw new MemberHttpError('CODE_INVALID')
  assertActive(member)
  await claimSmsCodeOrThrow(deps, codeId)

  // 「已登录改密」的判据：cookie 里的会员就是目标会员，且那个 sid 此刻仍在会话表里。
  // 只验签不验存活的话，一个已被别的设备踢下线但仍带着旧 cookie 的浏览器会被当成
  // 已登录：改密后拿到一张指向已不存在 sid 的 cookie，跳转即未登录（Codex 评论 4）。
  const isSelfChange =
    typeof input.currentSid === 'string' &&
    typeof input.currentMemberId === 'number' &&
    input.currentMemberId === member.id &&
    sessionIsLive(member.sessions, input.currentSid, deps.now())

  if (isSelfChange && input.currentSid) {
    // 已登录改密码：保留当前 sid、派生密钥重签 token，本设备不掉线，其它设备全部下线
    const kept = (member.sessions ?? []).filter((s) => s.id === input.currentSid)
    const updated = (await deps.payload.update({
      collection: 'members',
      id: member.id,
      data: { password: input.newPassword, hasPassword: true, sessions: kept },
      overrideAccess: true,
      context: { memberFlow: 'password-set' },
    })) as Member
    const token = await signMemberToken(
      { id: member.id, collection: 'members', sid: input.currentSid },
      deps.payload.secret,
      MEMBER_TOKEN_EXPIRATION_SECONDS,
    )
    return { member: updated, cookie: await tokenToCookie(deps.payload, token) }
  }

  const updated = (await deps.payload.update({
    collection: 'members',
    id: member.id,
    data: { password: input.newPassword, hasPassword: true, sessions: [] },
    overrideAccess: true,
    context: { memberFlow: 'password-set' },
  })) as Member
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
