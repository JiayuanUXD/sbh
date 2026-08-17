/**
 * URL → ListingSearchInput 规范化解析器
 *
 * 设计依据：specs/frontend-mvp/design.md §7.1、§15.1
 *
 * 守护不变量：
 *   - 输入视为 unknown，对每个字段做白名单校验；
 *   - 数组字段长度上限 20，避免 where in 注入过宽；
 *   - 数值边界：rentMin/Max ≥ 0、areaMin/Max ≥ 0、page ≥ 1；
 *   - 日期字符串校验 ISO 格式；
 *   - 枚举（listingType / rentUnit / sort）严格白名单；
 *   - 非法参数静默降级为安全默认值（不抛错），由 canonical URL 生成器对外规范化。
 *   - 价格排序（rent-asc/rent-desc）必须配合 rentUnit，否则降级为 recommended。
 *
 * 兼容：保留对旧 `district`（string）的解析以兼容现网 URL，但内部统一存数组。
 */

import type { PriceDisplayUnit } from './contracts'
import type {
  ListingSearchInput,
  ListingSort,
  PriceBasis,
  PricePeriod,
  RentUnit,
} from './types'
import type { BuildingSupplyInput } from './building-supply'

const DEFAULT_PAGE_SIZE = 24 as const
const MAX_ARRAY_LEN = 20
const MAX_Q_LEN = 100

const LISTING_TYPE_WHITELIST = new Set<string>([
  'traditional-office',
  'serviced-office',
  'coworking',
  'full-floor',
])

const RENT_UNIT_WHITELIST = new Set<string>([
  'rmb-sqm-day',
  'rmb-month',
  'rmb-seat-month',
])

const SORT_WHITELIST = new Set<string>([
  'recommended',
  'rent-asc',
  'rent-desc',
  'newest',
])

const BUILDING_SUPPLY_GROUPS = new Set(['lease', 'sale', 'coworking'])
const BUILDING_SUPPLY_DECORATION_STATUSES = new Set(['rough', 'simple', 'furnished', 'fully_fitted'])
/**
 * 楼盘详情页价格单位筛选白名单。
 *
 * 必须覆盖 `PriceDisplayUnit` 全集：楼盘页按 displayUnit 分组展示供给，白名单漏掉
 * 某个单位就意味着那组价格「看得见但筛不着」。此前只有 4 个值，因为当时 mapper 把
 * 12 种 (period, basis) 组合压进 4 个 displayUnit（`rmb-total` 是兜底桶）；兜底桶
 * 消除后，白名单必须跟着补齐。下方断言保证两侧不会再漂移。
 */
const BUILDING_SUPPLY_PRICE_UNIT_VALUES = [
  'rmb-sqm-day',
  'rmb-sqm-month',
  'rmb-sqm-year',
  'rmb-sqm-total',
  'rmb-seat-day',
  'rmb-seat-month',
  'rmb-seat-year',
  'rmb-seat-total',
  'rmb-day',
  'rmb-month',
  'rmb-year',
  'rmb-total',
] as const

/** 编译期断言：T 必须为 never，差集会显示在错误信息里。 */
type AssertNever<T extends never> = T
/** 白名单漏了 PriceDisplayUnit 有的取值 → 此处报错 */
type _NoMissingSupplyPriceUnit = AssertNever<
  Exclude<PriceDisplayUnit, (typeof BUILDING_SUPPLY_PRICE_UNIT_VALUES)[number]>
>
/** 白名单多了 PriceDisplayUnit 没有的取值 → 此处报错 */
type _NoExtraSupplyPriceUnit = AssertNever<
  Exclude<(typeof BUILDING_SUPPLY_PRICE_UNIT_VALUES)[number], PriceDisplayUnit>
>

const BUILDING_SUPPLY_PRICE_UNITS = new Set<string>(BUILDING_SUPPLY_PRICE_UNIT_VALUES)
const BUILDING_SUPPLY_SORTS = new Set(['recommended', 'area-asc', 'area-desc', 'price-asc', 'price-desc'])

const LEGACY_RENT_UNIT_PRICE_KEY: Readonly<Record<RentUnit, Readonly<{
  period: PricePeriod
  basis: PriceBasis
}>>> = {
  'rmb-sqm-day': { period: 'day', basis: 'sqm' },
  'rmb-month': { period: 'month', basis: 'total' },
  'rmb-seat-month': { period: 'month', basis: 'seat' },
}

/** 将旧 URL rentUnit 转换为结构化价格周期和计价基础。 */
export function legacyRentUnitToPriceKey(
  rentUnit: RentUnit | undefined,
): Readonly<{ period: PricePeriod; basis: PriceBasis }> | undefined {
  return rentUnit ? LEGACY_RENT_UNIT_PRICE_KEY[rentUnit] : undefined
}

