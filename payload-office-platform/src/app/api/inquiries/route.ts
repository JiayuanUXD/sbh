/**
 * F5 询盘提交 API 路由（/api/inquiries）
 *
 * 设计依据：specs/frontend-mvp/design.md §10、§12.2、§13
 *           Page PRD: FP-05 §5、§6、§9
 *           tasks/F5-inquiry.md 5.3–5.6
 *
 * 守护不变量：
 *   - 仅接受 POST + application/json + 同源请求；
 *   - 请求体视为 unknown，由 domain/inquiry/schema 白名单收窄；
 *   - body 大小上限 16KB（FP-05 §5：校验 body 大小）；
 *   - 隐私同意版本必须匹配当前 PRIVACY_POLICY_VERSION；
 *   - 幂等键 = sha256(requestId + normalizedPhone + targetType + targetSlug)；
 *   - 幂等键命中 → 返回首次成功语义，不重复建 Lead；
 *   - 带房源时调用 assertEffectiveListing；失效 → 409 listing_not_found，不建兴趣关系；
 *   - 限流：每 IP 每分钟 5 次，429 + Retry-After，不记录完整 IP；
 *   - 日志：使用 buildInquiryLogEntry，不含姓名/完整手机号/留言正文/原始 URL；
 *   - 响应形状固定：{ ok: true } | { ok: false, errors: string[] } | { ok: false, error: string }
 *   - 不暴露 Lead ID、内部错误或房源失效原因（FP-05 §6、§7）。
 */

import { getPayload, type Payload } from 'payload'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import {
  assertEffectiveBuilding,
  assertEffectiveListing,
  createSearchContext,
} from '@/domain/public-catalog'
import {
  buildInquiryLogEntry,
  computeIdempotencyKey,
  deriveTargetSlug,
  hashIpForLog,
  validateInquiry,
  validateViewingPreference,
  type InquiryRequest,
} from '@/domain/inquiry'
import { mapGlobalToSchedule } from '@/domain/advisor-availability'
import { runDistributedRateLimit } from '@/lib/rate-limit-distributed'
import { createPgRateLimitDeps, type PoolLike } from '@/lib/rate-limit-pg'
import { INQUIRY_RATE_LIMIT_CONFIG as RATE_LIMIT_CONFIG } from '@/lib/rate-limit-config'
import { siteConfig } from '@/lib/frontend/site-config'
import { ratePruneRef } from './rate-limit-state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 每请求 body 最大字节数（FP-05 §5：校验 body 大小） */
const MAX_BODY_BYTES = 16 * 1024

/**
 * IP 哈希存储：日志中不记录完整 IP（FP-05 §5），
 * 限流键使用 hashIpForLog(ip, dailySalt) 派生，避免原始 IP 进入存储或日志。
 * 限流配置（windowMs/max/maxKeys/pruneIntervalMs/failOpen）见 @/lib/rate-limit-config。
 */

/** 提取客户端 IP（CloudRun / 反代场景取首跳） */
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/**
 * 日级盐：UTC 日期字符串。同一天内进程内哈希稳定，跨天自动轮换。
 *
 * 设计权衡（FP-05 §5）：
 *   - MVP 阶段不需要真正的轮换盐共享存储（Redis）；
 *   - 单实例内日级盐稳定 → 限流配额按天累计正确；
 *   - 跨实例盐可能不同 → 同一 IP 在不同实例计数独立（与多实例限流语义一致）。
 *   - 进程重启后盐变化 → 已计数被丢弃（接受，限流本就是基础防护）。
 */
function getDailySalt(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

/** 同源校验：Origin 必须与 Host 同源（FP-05 §5：同源/CSRF） */
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  const host = req.headers.get('host')
  if (!origin || !host) {
    // 同源请求可能不带 Origin（如直接 POST）；缺 Origin 时放行，依赖其他校验
    return true
  }
  try {
    const url = new URL(origin)
    return url.host === host
  } catch {
    return false
  }
}

