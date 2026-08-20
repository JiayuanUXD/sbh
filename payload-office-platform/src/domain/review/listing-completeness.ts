/**
 * 房源完整度与草稿校验纯函数（tasks.md M4.3 / design §3.4 listings / R4）
 *
 * 两级门槛：
 *   - draft  草稿保存：最小字段校验（标题 / 楼盘 / 房源类型），随写随存。
 *   - submit 提交审核：完整字段 + 结构化价格 + 至少 3 张图片 + 有效商户关系。
 *
 * 返回完整度分数（满足必填项占比）与缺失项定位（field + 中文标签 + 原因），
 * 供后台表单实时高亮缺失项、提交审核前拦截（tasks.md「展示完整度和缺失项定位」）。
 *
 * 无 payload / React 依赖,可独立单测。判定「是否有有效商户关系」「有效媒体数」
 * 由调用方(protect hook / endpoint)解析关联后以快照传入,本模块不读库。
 */

import {
  PRICING_PERIODS,
  PRICING_UNITS,
  isValidMoney,
  isValidSqmArea,
} from '@/domain/shared/money'
import {
  isBusinessType,
  isDecorationStatus,
  isPropertyRightYears,
} from '@/domain/review/listing-fields'

/**
 * 提交审核要求的最少有效图片数。
 *
 * 2026-08-19 起这是媒体数量**唯一**的一道门：前台可见性不再看图片数
 * （见 `effective-supply.ts` 头部），已上架媒体地板 `violatesPublishedMediaFloor`
 * 也随之删除——它存在的唯一理由是「防止删图导致前台静默下架」，前台门槛没了，
 * 这条拦截就成了无来由的硬报错。
 *
 * 保留这一道的意思是：**走审核队列的房源**（商户提交）仍需 3 张图。管理员保存即
 * 发布不过完整度门（`admin-auto-publish.ts`），所以管理员照样能发 0 图房源。
 */
export const MIN_SUBMIT_MEDIA = 3

// 计价周期 / 单位的合法值从 money.ts 引入（见顶部 import），不在此重写副本：
// 这里曾是一份手抄的 ['month','day','year']，缺 'one-time'，会让出售价格即使录进
// 库也被判为无效价格、卡在上架校验门口。

/** 校验模式。 */
export type CompletenessMode = 'draft' | 'submit'

/** 结构化价格快照(对应 Listings.ts price group)。 */
export interface PriceSnapshot {
  amount?: number
  currency?: string
  period?: string
  unit?: string
}

/**
 * 完整度校验入参：房源已解析字段快照。
 * 关联型判定(商户关系有效 / 有效媒体数)由调用方解析后传入布尔/计数,本模块只做纯校验。
 */
export interface ListingCompletenessSnapshot {
  title?: unknown
  slug?: unknown
  listingType?: unknown
  building?: unknown
  businessType?: unknown
  decorationStatus?: unknown
  price?: PriceSnapshot
  area?: unknown
  floor?: unknown
  minimumLeaseMonths?: unknown
  paymentTerms?: unknown
  availableFrom?: unknown
  /** 产权年限（出售专属，纯展示，不做折损计算）。 */
  propertyRightYears?: unknown
  description?: unknown
  contactBroker?: unknown
  /** 有效图集图片数(调用方解析 gallery 后传入)。 */
  galleryCount?: number
  /** 是否已选供给商户。OPT-034 起 `listings.merchant` 即唯一真相，不再是近似。 */
  hasValidMerchantRelation?: boolean
}

/** 单个缺失项定位。 */
export interface MissingItem {
  /** 字段键(对应后台表单字段,供前端定位高亮)。 */
  field: string
  /** 中文标签。 */
  label: string
  /** 缺失/不合格原因。 */
  reason: string
}

export interface CompletenessResult {
  mode: CompletenessMode
  /** 是否满足该模式全部必填项。 */
  complete: boolean
  /** 完整度分数 0–100(满足必填项 / 总必填项 * 100,四舍五入)。 */
  score: number
  /** 缺失/不合格项定位列表。 */
  missing: MissingItem[]
}

/** 草稿最小必填字段键。 */
export const DRAFT_REQUIRED_FIELDS = ['title', 'building', 'listingType'] as const

/** 租售共有的提交审核必填字段键。 */
const SUBMIT_REQUIRED_COMMON = [
  'title',
  'building',
  'listingType',
  'businessType',
  'decorationStatus',
  'price',
  'area',
  'floor',
  'description',
  'contactBroker',
  'gallery',
  'merchant',
] as const

/**
 * 租赁专属必填。
 *
 * 出售房源天然不满足这三条：买卖没有租期概念、付款方式在合同阶段谈、交割日不是
 * 入驻日。此前它们混在统一清单里，会让每一套出售房源都卡在「提交审核」按钮上，
 * 报错说缺最短租期——功能看似做完了，实际一套都上不了架。
 */
const SUBMIT_REQUIRED_LEASE_ONLY = [
  'minimumLeaseMonths',
  'paymentTerms',
  'availableFrom',
] as const

/** 出售专属必填。产权年限为纯展示字段，但买家必看，故进硬校验。 */
const SUBMIT_REQUIRED_SALE_ONLY = ['propertyRightYears'] as const

/**
 * 提交审核完整必填字段键(草稿超集)。
 *
 * @deprecated 保留以兼容既有引用，等价于租赁口径。新代码用
 *   `getSubmitRequiredFields(businessType)`，否则出售房源会被租赁专属字段拦住。
 */