/**
 * 解析单个查询参数为字符串数组
 *
 * 支持两种形态：
 *   - `?district=jingan` → ['jingan']
 *   - `?district=jingan&district=xuhui` → ['jingan', 'xuhui']
 */
function parseStringArray(sp: URLSearchParams, key: string): readonly string[] | undefined {
  const vals = sp.getAll(key).filter((v) => typeof v === 'string' && v.length > 0)
  if (vals.length === 0) return undefined
  // 长度上限保护：超出截断，保留前 N 个
  return vals.slice(0, MAX_ARRAY_LEN)
}

function parseIntInRange(
  sp: URLSearchParams,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const raw = sp.get(key)
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  // 整数化（不接受小数页码或面积）
  const i = Math.trunc(n)
  if (i < min || i > max) return undefined
  return i
}

function parseDate(sp: URLSearchParams, key: string): string | undefined {
  const raw = sp.get(key)
  if (raw == null || raw === '') return undefined
  // 简单 ISO 日期校验：YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return undefined
  const [, y, mo, d] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  if (month < 1 || month > 12) return undefined
  if (day < 1 || day > 31) return undefined
  // 构造 Date 校验真实日期
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return undefined
  }
  return raw
}

function parseEnum<T extends string>(
  sp: URLSearchParams,
  key: string,
  whitelist: Set<string>,
): T | undefined {
  const raw = sp.get(key)
  if (raw == null || raw === '') return undefined
  return whitelist.has(raw) ? (raw as T) : undefined
}

function parseWhitelistedArray(
  sp: URLSearchParams,
  key: string,
  whitelist: Set<string>,
): readonly string[] | undefined {
  const vals = sp.getAll(key).filter((v) => whitelist.has(v))
  if (vals.length === 0) return undefined
  return vals.slice(0, MAX_ARRAY_LEN)
}

function parseQ(sp: URLSearchParams): string | undefined {
  const raw = sp.get('q')
  if (raw == null) return undefined
  // 截断超长关键词，避免 where 注入
  const trimmed = raw.trim().slice(0, MAX_Q_LEN)
  return trimmed.length > 0 ? trimmed : undefined
}

function parsePage(sp: URLSearchParams): number {
  const n = parseIntInRange(sp, 'page', 1, 10000)
  return n ?? 1
}

function normalizeSort(
  sort: ListingSort | undefined,
  rentUnit: RentUnit | undefined,
): ListingSort {
  // 价格排序必须配合 rentUnit，否则降级为 recommended
  if (sort === 'rent-asc' || sort === 'rent-desc') {
    if (!rentUnit) return 'recommended'
  }
  return sort ?? 'recommended'
}

type SearchParamsRecord = Readonly<Record<string, string | readonly string[] | undefined>>

function isSearchParamsRecord(value: unknown): value is SearchParamsRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Returns a parameter only when it is exactly one string value. */
function readSingleSearchParam(value: unknown, key: string): string | undefined {
  if (value instanceof URLSearchParams) {
    const values = value.getAll(key)
    return values.length === 1 ? values[0] : undefined
  }
  if (!isSearchParamsRecord(value)) return undefined
  const raw = value[key]
  return typeof raw === 'string' ? raw : undefined
}