/** Content-Type 校验：必须为 application/json（FP-05 §5） */
function isJsonContentType(req: Request): boolean {
  const ct = req.headers.get('content-type') ?? ''
  return ct.toLowerCase().startsWith('application/json')
}

type TargetResolution = 'listing' | 'building' | 'general'

type ExistingInquiryResolution = Readonly<{
  found: boolean
  targetResolution: TargetResolution
}>

async function findExistingInquiryResolution(
  payload: Payload,
  idempotencyKey: string,
): Promise<ExistingInquiryResolution> {
  const existing = await payload.find({
    collection: 'leads',
    where: { idempotencyKey: { equals: idempotencyKey } },
    limit: 1,
    depth: 0,
  })
  if (existing.docs.length === 0) {
    return { found: false, targetResolution: 'general' }
  }
  const existingTarget = existing.docs[0]?.targetType
  return {
    found: true,
    targetResolution:
      existingTarget === 'listing'
        ? 'listing'
        : existingTarget === 'building'
          ? 'building'
          : 'general',
  }
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error
  for (let depth = 0; depth < 5 && candidate && typeof candidate === 'object'; depth += 1) {
    const record = candidate as Record<string, unknown>
    const marker = [record.constraint, record.detail, record.message]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
      .toLowerCase()
    if (
      record.code === '23505' &&
      (marker.includes('leads_idempotency_key_idx') || marker.includes('idempotency_key'))
    ) {
      return true
    }
    candidate = record.cause
  }
  return false
}

function populatedBuildingSlug(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const slug = (value as Record<string, unknown>).slug
  return typeof slug === 'string' && slug.length > 0 ? slug : null
}

async function findOwningBuildingSlug(payload: Payload, listingSlug: string): Promise<string | null> {
  const result = await payload.find({
    collection: 'listings',
    where: { slug: { equals: listingSlug } },
    select: { building: true },
    limit: 1,
    depth: 1,
    overrideAccess: true,
  })
  return populatedBuildingSlug(result.docs[0]?.building)
}

