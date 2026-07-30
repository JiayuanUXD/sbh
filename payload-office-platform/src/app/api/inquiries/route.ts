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

import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import {
  assertEffectiveBuilding,
  assertEffectiveListing,
  defaultSearchContext,
} from '@/domain/public-catalog'
import {
  buildInquiryLogEntry,
  computeIdempotencyKey,
  deriveTargetSlug,
  hashIpForLog,
  validateInquiry,
  type InquiryRequest,
} from '@/domain/inquiry'
import { runDistributedRateLimit, type PruneTimestampRef } from '@/lib/rate-limit-distributed'
import { createPgRateLimitDeps, type PoolLike } from '@/lib/rate-limit-pg'
import { INQUIRY_RATE_LIMIT_CONFIG as RATE_LIMIT_CONFIG } from '@/lib/rate-limit-config'
import { siteConfig } from '@/lib/frontend/site-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 每请求 body 最大字节数（FP-05 §5：校验 body 大小） */
const MAX_BODY_BYTES = 16 * 1024

/**
 * IP 哈希存储：日志中不记录完整 IP（FP-05 §5），
 * 限流键使用 hashIpForLog(ip, dailySalt) 派生，避免原始 IP 进入存储或日志。
 * 限流配置（windowMs/max/maxKeys/pruneIntervalMs/failOpen）见 @/lib/rate-limit-config。
 */

/**
 * 跨请求共享的 TTL 清理时间戳（模块级）。
 * CloudRun 多实例各自维护清理周期，但 inquiry_rate_limit 表共享，任一实例清理都生效。
 */
const ratePruneRef: PruneTimestampRef = { value: 0 }

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
    const existing = await payload.find({
      collection: 'leads',
      where: { idempotencyKey: { equals: idempotencyKey } },
      limit: 1,
      depth: 0,
    })
    if (existing.docs.length > 0) {
      const existingTarget = (existing.docs[0] as { targetType?: unknown }).targetType
      const targetResolution =
        existingTarget === 'listing'
          ? 'listing'
          : existingTarget === 'building'
            ? 'building'
            : 'general'
      // 幂等命中：返回与首次相同成功语义，不暴露 Lead ID
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
  } catch (e) {
    payload.logger.error({ err: e }, 'inquiry_idempotency_check_failed')
    // 幂等检查失败时继续创建：最坏情况下重复 Lead，但避免阻塞用户
  }

  // ----- 7. 目标有效性复核（同一 ctx；listing → building → general） -----
  const ctx = defaultSearchContext()
  const listing = inquiry.listingSlug
    ? await assertEffectiveListing(inquiry.listingSlug, ctx)
    : null
  const building = !listing && inquiry.buildingSlug
    ? await assertEffectiveBuilding(inquiry.buildingSlug, ctx)
    : null
  const targetResolution = listing ? 'listing' : building ? 'building' : 'general'

  // ----- 8. 创建 Lead（含完整询盘上下文） -----
  try {
    await payload.create({
      collection: 'leads',
      data: {
        name: inquiry.name,
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
        targetBuildingSlug: targetResolution === 'building' ? inquiry.buildingSlug : null,
        sourceSection: inquiry.source.section,
        activeSupplyGroup: inquiry.activeSupplyGroup,
        currentFilters: inquiry.source.currentFilters,
        priceSnapshot: inquiry.priceSnapshot,
        priceSnapshotSubmittedAt: inquiry.priceSnapshot ? new Date().toISOString() : null,
        consentAccepted: inquiry.consent.accepted,
        consentPolicyVersion: inquiry.consent.policyVersion,
        campaign: inquiry.source.campaign,
        requestId: inquiry.requestId,
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

/**
 * 测试专用：重置模块级限流清理时间戳。
 *
 * OPT-017 后限流改为 PG 分布式（runDistributedRateLimit + inquiry_rate_limit 表），
 * 限流配额本身由 PG 表持有，测试间通过 mock createPgRateLimitDeps 注入内存实现重置；
 * 但跨请求共享的 ratePruneRef 仍是模块级引用，需此函数在 beforeEach 重置为 0，
 * 让首个请求的 TTL 清理逻辑按"从未清理过"运行，避免上一测试的清理时间戳影响下一测试。
 * 生产代码不调用此函数。
 */
export function __resetRateStoreForTests(): void {
  ratePruneRef.value = 0
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