function parseBuildingSupplyNumber(value: unknown, key: string): number | undefined {
  const raw = readSingleSearchParam(value, key)
  if (!raw || raw.trim() !== raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function parseBuildingSupplyEnum<T extends string>(
  value: unknown,
  key: string,
  whitelist: ReadonlySet<string>,
): T | undefined {
  const raw = readSingleSearchParam(value, key)
  return raw && whitelist.has(raw) ? raw as T : undefined
}

function parseBuildingSupplyDate(value: unknown, key: string): string | undefined {
  const raw = readSingleSearchParam(value, key)
  if (!raw) return undefined
  const params = new URLSearchParams([[key, raw]])
  return parseDate(params, key)
}

/**
 * Strictly narrows Next searchParams or URLSearchParams into a supply input.
 * Invalid individual values are dropped; a reversed area range drops both.
 */
export function parseBuildingSupplySearchParams(value: unknown): BuildingSupplyInput {
  let areaMin = parseBuildingSupplyNumber(value, 'areaMin')
  let areaMax = parseBuildingSupplyNumber(value, 'areaMax')
  if (areaMin != null && areaMax != null && areaMin > areaMax) {
    areaMin = undefined
    areaMax = undefined
  }

  const group = parseBuildingSupplyEnum<NonNullable<BuildingSupplyInput['group']>>(
    value,
    'group',
    BUILDING_SUPPLY_GROUPS,
  )
  const decorationStatus = parseBuildingSupplyEnum<string>(
    value,
    'decorationStatus',
    BUILDING_SUPPLY_DECORATION_STATUSES,
  )
  const priceUnit = parseBuildingSupplyEnum<NonNullable<BuildingSupplyInput['priceUnit']>>(
    value,
    'priceUnit',
    BUILDING_SUPPLY_PRICE_UNITS,
  )
  const sort = parseBuildingSupplyEnum<NonNullable<BuildingSupplyInput['sort']>>(
    value,
    'sort',
    BUILDING_SUPPLY_SORTS,
  )
  const availableBefore = parseBuildingSupplyDate(value, 'availableBefore')

  return {
    ...(group ? { group } : {}),
    ...(areaMin != null ? { areaMin } : {}),
    ...(areaMax != null ? { areaMax } : {}),
    ...(decorationStatus ? { decorationStatus } : {}),
    ...(availableBefore ? { availableBefore } : {}),
    ...(priceUnit ? { priceUnit } : {}),
    ...(sort ? { sort } : {}),
  }
}

/**
 * 把 URLSearchParams 解析为安全的 ListingSearchInput
 *
 * 非法参数静默丢弃；调用方应通过 buildCanonicalUrl 再生成规范化 URL。
 */
export function parseListingSearchInput(sp: URLSearchParams): ListingSearchInput {
  const listingType = parseWhitelistedArray(sp, 'type', LISTING_TYPE_WHITELIST)
  const district = parseStringArray(sp, 'district')
  const businessArea = parseStringArray(sp, 'businessArea')
  const metro = parseStringArray(sp, 'metro')
  const rentUnit = parseEnum<RentUnit>(sp, 'rentUnit', RENT_UNIT_WHITELIST)
  const priceKey = legacyRentUnitToPriceKey(rentUnit)
  const sortRaw = parseEnum<ListingSort>(sp, 'sort', SORT_WHITELIST)
  const sort = normalizeSort(sortRaw, rentUnit)
  const areaMin = parseIntInRange(sp, 'areaMin', 0, 1_000_000)
  const areaMax = parseIntInRange(sp, 'areaMax', 0, 1_000_000)
  const rentMin = parseIntInRange(sp, 'rentMin', 0, Number.MAX_SAFE_INTEGER)
  const rentMax = parseIntInRange(sp, 'rentMax', 0, Number.MAX_SAFE_INTEGER)
  const availableBefore = parseDate(sp, 'availableBefore')
  const q = parseQ(sp)
  const city = sp.get('city') || undefined
  const page = parsePage(sp)

  return {
    city,
    district,
    businessArea,
    metro,
    listingType,
    areaMin,
    areaMax,
    rentMin,
    rentMax,
    rentUnit,
    pricePeriod: priceKey?.period,
    priceBasis: priceKey?.basis,
    availableBefore,
    q,
    sort,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  }
}

/**
 * 把 ListingSearchInput 反向序列化为规范化 URLSearchParams
 *
 * 用于：
 *   - 生成 canonical URL（design.md §11）；
 *   - 在搜索页头部「已选条件」中生成可分享链接；
 *   - 在 sitemap 中输出规范化查询。
 *
 * 字段顺序固定，便于 hash 与比较。
 */
export function buildCanonicalSearchParams(input: ListingSearchInput): URLSearchParams {
  const sp = new URLSearchParams()
  if (input.city) sp.set('city', input.city)
  if (input.district) for (const v of input.district) sp.append('district', v)
  if (input.businessArea) for (const v of input.businessArea) sp.append('businessArea', v)
  if (input.metro) for (const v of input.metro) sp.append('metro', v)
  if (input.listingType) for (const v of input.listingType) sp.append('type', v)
  if (input.areaMin != null) sp.set('areaMin', String(input.areaMin))
  if (input.areaMax != null) sp.set('areaMax', String(input.areaMax))
  if (input.rentMin != null) sp.set('rentMin', String(input.rentMin))
  if (input.rentMax != null) sp.set('rentMax', String(input.rentMax))
  if (input.rentUnit) sp.set('rentUnit', input.rentUnit)
  if (input.availableBefore) sp.set('availableBefore', input.availableBefore)
  if (input.q) sp.set('q', input.q)
  if (input.sort && input.sort !== 'recommended') sp.set('sort', input.sort)
  if (input.page > 1) sp.set('page', String(input.page))
  return sp
}