function logIdempotentSuccess(
  payload: Payload,
  inquiry: InquiryRequest,
  startedAt: number,
  targetResolution: TargetResolution,
): Response {
  payload.logger.info(
    buildInquiryLogEntry(inquiry, {
      idempotent: true,
      errorCode: null,
      durationMs: Date.now() - startedAt,
      targetResolution,
    }),
    'inquiry_idempotent_hit',
  )
  return NextResponse.json({ ok: true, targetResolution })
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now()
  const ip = clientIp(req)
  // 限流键使用带日级盐的哈希：存储中不保留原始 IP（FP-05 §5）。
  // dailySalt 在进程内计算（UTC 日期字符串），跨天自动轮换。
  const rateKey = hashIpForLog(ip, getDailySalt())

  // ----- 1. 限流（OPT-017 分布式，FP-05 §5、§6） -----
  // 提前 init payload 拿 PG pool；getPayload 单例，后续调用廉价。
  const payload = await getPayload({ config })
  const pgDeps = createPgRateLimitDeps(
    (payload.db as unknown as { pool: PoolLike }).pool,
  )
  const rate = await runDistributedRateLimit(
    pgDeps,
    RATE_LIMIT_CONFIG,
    rateKey,
    ratePruneRef,
  )
  if (rate.failedOpen) {
    // 存储不可用已 fail-open 放行：记告警，依赖下游幂等键 + schema 兜底
    payload.logger.warn({ rateKey }, 'rate_limit_store_unavailable_fail_open')
  }
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    )
  }

  // ----- 2. 同源 / Content-Type / body 大小校验（FP-05 §5） -----
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }
  if (!isJsonContentType(req)) {
    return NextResponse.json(
      { ok: false, errors: ['invalid_content_type'] },
      { status: 415 },
    )
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, errors: ['body_too_large'] },
      { status: 413 },
    )
  }

  // ----- 3. 解析 body（视为 unknown，由 schema 收窄） -----
  let body: unknown
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, errors: ['body_too_large'] },
        { status: 413 },
      )
    }
    body = raw === '' ? null : JSON.parse(raw)
  } catch {
    return NextResponse.json(
      { ok: false, errors: ['invalid_json'] },
      { status: 400 },
    )
  }

  // ----- 4. schema 白名单校验（domain/inquiry/schema.ts） -----
  const result = validateInquiry(body)
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, errors: result.errors },
      { status: 422 },
    )
  }
  const inquiry: InquiryRequest = result.data

  // ----- 4b. 偏好看房时段服务端复核（P2 Task 4） -----
  // 用户可选时段；若提交了时段，用平台服务时间在提交瞬间复核有效性
  //（过期/非服务时段/非 30 分边界/非 2 小时 -> 422），防止前端陈旧时段绕过。
  let viewingPreferenceToPersist:
    | { startsAt: string; endsAt: string; timezone: string; status: 'pending-confirmation' }
    | null = null
  if (inquiry.viewingPreference) {
    try {
      const scheduleDoc = await payload.findGlobal({
        slug: 'advisor-service-hours',
        depth: 0,
        overrideAccess: true,
      })
      const schedule = mapGlobalToSchedule(scheduleDoc as unknown as Record<string, unknown>)
      const check = validateViewingPreference(
        inquiry.viewingPreference,
        schedule,
        new Date().toISOString(),
      )
      if (!check.ok) {
        return NextResponse.json({ ok: false, errors: [check.error] }, { status: 422 })
      }
      viewingPreferenceToPersist = {
        ...inquiry.viewingPreference,
        status: 'pending-confirmation',
      }
    } catch {
      // global 不可用：不阻断询盘主流程，仅丢弃时段（询盘仍可提交）
      viewingPreferenceToPersist = null
    }
  }

  // ----- 5. 计算幂等键（domain/inquiry/idempotency.ts） -----
  const targetSlug = deriveTargetSlug(
    inquiry.targetType,
    inquiry.listingSlug,
    inquiry.buildingSlug,
  )
  const idempotencyKey = await computeIdempotencyKey(
    inquiry.requestId,
    inquiry.phoneNormalized,
    inquiry.targetType,
    targetSlug,
  )

  // 注：payload 已在限流块（第 1 步）初始化，此处复用同一实例。
  // getPayload 是单例，重复调用廉价，但避免重复声明以保持作用域清晰。

  // ----- 6. 幂等检查：同键已存在 Lead → 返回首次成功语义（FP-05 §5） -----
  try {
    const existing = await findExistingInquiryResolution(payload, idempotencyKey)
    if (existing.found) {
      return logIdempotentSuccess(payload, inquiry, startedAt, existing.targetResolution)
    }
  } catch (e) {
    payload.logger.error({ err: e }, 'inquiry_idempotency_check_failed')
    // 幂等检查失败时继续创建：最坏情况下重复 Lead，但避免阻塞用户
  }

  // ----- 7. 目标有效性复核（同一 ctx；listing → building → general） -----
  const ctx = createSearchContext(siteConfig.defaultCity)
  const listing = inquiry.listingSlug
    ? await assertEffectiveListing(inquiry.listingSlug, ctx)
    : null
  let building = null
  if (!listing && inquiry.buildingSlug) {
    if (inquiry.listingSlug) {
      // 房源失效时客户端 buildingSlug 不可信：只允许降级到该房源真实所属楼盘。
      let owningBuildingSlug: string | null = null
      try {
        owningBuildingSlug = await findOwningBuildingSlug(payload, inquiry.listingSlug)
      } catch {
        payload.logger.warn('inquiry_listing_building_resolution_failed')
      }
      if (owningBuildingSlug === inquiry.buildingSlug) {
        building = await assertEffectiveBuilding(owningBuildingSlug, ctx)
      }
    } else {
      // 直接楼盘咨询没有房源归属可比对，仍按统一有效楼盘服务复核。
      building = await assertEffectiveBuilding(inquiry.buildingSlug, ctx)
    }
  }
  const targetResolution = listing ? 'listing' : building ? 'building' : 'general'

  // ----- 8. 创建 Lead（含完整询盘上下文） -----
  try {
    await payload.create({
      collection: 'leads',
      data: {
        // entrust 渠道无姓名：传 undefined，交给 fillEntrustLeadName 兜底。
        // Payload 的静态生成类型无法表示 beforeValidate 会补齐 required 字段。
        name: (inquiry.name || undefined) as string,
        phone: inquiry.phone,
        company: inquiry.company ?? undefined,
        status: 'new',
        source: 'frontend-form',
        // 租赁需求（demand）
        budget: inquiry.demand.budget ?? undefined,
        area: inquiry.demand.area ?? undefined,
        moveInTime: inquiry.demand.moveInTime ?? undefined,
        // 意向房源（仅有效供给时关联）
        interestedListing: listing?.id,
        // 留言（与跟进记录区分：留言进 notes，跟进记录由经纪人后续填写）
        notes: inquiry.message ?? undefined,
        // 前台询盘上下文（FP-05 §5 / §8）
        idempotencyKey,
        sourcePageType: inquiry.source.pageType,
        sourcePath: inquiry.source.path,
        sourceUrl: `${siteConfig.siteOrigin}${inquiry.source.path}`,
        targetType: targetResolution === 'general' ? 'none' : targetResolution,
        targetListingSlug: targetResolution === 'listing' ? inquiry.listingSlug : null,
        targetBuildingSlug: targetResolution === 'building' ? building?.slug ?? null : null,
        sourceSection: inquiry.source.section,
        activeSupplyGroup: inquiry.activeSupplyGroup,
        currentFilters: inquiry.source.currentFilters,
        priceSnapshot: inquiry.priceSnapshot,
        priceSnapshotSubmittedAt: inquiry.priceSnapshot ? new Date().toISOString() : null,
        consentAccepted: inquiry.consent.accepted,
        consentPolicyVersion: inquiry.consent.policyVersion,
        campaign: inquiry.source.campaign,
        requestId: inquiry.requestId,
        // P2 Task 4：偏好看房时段（已服务端复核，恒 pending-confirmation）
        viewingPreference: viewingPreferenceToPersist ?? undefined,
      },
    })

    payload.logger.info(
      buildInquiryLogEntry(inquiry, {
        idempotent: false,
        errorCode: null,
        durationMs: Date.now() - startedAt,
        targetResolution,
      }),
      'inquiry_success',
    )
    // 不暴露 Lead ID（FP-05 §7）
    return NextResponse.json({ ok: true, targetResolution })
  } catch (e) {
    if (isIdempotencyUniqueViolation(e)) {
      try {
        const raced = await findExistingInquiryResolution(payload, idempotencyKey)
        if (raced.found) {
          return logIdempotentSuccess(payload, inquiry, startedAt, raced.targetResolution)
        }
      } catch (readError) {
        payload.logger.error({ err: readError }, 'inquiry_idempotency_race_read_failed')
      }
    }
    payload.logger.error({ err: e }, 'inquiry_create_failed')
    payload.logger.info(
      buildInquiryLogEntry(inquiry, {
        idempotent: false,
        errorCode: 'server_error',
        durationMs: Date.now() - startedAt,
        targetResolution,
      }),
      'inquiry_error',
    )
    return NextResponse.json(
      { ok: false, error: 'server_error' },
      { status: 500 },
    )
  }
}

/** 其他方法禁止 */
export function GET(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    {
      status: 405,
      headers: { Allow: 'POST' },
    },
  )
}

export function PUT(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    {
      status: 405,
      headers: { Allow: 'POST' },
    },
  )
}

export function DELETE(): Response {
  return NextResponse.json(
    { ok: false, error: 'method_not_allowed' },
    {
      status: 405,
      headers: { Allow: 'POST' },
    },
  )
}
