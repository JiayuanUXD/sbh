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

/**
 * 旧 URL 的 rentUnit 白名单（3 个租赁单位）。
 *
 * 保留只为兼容已收录的链接。新参数 priceUnit 用下方 12 值全集。
 */
const RENT_UNIT_WHITELIST = new Set<string>([
  'rmb-sqm-day',
  'rmb-month',
  'rmb-seat-month',
])

/**
 * 排序白名单。
 *
 * 同时接受新旧两套价格排序值：rent-asc / rent-desc 是已被收录的旧值，
 * 解析后统一归一到 price-asc / price-desc，canonical 只输出新值。
 */
const SORT_WHITELIST = new Set<string>([
  'recommended',
  'price-asc',
  'price-desc',
  'rent-asc',
  'rent-desc',
  'newest',
])

/**
 * 房源列表的默认排序：解析层缺省值，也是 canonical **不写入 URL** 的那一个值。
 *
 * 导出而不是写成字面量，是给视图层用的：`ResultToolbar` 构造排序 href 时必须
 * 知道「哪个值是默认」才能与 canonical 同口径地把它从 URL 里删掉。之前那里硬编码
 * `recommended`，楼盘页默认是 `stock-desc`，于是点已经选中的「在租最多」会得到
 * 一个非 canonical 的 `?sort=stock-desc`（OPT-036 终审 M3）。
 */
export const LISTING_DEFAULT_SORT: ListingSort = 'recommended'

/** 旧排序值 → 新排序值。解析层归一，让下游只认一套。 */
const LEGACY_SORT_ALIASES: Readonly<Record<string, ListingSort>> = {
  'rent-asc': 'price-asc',
  'rent-desc': 'price-desc',
}

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

/** priceUnit 白名单：与楼盘页共用同一份 PriceDisplayUnit 全集。 */
const PRICE_UNIT_WHITELIST = BUILDING_SUPPLY_PRICE_UNITS

/**
 * priceUnit → 结构化价格键。
 *
 * 是 mapper 里 (period, basis) → displayUnit 的逆映射。写成显式表而非解析字符串，
 * 因为命名规则有例外（basis=total 时省略 basis 段），字符串拆分会在 rmb-month
 * 这类值上出错。Record 类型保证 12 个值一个不漏。
 */
const PRICE_UNIT_KEY: Readonly<Record<PriceDisplayUnit, Readonly<{
  period: PricePeriod
  basis: PriceBasis
}>>> = {
  'rmb-sqm-day': { period: 'day', basis: 'sqm' },
  'rmb-sqm-month': { period: 'month', basis: 'sqm' },
  'rmb-sqm-year': { period: 'year', basis: 'sqm' },
  'rmb-sqm-total': { period: 'one-time', basis: 'sqm' },
  'rmb-seat-day': { period: 'day', basis: 'seat' },
  'rmb-seat-month': { period: 'month', basis: 'seat' },
  'rmb-seat-year': { period: 'year', basis: 'seat' },
  'rmb-seat-total': { period: 'one-time', basis: 'seat' },
  'rmb-day': { period: 'day', basis: 'total' },
  'rmb-month': { period: 'month', basis: 'total' },
  'rmb-year': { period: 'year', basis: 'total' },
  'rmb-total': { period: 'one-time', basis: 'total' },
}

/** 将 priceUnit 转换为结构化价格周期和计价基础。 */
export function priceUnitToPriceKey(
  priceUnit: PriceDisplayUnit | undefined,
): Readonly<{ period: PricePeriod; basis: PriceBasis }> | undefined {
  return priceUnit ? PRICE_UNIT_KEY[priceUnit] : undefined
}
const BUILDING_SUPPLY_SORTS = new Set(['recommended', 'area-asc', 'area-desc', 'price-asc', 'price-desc'])

/**
 * 将旧 URL rentUnit 转换为结构化价格周期和计价基础。
 *
 * @deprecated 用 `priceUnitToPriceKey`。旧 rentUnit 的三个取值都是合法的
 *   PriceDisplayUnit，直接复用同一张表，不再维护第二份映射。
 */
