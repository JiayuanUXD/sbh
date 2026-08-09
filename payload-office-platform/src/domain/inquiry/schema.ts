/**
 * F5 询盘 schema 校验与白名单收窄
 *
 * 设计依据：specs/frontend-mvp/design.md §10.1 / §10.2、FP-05 §3 / §5 / §6
 *
 * 守护不变量：
 *   - 输入视为 unknown，schema 白名单收窄后才落库
 *   - 必填：phone (中国大陆 11 位), consent.accepted=true, consent.policyVersion, source.pageType, source.path, requestId；name (1-50) 除 pageType='entrust' 外必填
 *   - 选填：company (≤100), message (≤1000), listingSlug, buildingSlug, demand.{district,budget,area,moveInTime}, source.campaign
 *   - target_type 由 listingSlug / buildingSlug 派生，至少需要一个或 targetType=none
 *   - source.path 只接受同源 pathname；query/hash 被剥离，绝对 URL、协议相对 URL 与控制字符被拒绝
 *   - 错误返回稳定安全错误码字符串数组（不抛 JS 异常、不泄露内部对象）
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { normalizePhone, isValidCnMobile } from '@/domain/shared/phone'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'
import { sanitizeCampaign, type CampaignAttribution } from './campaign'

/** 入口页面类型（与 Leads Collection INQUIRY_SOURCE_PAGE_TYPES 对齐） */
export const SOURCE_PAGE_TYPES = ['home', 'search', 'listing', 'building', 'content', 'entrust'] as const
export type SourcePageType = (typeof SOURCE_PAGE_TYPES)[number]

/** 详情页询盘入口区块；只保留可分析的产品枚举。 */
export const SOURCE_SECTIONS = [
  'hero',
  'sticky-card',
  'mobile-bar',
  'supply-lease',
  'supply-sale',
  'supply-coworking',
  'recommendation',
] as const
export type SourceSection = (typeof SOURCE_SECTIONS)[number]

/** 楼盘详情供给分组，与 Public Catalog DTO 保持一致。 */
export const SUPPLY_GROUPS = ['lease', 'sale', 'coworking'] as const
export type InquirySupplyGroup = (typeof SUPPLY_GROUPS)[number]

/** 公开价格展示单位；询盘只接受该有限枚举，绝不接收自由文本。 */
export const PRICE_UNITS = [
  'rmb-sqm-day',
  'rmb-month',
  'rmb-seat-month',
  'rmb-total',
] as const
export type InquiryPriceUnit = (typeof PRICE_UNITS)[number]

/**
 * 非权威询盘价格快照的绝对上限（CNY）。
 *
 * 此值只限制外部输入的存储幅度，避免异常数值占用日志、JSON 或后续人工处理路径；
 * 不表示公开价格的业务上限。
 */
export const MAX_INQUIRY_PRICE_SNAPSHOT_AMOUNT = 1_000_000_000_000

export type InquiryPriceSnapshot = Readonly<{
  amount: number
  currency: 'CNY'
  period: 'day' | 'month' | 'year' | 'one-time'
  unit: InquiryPriceUnit
}>

export type InquiryCurrentFilters = Readonly<{
  group?: InquirySupplyGroup
  priceUnit?: InquiryPriceUnit
}>

/** 目标对象类型（与 Leads Collection INQUIRY_TARGET_TYPES 对齐） */
export const TARGET_TYPES = ['listing', 'building', 'none'] as const
export type TargetType = (typeof TARGET_TYPES)[number]

/** 字段长度限制（FP-05 §3） */
export const LIMITS = {
  NAME_MAX: 50,
  COMPANY_MAX: 100,
  MESSAGE_MAX: 1000,
  PATH_MAX: 500,
  URL_MAX: 2048,
  REQUEST_ID_MAX: 100,
  CAMPAIGN_VALUE_MAX: 100,
} as const

/**
 * 标准化后的询盘请求（与 design.md §10.1 InquiryRequest 对齐）
 * 所有字段在 schema 校验通过后保证类型与长度。
 */
