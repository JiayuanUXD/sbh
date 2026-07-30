/**
 * F5 询盘隐私安全日志
 *
 * 设计依据：specs/frontend-mvp/design.md §12.2、FP-05 §5 / §8 / §9
 *
 * 守护不变量：
 *   - 服务日志、客户端监控、分析事件不记录完整姓名、手机号、留言正文或原始 IP
 *   - 手机号默认脱敏（138****1111），完整手机号需独立权限
 *   - URL 中的查询参数个人信息（如utm_content中可能含手机号）在日志前清洗
 *   - 安全错误码字符串数组对外暴露，不泄露内部对象
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { createHash } from 'node:crypto'
import { maskPhone } from '@/domain/shared/phone'
import type { InquiryRequest } from './schema'

/**
 * 询盘安全日志条目（可安全写入 payload.logger / 控制台 / 监控）
 *
 * 不含：完整姓名、完整手机号、留言正文、原始 URL 查询参数。
 */
export type InquiryLogEntry = Readonly<{
  /** 前台生成的请求 ID，用于关联前端埋点 */
  requestId: string
  /** 入口页面类型 */
  pageType: string
  /** 入口路径（已白名单化，不含查询参数） */
  path: string
  /** 目标类型 */
  targetType: string
  /** 目标 slug（房源或楼盘 slug） */
  targetSlug: string | null
  /** 脱敏手机号（138****1111） */
  phoneMasked: string
  /** 隐私政策版本 */
  consentPolicyVersion: string
  /** 是否命中幂等（重复请求） */
  idempotent: boolean
  /** 字段完整度枚举（不含字段值） */
  fieldCompleteness: FieldCompleteness
  /** 活动归因键集合（不含值，仅用于分析） */
  campaignKeys: readonly string[]
  /** 安全错误码（成功时为 null） */
  errorCode: string | null
  /** 处理耗时（毫秒） */
  durationMs: number
  /** 是否携带非权威价格快照（不记录金额、周期或单位）。 */
  hasPriceSnapshot: boolean
  /** 详情页入口区块（仅白名单枚举）。 */
  section: string | null
  /** 最终服务端复核后的目标归属。 */
  targetResolution: 'listing' | 'building' | 'general'
}>

/** 字段完整度枚举（FP-05 §8 埋点：inquiry_submit 字段完整度枚举） */
export const FIELD_COMPLETENESS = {
  /** 仅必填 */
  REQUIRED_ONLY: 'required_only',
  /** 必填 + 公司 */
  WITH_COMPANY: 'with_company',
  /** 必填 + 留言 */
  WITH_MESSAGE: 'with_message',
  /** 必填 + 公司 + 留言 */
  WITH_COMPANY_AND_MESSAGE: 'with_company_and_message',
  /** 必填 + 需求 */
  WITH_DEMAND: 'with_demand',
  /** 完整（必填 + 公司 + 留言 + 需求） */
  FULL: 'full',
} as const
export type FieldCompleteness = (typeof FIELD_COMPLETENESS)[keyof typeof FIELD_COMPLETENESS]

/**
 * 从 InquiryRequest 派生字段完整度枚举（不暴露字段值）。
 */
export function deriveFieldCompleteness(req: InquiryRequest): FieldCompleteness {
  const hasCompany = req.company != null && req.company.length > 0
  const hasMessage = req.message != null && req.message.length > 0
  const hasDemand =
    req.demand.district != null ||
    req.demand.budget != null ||
    req.demand.area != null ||
    req.demand.moveInTime != null

  if (hasCompany && hasMessage && hasDemand) return FIELD_COMPLETENESS.FULL
  if (hasDemand) return FIELD_COMPLETENESS.WITH_DEMAND
  if (hasCompany && hasMessage) return FIELD_COMPLETENESS.WITH_COMPANY_AND_MESSAGE
  if (hasMessage) return FIELD_COMPLETENESS.WITH_MESSAGE
  if (hasCompany) return FIELD_COMPLETENESS.WITH_COMPANY
  return FIELD_COMPLETENESS.REQUIRED_ONLY
}

/**
 * 构造安全日志条目（不含个人信息）。
 *
 * @param req 询盘请求
 * @param idempotent 是否命中幂等（重复请求返回首次成功语义）
 * @param errorCode 安全错误码（成功时传 null）
 * @param durationMs 处理耗时（毫秒）
 */
export function buildInquiryLogEntry(
  req: InquiryRequest,
  opts: Readonly<{
    idempotent: boolean
    errorCode: string | null
    durationMs: number
    targetResolution?: 'listing' | 'building' | 'general'
  }>,
): InquiryLogEntry {
  const targetSlug = deriveTargetSlugForLog(req)
  return {
    requestId: req.requestId,
    pageType: req.source.pageType,
    path: req.source.path,
    targetType: req.targetType,
    targetSlug,
    phoneMasked: maskPhone(req.phoneNormalized),
    consentPolicyVersion: req.consent.policyVersion,
    idempotent: opts.idempotent,
    fieldCompleteness: deriveFieldCompleteness(req),
    campaignKeys: Object.keys(req.source.campaign).filter(
      (k) => req.source.campaign[k as keyof typeof req.source.campaign].length > 0,
    ),
    errorCode: opts.errorCode,
    durationMs: opts.durationMs,
    hasPriceSnapshot: req.priceSnapshot !== null,
    section: req.source.section,
    targetResolution: opts.targetResolution ?? targetResolutionOf(req.targetType),
  }
}

function targetResolutionOf(targetType: InquiryRequest['targetType']): 'listing' | 'building' | 'general' {
  if (targetType === 'listing') return 'listing'
  if (targetType === 'building') return 'building'
  return 'general'
}

function deriveTargetSlugForLog(req: InquiryRequest): string | null {
  if (req.targetType === 'listing') return req.listingSlug
  if (req.targetType === 'building') return req.buildingSlug
  return null
}

/**
 * 清洗 URL：移除查询参数，仅保留 path（避免 URL 中可能的个人信息进入日志）。
 *
 * 不变量：
 *   - URL 构造失败或解析出空 pathname → 返回 [invalid-url] 占位符（不泄露原值）
 *   - 仅返回 pathname，剥离 query 与 hash 中的潜在个人信息
 */
export function sanitizeUrlForLog(url: string): string {
  try {
    const u = new URL(url, 'http://placeholder.local')
    // Node URL 对部分输入宽松解析（如 'not-a-url-but-not-parseable-://'），
    // 返回空 pathname 时也视作非法，避免在日志中输出空字符串造成混淆。
    const pathname = u.pathname
    if (!pathname || pathname === '/') {
      // '/' 占位符视为相对路径根，合法；真正的空 pathname 才视作非法
      if (!pathname) return '[invalid-url]'
    }
    return pathname
  } catch {
    return '[invalid-url]'
  }
}

/**
 * 清洗 IP：返回带轮换盐的哈希（不保存原始 IP）。
 *
 * 注意：MVP 阶段不实现真正的轮换盐（需要共享存储），仅返回 hash。
 * 后续接入 Redis 等共享存储后，再添加每日轮换盐。
 *
 * @param ip 原始 IP
 * @param salt 当日盐值（建议从环境变量派生）
 */
export function hashIpForLog(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}|${ip}`, 'utf8').digest('hex').slice(0, 32)
}