export function legacyRentUnitToPriceKey(
  rentUnit: RentUnit | undefined,
): Readonly<{ period: PricePeriod; basis: PriceBasis }> | undefined {
  return priceUnitToPriceKey(rentUnit)
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

/**
 * 归一排序值并做安全降级。
 *
 * 价格排序必须配合计价单位：「元/㎡/天」与「元/月」不可比，出售的总价与单价同样
 * 不可比。没有单位就降级为 recommended，而不是给出一个跨单位的错误排序。
 */
function normalizeSort(
  sort: ListingSort | undefined,
  priceUnit: PriceDisplayUnit | undefined,
): ListingSort {
  if (sort === 'price-asc' || sort === 'price-desc') {
    if (!priceUnit) return LISTING_DEFAULT_SORT
  }
  return sort ?? LISTING_DEFAULT_SORT
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

  let priceMin = parseBuildingSupplyNumber(value, 'priceMin')
  let priceMax = parseBuildingSupplyNumber(value, 'priceMax')
  if (priceMin != null && priceMax != null && priceMin > priceMax) {
    priceMin = undefined
    priceMax = undefined
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

  // 缺 priceUnit 的价格区间整段丢弃：不可通约的计价单位之间比 amount 没有意义
  // （元/月 vs 元/㎡/天 vs 元/工位/月）。域层 `matchesInput` 对同一条不变量另有
  // 守卫——那才是失效点上的守卫；这里做的是 URL 卫生，让 canonical 不会把一个
  // 注定不生效的参数继续带在链接上。
  if (!priceUnit) {
    priceMin = undefined
    priceMax = undefined
  }

  return {
    ...(group ? { group } : {}),
    ...(areaMin != null ? { areaMin } : {}),
    ...(areaMax != null ? { areaMax } : {}),
    ...(priceMin != null ? { priceMin } : {}),
    ...(priceMax != null ? { priceMax } : {}),
    ...(decorationStatus ? { decorationStatus } : {}),
    ...(availableBefore ? { availableBefore } : {}),
    ...(priceUnit ? { priceUnit } : {}),
    ...(sort ? { sort } : {}),
  }
}

/**
 * BuildingSupplyInput → canonical URLSearchParams（供组切换 / 筛选 / 排序控件
 * 构造 href 用）。
 *
 * 与 `buildCanonicalSearchParams`（ListingSearchInput 版）同一约定：只输出已
 * 通过解析校验的规范键，不反射原始 query string——这样调用方（Server Component
 * 页面）把 `parseBuildingSupplySearchParams` 解析后的 `input` 转回字符串传给
 * 客户端组件时，非法/过期参数不会被带着走一遍「解析→再序列化」又混进 href。
 *
 * `sort` 省略默认值 'recommended'（与 canonical 惯例一致，默认态不占位）。
 */
export function buildBuildingSupplyCanonicalSearchParams(input: BuildingSupplyInput): URLSearchParams {
  const sp = new URLSearchParams()
  if (input.group) sp.set('group', input.group)
  if (input.areaMin != null) sp.set('areaMin', String(input.areaMin))
  if (input.areaMax != null) sp.set('areaMax', String(input.areaMax))
  // 价格区间只在有 priceUnit 时才是有效状态（见 parseBuildingSupplySearchParams）。
  if (input.priceUnit && input.priceMin != null) sp.set('priceMin', String(input.priceMin))
  if (input.priceUnit && input.priceMax != null) sp.set('priceMax', String(input.priceMax))
  if (input.decorationStatus) sp.set('decorationStatus', input.decorationStatus)
  if (input.availableBefore) sp.set('availableBefore', input.availableBefore)
  if (input.priceUnit) sp.set('priceUnit', input.priceUnit)
  if (input.sort && input.sort !== 'recommended') sp.set('sort', input.sort)
  return sp
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
  // 价格单位：新名优先，旧名兜底。旧 rentUnit 只能表达 3 个租赁单位，
  // 新 priceUnit 覆盖 12 值全集（含出售）。
  const priceUnit =
    parseEnum<PriceDisplayUnit>(sp, 'priceUnit', PRICE_UNIT_WHITELIST)
    ?? parseEnum<PriceDisplayUnit>(sp, 'rentUnit', RENT_UNIT_WHITELIST)
  const priceKey = priceUnitToPriceKey(priceUnit)
  // 排序：白名单同时收新旧值，解析后归一到新值，下游只认一套。
  const sortRaw = parseEnum<string>(sp, 'sort', SORT_WHITELIST)
  const sortNormalized = sortRaw
    ? ((LEGACY_SORT_ALIASES[sortRaw] ?? sortRaw) as ListingSort)
    : undefined
  const sort = normalizeSort(sortNormalized, priceUnit)
  const areaMin = parseIntInRange(sp, 'areaMin', 0, 1_000_000)
  const areaMax = parseIntInRange(sp, 'areaMax', 0, 1_000_000)
  // 价格区间：同样新名优先、旧名兜底。
  const priceMin =
    parseIntInRange(sp, 'priceMin', 0, Number.MAX_SAFE_INTEGER)
    ?? parseIntInRange(sp, 'rentMin', 0, Number.MAX_SAFE_INTEGER)
  const priceMax =
    parseIntInRange(sp, 'priceMax', 0, Number.MAX_SAFE_INTEGER)
    ?? parseIntInRange(sp, 'rentMax', 0, Number.MAX_SAFE_INTEGER)
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
    priceMin,
    priceMax,
    priceUnit,
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
  // 只输出新名：旧参数仅在解析层被接受，canonical 负责把索引收敛到一套 URL。
  // 两边都输出会产生同义重复的 canonical，索引归并不了。
  if (input.priceMin != null) sp.set('priceMin', String(input.priceMin))
  if (input.priceMax != null) sp.set('priceMax', String(input.priceMax))
  if (input.priceUnit) sp.set('priceUnit', input.priceUnit)
  if (input.availableBefore) sp.set('availableBefore', input.availableBefore)
  if (input.q) sp.set('q', input.q)
  if (input.sort && input.sort !== LISTING_DEFAULT_SORT) sp.set('sort', input.sort)
  if (input.page > 1) sp.set('page', String(input.page))
  return sp
}