export type InquiryRequest = Readonly<{
  requestId: string
  name: string
  phone: string
  phoneNormalized: string
  company: string | null
  message: string | null
  listingSlug: string | null
  buildingSlug: string | null
  targetType: TargetType
  demand: Readonly<{
    district: string | null
    budget: string | null
    area: string | null
    moveInTime: string | null
  }>
  consent: Readonly<{
    accepted: true
    policyVersion: string
  }>
  source: Readonly<{
    pageType: SourcePageType
    path: string
    section: SourceSection | null
    currentFilters: InquiryCurrentFilters | null
    campaign: Readonly<CampaignAttribution>
  }>
  priceSnapshot: InquiryPriceSnapshot | null
  activeSupplyGroup: InquirySupplyGroup | null
  /** P2：偏好看房时段（待顾问确认）；形状校验在此，服务时段有效性在路由复核 */
  viewingPreference: Readonly<{
    startsAt: string
    endsAt: string
    timezone: string
  }> | null
}>

export type ValidationResult =
  | { ok: true; data: InquiryRequest }
  | { ok: false; errors: readonly string[] }

export type SourcePathResult =
  | { ok: true; data: string }
  | {
      ok: false
      error: 'source_path_required' | 'source_path_too_long' | 'source_path_invalid'
    }

/**
 * 校验并标准化询盘请求体（unknown 输入）。
 *
 * 错误码：
 *   - name_required / name_too_long
 *   - phone_invalid
 *   - company_too_long
 *   - message_too_long
 *   - consent_required / consent_version_invalid
 *   - source_required / source_invalid / source_page_type_invalid / source_path_required / source_path_too_long / source_path_invalid
 *   - request_id_required / request_id_too_long
 *   - target_invalid（listing/building slug 都缺失但 targetType 非 none）
 *   - campaign_invalid / price_snapshot_invalid / active_supply_group_invalid
 */