export const SUBMIT_REQUIRED_FIELDS = [
  ...SUBMIT_REQUIRED_COMMON,
  ...SUBMIT_REQUIRED_LEASE_ONLY,
] as const

/** 按租售类型返回提交审核必填字段。businessType 非法或缺失时按租赁口径（保守）。 */
export function getSubmitRequiredFields(businessType: unknown): readonly string[] {
  return businessType === 'sale'
    ? [...SUBMIT_REQUIRED_COMMON, ...SUBMIT_REQUIRED_SALE_ONLY]
    : [...SUBMIT_REQUIRED_COMMON, ...SUBMIT_REQUIRED_LEASE_ONLY]
}

const FIELD_LABELS: Record<string, string> = {
  title: '房源标题',
  building: '所属楼盘',
  listingType: '房源类型',
  businessType: '租售类型',
  decorationStatus: '装修状态',
  price: '价格',
  area: '面积',
  floor: '楼层',
  minimumLeaseMonths: '最短租期',
  paymentTerms: '付款方式',
  availableFrom: '可入驻时间',
  propertyRightYears: '产权年限',
  description: '房源描述',
  contactBroker: '联系经纪人',
  gallery: '房源图集',
  merchant: '供给商户',
}

/** 非空字符串。 */
function isNonEmptyString(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/** 关系型 id 存在(number 或非空字符串)。 */
function hasRelation(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v)
  return isNonEmptyString(v)
}

/** 正整数/正数。 */
function isPositiveNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/** 价格快照是否为合法结构化价格(金额 > 0 + 合法币种/周期/单位)。 */
function isValidPriceSnapshot(p: PriceSnapshot | undefined): boolean {
  if (!p || typeof p !== 'object') return false
  if (typeof p.amount !== 'number' || !isPositiveNumber(p.amount)) return false
  if (!(PRICING_PERIODS as readonly string[]).includes(String(p.period))) return false
  if (!(PRICING_UNITS as readonly string[]).includes(String(p.unit))) return false
  // 复用 money 校验金额精度(≤2 位小数、非负、有限)
  return isValidMoney({
    amount: p.amount,
    currency: 'CNY',
    period: p.period as 'month',
    unit: p.unit as 'sqm',
  })
}

/**
 * 校验房源完整度。draft 只查最小字段;submit 查完整字段 + 价格 + 图片 + 商户。
 */
export function checkListingCompleteness(
  snapshot: ListingCompletenessSnapshot,
  mode: CompletenessMode,
): CompletenessResult {
  const required: readonly string[] =
    mode === 'draft' ? DRAFT_REQUIRED_FIELDS : getSubmitRequiredFields(snapshot.businessType)
  const missing: MissingItem[] = []

  const fail = (field: string, reason: string) => {
    missing.push({ field, label: FIELD_LABELS[field] ?? field, reason })
  }

  for (const field of required) {
    switch (field) {
      case 'title':
        if (!isNonEmptyString(snapshot.title)) fail('title', '请填写房源标题')
        break
      case 'building':
        if (!hasRelation(snapshot.building)) fail('building', '请选择所属楼盘')
        break
      case 'listingType':
        if (!isNonEmptyString(snapshot.listingType)) fail('listingType', '请选择房源类型')
        break
      case 'businessType':
        if (!isBusinessType(snapshot.businessType)) fail('businessType', '请选择租售类型')
        break
      case 'decorationStatus':
        if (!isDecorationStatus(snapshot.decorationStatus))
          fail('decorationStatus', '请选择装修状态')
        break
      case 'price':
        if (!isValidPriceSnapshot(snapshot.price))
          fail('price', '请填写有效价格(金额、计价周期与单位)')
        break
      case 'area':
        if (!isPositiveNumber(snapshot.area) || !isValidSqmArea(snapshot.area as number))
          fail('area', '请填写有效面积(平方米,支持一位小数)')
        break
      case 'floor':
        if (!isNonEmptyString(snapshot.floor)) fail('floor', '请填写楼层')
        break
      case 'minimumLeaseMonths':
        if (!isPositiveNumber(snapshot.minimumLeaseMonths))
          fail('minimumLeaseMonths', '请填写最短租期(月)')
        break
      case 'paymentTerms':
        if (!isNonEmptyString(snapshot.paymentTerms)) fail('paymentTerms', '请填写付款方式')
        break
      case 'availableFrom':
        if (!isNonEmptyString(snapshot.availableFrom)) fail('availableFrom', '请选择可入驻时间')
        break
      case 'propertyRightYears':
        if (!isPropertyRightYears(snapshot.propertyRightYears))
          fail('propertyRightYears', '请选择产权年限')
        break
      case 'description':
        if (snapshot.description === undefined || snapshot.description === null)
          fail('description', '请填写房源描述')
        break
      case 'contactBroker':
        if (!hasRelation(snapshot.contactBroker)) fail('contactBroker', '请选择联系经纪人')
        break
      case 'gallery':
        if ((snapshot.galleryCount ?? 0) < MIN_SUBMIT_MEDIA)
          fail('gallery', `提交审核要求至少 ${MIN_SUBMIT_MEDIA} 张有效图片`)
        break
      case 'merchant':
        if (snapshot.hasValidMerchantRelation !== true)
          fail('merchant', '请选择供给商户')
        break
    }
  }

  const total = required.length
  const satisfied = total - missing.length
  // total 恒 ≥ DRAFT_REQUIRED_FIELDS.length(3),无需防除零。
  const score = Math.round((satisfied / total) * 100)

  return { mode, complete: missing.length === 0, score, missing }
}
