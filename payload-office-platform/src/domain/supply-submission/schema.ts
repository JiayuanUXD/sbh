/**
 * 投放房源提交 schema 校验与白名单收窄
 *
 * 设计依据：docs/superpowers/specs/2026-08-09-entrust-supply-pages-prd.md §5.2 / §5.3 / §5.5
 *
 * 守护不变量：
 *   - 输入视为 unknown，白名单收窄后才落库；
 *   - 必填：buildingName (1-100)、address (1-200)、areaSqm (>0)、contactPhone (中国大陆 11 位)、
 *     consent.accepted=true、consent.policyVersion 与当前版本一致、source.path、requestId；
 *   - 选填：rentAmount (≥0) / rentUnit (PRICE_UNITS 枚举) / commissionMonths（缺省 none）；
 *   - 后台字段与流程字段（status/assignee/matchedBuilding/reviewNote/...）一律不接收；
 *   - source.path 只接受同源 pathname；query/hash 剥离，绝对 URL、协议相对 URL、控制字符被拒；
 *   - 错误返回稳定安全错误码字符串数组（不抛异常、不泄露内部对象）。
 *
 * 不依赖 payload / React，纯函数可独立单测。
 */

import { isValidCnMobile, normalizePhone } from '@/domain/shared/phone'
import { PRICE_UNITS, type InquiryPriceUnit } from '@/domain/inquiry/schema'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

/** 佣金悬赏（单位：月租金）。存枚举而非浮点数，避免"0 与未填"歧义。 */
export const COMMISSION_MONTHS = ['none', '0.5', '1', '1.5', '2'] as const
export type CommissionMonths = (typeof COMMISSION_MONTHS)[number]

export const COMMISSION_MONTHS_LABELS: Record<CommissionMonths, string> = {
  none: '无',
  '0.5': '0.5个月',
  '1': '1个月',
  '1.5': '1.5个月',
  '2': '2个月',
}

/** 提交人身份（后台补录，前台不采集） */
export const SUBMITTER_ROLES = ['owner', 'property', 'agency', 'operator'] as const
export type SubmitterRole = (typeof SUBMITTER_ROLES)[number]

export const SUBMITTER_ROLE_LABELS: Record<SubmitterRole, string> = {
  owner: '业主',
  property: '物业方',
  agency: '中介',
  operator: '联合办公运营方',
}

/** 出租方式（后台补录，前台不采集） */
export const LEASE_MODES = ['whole-floor', 'office', 'seat', 'sale'] as const
export type LeaseMode = (typeof LEASE_MODES)[number]

export const LEASE_MODE_LABELS: Record<LeaseMode, string> = {
  'whole-floor': '整层',
  office: '独立办公室',
  seat: '工位',
  sale: '出售',
}

/** 装修状况（后台补录，前台不采集） */
export const FITOUT_STATUSES = ['bare', 'simple', 'full', 'furnished'] as const
export type FitoutStatus = (typeof FITOUT_STATUSES)[number]

export const FITOUT_STATUS_LABELS: Record<FitoutStatus, string> = {
  bare: '毛坯',
  simple: '简装',
  full: '精装',
  furnished: '带家具',
}

/** 审单流程状态 */
export const SUPPLY_SUBMISSION_STATUSES = [
  'pending',
  'contacted',
  'converted',
  'rejected',
  'duplicate',
] as const
export type SupplySubmissionStatus = (typeof SUPPLY_SUBMISSION_STATUSES)[number]

export const SUPPLY_SUBMISSION_STATUS_LABELS: Record<SupplySubmissionStatus, string> = {
  pending: '待处理',
  contacted: '已联系',
  converted: '已转房源',
  rejected: '已拒绝',
  duplicate: '重复',
}

/** 字段限制 */
export const SUPPLY_LIMITS = {
  BUILDING_NAME_MAX: 100,
  ADDRESS_MAX: 200,
  REQUEST_ID_MAX: 100,
  SOURCE_PATH_MAX: 300,
  /** 单个物业可租面积上限（㎡）：只限制外部输入幅度，非业务上限 */
  AREA_MAX: 1_000_000,
  /** 报价上限：同上，仅防异常数值 */
  RENT_MAX: 10_000_000,
} as const

/** 校验通过后的投放房源请求 */
export type SupplySubmissionRequest = Readonly<{
  requestId: string
  buildingName: string
  address: string
  areaSqm: number
  rentAmount: number | null
  rentUnit: InquiryPriceUnit | null
  commissionMonths: CommissionMonths
  contactPhone: string
  phoneNormalized: string
  consent: Readonly<{ accepted: true; policyVersion: string }>
  source: Readonly<{ path: string }>
}>

export type SupplyValidationResult =
  | { ok: true; data: SupplySubmissionRequest }
  | { ok: false; errors: readonly string[] }

/**
 * 校验并标准化投放房源请求体（unknown 输入）。
 *
 * 错误码：
 *   - invalid_body
 *   - request_id_required / request_id_too_long
 *   - building_name_required / building_name_too_long
 *   - address_required / address_too_long
 *   - area_required / area_invalid
 *   - rent_amount_invalid / rent_unit_invalid
 *   - commission_invalid
 *   - phone_invalid
 *   - consent_required / consent_version_mismatch
 *   - source_required / source_path_required / source_path_too_long / source_path_invalid
 */