export function validateInquiry(input: unknown): ValidationResult {
  if (!isObject(input)) {
    return { ok: false, errors: ['invalid_body'] }
  }

  const errors: string[] = []

  // ----- 必填字段 -----
  // 委托找房落地页（source.pageType='entrust'）首屏只采集手机号，没有姓名输入框；
  // 该渠道允许省略姓名，落库时由 Leads 的 fillEntrustLeadName hook 兜底填充。
  // 不放宽 Leads.name 的 required，后台视图依赖它非空。
  const entrustChannel =
    isObject(input.source) && trimString(input.source.pageType) === 'entrust'

  const name = trimString(input.name)
  if (!name && !entrustChannel) errors.push('name_required')
  else if (name.length > LIMITS.NAME_MAX) errors.push('name_too_long')

  const phoneRaw = trimString(input.phone)
  const phoneNormalized = phoneRaw ? normalizePhone(phoneRaw) : ''
  if (!phoneNormalized || !isValidCnMobile(phoneNormalized)) {
    errors.push('phone_invalid')
  }

  const requestId = trimString(input.requestId)
  if (!requestId) errors.push('request_id_required')
  else if (requestId.length > LIMITS.REQUEST_ID_MAX) errors.push('request_id_too_long')

  // ----- 选填字段 -----
  const company = trimString(input.company) || null
  if (company && company.length > LIMITS.COMPANY_MAX) errors.push('company_too_long')

  const message = trimString(input.message) || null
  if (message && message.length > LIMITS.MESSAGE_MAX) errors.push('message_too_long')

  const listingSlug = trimString(input.listingSlug) || null
  const buildingSlug = trimString(input.buildingSlug) || null

  // ----- consent -----
  const consentRaw = input.consent
  if (!isObject(consentRaw)) {
    errors.push('consent_required')
  } else {
    if (consentRaw.accepted !== true) {
      errors.push('consent_required')
    }
    const policyVersion = trimString(consentRaw.policyVersion)
    if (!policyVersion) {
      errors.push('consent_version_invalid')
    } else if (policyVersion !== PRIVACY_POLICY_VERSION) {
      // 版本不匹配：可能是过期表单或攻击者伪造
      errors.push('consent_version_invalid')
    }
  }

  // ----- source -----
  const sourceRaw = input.source
  let section: SourceSection | null = null
  let currentFilters: InquiryCurrentFilters | null = null
  let sourcePath = ''
  if (!isObject(sourceRaw)) {
    errors.push('source_required')
    errors.push('source_path_required')
  } else {
    const sourceKeys = Object.keys(sourceRaw)
    if (
      sourceKeys.some(
        (key) => key !== 'pageType' && key !== 'path' && key !== 'section' && key !== 'currentFilters' && key !== 'campaign',
      )
    ) {
      errors.push('source_invalid')
    }
    const pageType = trimString(sourceRaw.pageType)
    if (!pageType || !isSourcePageType(pageType)) {
      errors.push('source_page_type_invalid')
    }
    const pathResult = normalizeSourcePath(sourceRaw.path)
    if (!pathResult.ok) errors.push(pathResult.error)
    else sourcePath = pathResult.data
    const sectionResult = sanitizeSourceSection(sourceRaw.section)
    if (!sectionResult.ok) errors.push('source_section_invalid')
    else section = sectionResult.data

    const filtersResult = sanitizeCurrentFilters(sourceRaw.currentFilters)
    if (!filtersResult.ok) errors.push('source_filters_invalid')
    else currentFilters = filtersResult.data
    // campaign 白名单化（无效时不阻断，但记错误码）
    const campaignResult = sanitizeCampaign(sourceRaw.campaign)
    if (!campaignResult.ok) {
      errors.push('campaign_invalid')
    }
  }

  // ----- target_type 派生 -----
  // listing 与 building slug 至少有一个；都没有 → targetType=none（通用需求）
  // 同时有 → 优先 listing（API 路由会调用 assertEffectiveListing 复核房源有效性）
  const targetType: TargetType = listingSlug ? 'listing' : buildingSlug ? 'building' : 'none'

  // ----- demand（选填，仅白名单字段） -----
  const demandRaw = isObject(input.demand) ? input.demand : {}
  const demand = {
    district: trimString(demandRaw.district) || null,
    budget: trimString(demandRaw.budget) || null,
    area: trimString(demandRaw.area) || null,
    moveInTime: trimString(demandRaw.moveInTime) || null,
  }

  const priceSnapshotResult = sanitizePriceSnapshot(input.priceSnapshot)
  if (!priceSnapshotResult.ok) errors.push('price_snapshot_invalid')

  const activeSupplyGroupResult = sanitizeSupplyGroup(input.activeSupplyGroup)
  if (!activeSupplyGroupResult.ok) errors.push('active_supply_group_invalid')

  // ----- viewingPreference（选填；仅形状校验，服务时段有效性由路由复核） -----
  const viewingPreferenceResult = sanitizeViewingPreference(input.viewingPreference)
  if (!viewingPreferenceResult.ok) errors.push('viewing_preference_invalid')

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  // 此时 consent 与 source 已校验通过，但 TS 无法推断，需断言
  const consent = input.consent as { accepted: true; policyVersion: string }
  const source = input.source as { pageType: SourcePageType; campaign?: unknown }
  const campaign = sanitizeCampaign(source.campaign)
  if (!campaign.ok) {
    // 理论上前面已拦截，兜底
    return { ok: false, errors: ['campaign_invalid'] }
  }

  // trim 后的 pageType 与归一化 pathname 写回数据
  const trimmedPageType = trimString(source.pageType) as SourcePageType
  const priceSnapshot = priceSnapshotResult.ok ? priceSnapshotResult.data : null
  const activeSupplyGroup = activeSupplyGroupResult.ok ? activeSupplyGroupResult.data : null
  const viewingPreference = viewingPreferenceResult.ok ? viewingPreferenceResult.data : null

  return {
    ok: true,
    data: {
      requestId,
      name,
      phone: phoneNormalized,
      phoneNormalized,
      company,
      message,
      listingSlug,
      buildingSlug,
      targetType,
      demand,
      consent: {
        accepted: true,
        policyVersion: consent.policyVersion,
      },
      source: {
        pageType: trimmedPageType,
        path: sourcePath,
        section,
        currentFilters,
        campaign: campaign.data,
      },
      priceSnapshot,
      activeSupplyGroup,
      viewingPreference,
    },
  }
}

/**
 * 形状校验偏好看房时段：startsAt/endsAt 为合法 ISO、timezone 非空字符串。
 * 不校验服务时段有效性（由路由用 AdvisorServiceHours 复核）。
 * 缺省（未选时段）返回 { ok:true, data:null }。
 */
function sanitizeViewingPreference(
  value: unknown,
): { ok: true; data: { startsAt: string; endsAt: string; timezone: string } | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, data: null }
  if (!isObject(value)) return { ok: false }
  const startsAt = value.startsAt
  const endsAt = value.endsAt
  const timezone = value.timezone
  if (typeof startsAt !== 'string' || typeof endsAt !== 'string' || typeof timezone !== 'string') {
    return { ok: false }
  }
  if (timezone.length === 0 || timezone.length > 64) return { ok: false }
  const startMs = Date.parse(startsAt)
  const endMs = Date.parse(endsAt)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return { ok: false }
  if (endMs <= startMs) return { ok: false }
  return { ok: true, data: { startsAt, endsAt, timezone } }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function trimString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function isSourcePageType(v: string): v is SourcePageType {
  return (SOURCE_PAGE_TYPES as readonly string[]).includes(v)
}

/**
 * 把外部来源路径收窄为可持久化、可日志化的 same-origin pathname。
 *
 * query/hash 可能被恶意塞入手机号等 PII，因此合法相对 URL 只保留 pathname；
 * 绝对/协议相对 URL、反斜线与原始/百分号编码控制字符全部拒绝。
 */
export function normalizeSourcePath(value: unknown): SourcePathResult {
  if (typeof value !== 'string') return { ok: false, error: 'source_path_required' }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return { ok: false, error: 'source_path_invalid' }
  }
  const raw = value.trim()
  if (!raw) return { ok: false, error: 'source_path_required' }
  if (raw.length > LIMITS.PATH_MAX) return { ok: false, error: 'source_path_too_long' }
  if (
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(raw)
  ) {
    return { ok: false, error: 'source_path_invalid' }
  }

  try {
    const parsed = new URL(raw, 'http://source-path.local')
    if (parsed.origin !== 'http://source-path.local' || !parsed.pathname.startsWith('/')) {
      return { ok: false, error: 'source_path_invalid' }
    }
    return { ok: true, data: parsed.pathname }
  } catch {
    return { ok: false, error: 'source_path_invalid' }
  }
}

function sanitizeSourceSection(value: unknown): { ok: true; data: SourceSection | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, data: null }
  const section = trimString(value)
  if (!section || !(SOURCE_SECTIONS as readonly string[]).includes(section)) return { ok: false }
  return { ok: true, data: section as SourceSection }
}

function sanitizeSupplyGroup(value: unknown): { ok: true; data: InquirySupplyGroup | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, data: null }
  const group = trimString(value)
  if (!group || !(SUPPLY_GROUPS as readonly string[]).includes(group)) return { ok: false }
  return { ok: true, data: group as InquirySupplyGroup }
}

function sanitizeCurrentFilters(value: unknown): { ok: true; data: InquiryCurrentFilters | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, data: null }
  if (!isObject(value)) return { ok: false }
  const keys = Object.keys(value)
  if (keys.some((key) => key !== 'group' && key !== 'priceUnit')) return { ok: false }

  const group = sanitizeSupplyGroup(value.group)
  if (!group.ok) return { ok: false }
  const priceUnit = sanitizePriceUnit(value.priceUnit)
  if (!priceUnit.ok) return { ok: false }
  if (group.data === null && priceUnit.data === null) return { ok: true, data: null }

  return {
    ok: true,
    data: {
      ...(group.data ? { group: group.data } : {}),
      ...(priceUnit.data ? { priceUnit: priceUnit.data } : {}),
    },
  }
}

function sanitizePriceUnit(value: unknown): { ok: true; data: InquiryPriceUnit | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, data: null }
  const unit = trimString(value)
  if (!unit || !(PRICE_UNITS as readonly string[]).includes(unit)) return { ok: false }
  return { ok: true, data: unit as InquiryPriceUnit }
}

function sanitizePriceSnapshot(value: unknown): { ok: true; data: InquiryPriceSnapshot | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, data: null }
  if (!isObject(value)) return { ok: false }
  const keys = Object.keys(value)
  if (keys.some((key) => key !== 'amount' && key !== 'currency' && key !== 'period' && key !== 'unit')) {
    return { ok: false }
  }
  const amount = value.amount
  const period = trimString(value.period)
  const unit = sanitizePriceUnit(value.unit)
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > MAX_INQUIRY_PRICE_SNAPSHOT_AMOUNT ||
    value.currency !== 'CNY' ||
    !(['day', 'month', 'year', 'one-time'] as const).includes(period as InquiryPriceSnapshot['period']) ||
    !unit.ok ||
    unit.data === null
  ) {
    return { ok: false }
  }
  return {
    ok: true,
    data: { amount, currency: 'CNY', period: period as InquiryPriceSnapshot['period'], unit: unit.data },
  }
}