export function validateSupplySubmission(input: unknown): SupplyValidationResult {
  if (!isObject(input)) {
    return { ok: false, errors: ['invalid_body'] }
  }

  const errors: string[] = []

  const requestId = trimString(input.requestId)
  if (!requestId) errors.push('request_id_required')
  else if (requestId.length > SUPPLY_LIMITS.REQUEST_ID_MAX) errors.push('request_id_too_long')

  const buildingName = trimString(input.buildingName)
  if (!buildingName) errors.push('building_name_required')
  else if (buildingName.length > SUPPLY_LIMITS.BUILDING_NAME_MAX) {
    errors.push('building_name_too_long')
  }

  const address = trimString(input.address)
  if (!address) errors.push('address_required')
  else if (address.length > SUPPLY_LIMITS.ADDRESS_MAX) errors.push('address_too_long')

  // 面积：必填正数
  const areaSqm = toFiniteNumber(input.areaSqm)
  if (input.areaSqm === undefined || input.areaSqm === null || input.areaSqm === '') {
    errors.push('area_required')
  } else if (areaSqm === null || areaSqm <= 0 || areaSqm > SUPPLY_LIMITS.AREA_MAX) {
    errors.push('area_invalid')
  }

  // 租金：选填，给了金额就必须给合法单位
  let rentAmount: number | null = null
  let rentUnit: InquiryPriceUnit | null = null
  const hasRentAmount =
    input.rentAmount !== undefined && input.rentAmount !== null && input.rentAmount !== ''
  if (hasRentAmount) {
    const parsed = toFiniteNumber(input.rentAmount)
    if (parsed === null || parsed < 0 || parsed > SUPPLY_LIMITS.RENT_MAX) {
      errors.push('rent_amount_invalid')
    } else {
      rentAmount = parsed
    }
  }
  const rentUnitRaw = trimString(input.rentUnit)
  if (rentUnitRaw) {
    if (!isPriceUnit(rentUnitRaw)) errors.push('rent_unit_invalid')
    else rentUnit = rentUnitRaw
  } else if (rentAmount !== null) {
    // 有金额无单位：默认元/㎡/天（与表单默认选项一致）
    rentUnit = 'rmb-sqm-day'
  }

  // 佣金：选填，缺省 none
  const commissionRaw = trimString(input.commissionMonths)
  let commissionMonths: CommissionMonths = 'none'
  if (commissionRaw) {
    if (!isCommissionMonths(commissionRaw)) errors.push('commission_invalid')
    else commissionMonths = commissionRaw
  }

  const contactPhoneRaw = trimString(input.contactPhone)
  const phoneNormalized = contactPhoneRaw ? normalizePhone(contactPhoneRaw) : ''
  if (!phoneNormalized || !isValidCnMobile(phoneNormalized)) {
    errors.push('phone_invalid')
  }

  // 隐私同意（前台为"提交即授权"隐式形态，仍必须留痕政策版本）
  if (!isObject(input.consent)) {
    errors.push('consent_required')
  } else {
    if (input.consent.accepted !== true) errors.push('consent_required')
    const version = trimString(input.consent.policyVersion)
    if (!version) errors.push('consent_required')
    else if (version !== PRIVACY_POLICY_VERSION) errors.push('consent_version_mismatch')
  }

  // 来源路径
  let sourcePath = ''
  if (!isObject(input.source)) {
    errors.push('source_required')
  } else {
    const rawPath = trimString(input.source.path)
    if (!rawPath) errors.push('source_path_required')
    else if (rawPath.length > SUPPLY_LIMITS.SOURCE_PATH_MAX) errors.push('source_path_too_long')
    else {
      const normalized = normalizeSamePath(rawPath)
      if (!normalized) errors.push('source_path_invalid')
      else sourcePath = normalized
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    data: {
      requestId,
      buildingName,
      address,
      areaSqm: areaSqm as number,
      rentAmount,
      rentUnit,
      commissionMonths,
      contactPhone: contactPhoneRaw,
      phoneNormalized,
      consent: { accepted: true, policyVersion: PRIVACY_POLICY_VERSION },
      source: { path: sourcePath },
    },
  }
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

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function isPriceUnit(v: string): v is InquiryPriceUnit {
  return (PRICE_UNITS as readonly string[]).includes(v)
}

function isCommissionMonths(v: string): v is CommissionMonths {
  return (COMMISSION_MONTHS as readonly string[]).includes(v)
}

/**
 * 归一化同源路径：必须以单个 '/' 开头，剥离 query/hash，拒绝控制字符与
 * 协议相对 URL（'//host'）。不合法返回 null。
 */
function normalizeSamePath(raw: string): string | null {
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  // eslint-disable-next-line no-control-regex
  if (/[ -]/.test(raw)) return null
  const withoutHash = raw.split('#')[0] ?? ''
  const pathname = withoutHash.split('?')[0] ?? ''
  if (!pathname.startsWith('/')) return null
  return pathname
}
