export const PRICE_DISPLAY_UNITS = [
  'rmb-sqm-day', 'rmb-sqm-month', 'rmb-sqm-year', 'rmb-sqm-total',
  'rmb-seat-day', 'rmb-seat-month', 'rmb-seat-year', 'rmb-seat-total',
  'rmb-day', 'rmb-month', 'rmb-year', 'rmb-total',
] as const

export type PriceDisplayUnit = (typeof PRICE_DISPLAY_UNITS)[number]

type QueryEntry = Readonly<{ key: string; value: string }>

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      if (index + 1 >= value.length) return true
      const next = value.charCodeAt(index + 1)
      if (next < 0xDC00 || next > 0xDFFF) return true
      index += 1
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return true
    }
  }
  return false
}

function isWellFormed(value: string): boolean {
  return !hasUnpairedSurrogate(value)
}

function decodeQueryComponent(value: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(value.replaceAll('+', ' '))
  } catch {
    decoded = value
  }
  return isWellFormed(decoded) ? decoded : undefined
}

function parseQuery(query: string): readonly QueryEntry[] {
  const rawQuery = query.startsWith('?') ? query.slice(1) : query
  return rawQuery
    .split('&')
    .filter((item) => item.length > 0)
    .map((item) => {
      const separator = item.indexOf('=')
      const key = decodeQueryComponent(separator === -1 ? item : item.slice(0, separator))
      const value = decodeQueryComponent(separator === -1 ? '' : item.slice(separator + 1))
      if (key === undefined || value === undefined) return undefined
      return {
        key,
        value,
      }
    })
    .filter((entry): entry is QueryEntry => entry !== undefined)
}

function isPriceDisplayUnit(value: string | undefined): value is PriceDisplayUnit {
  return value !== undefined && (PRICE_DISPLAY_UNITS as readonly string[]).includes(value)
}

function isPriceSort(value: string): boolean {
  return value === 'price-asc'
    || value === 'price-desc'
    || value === 'rent-asc'
    || value === 'rent-desc'
}

/**
 * 将外部列表查询收口为可安全附加到固定城市参数后的字符串。
 * 保留非价格筛选的顺序和重复值，避免此处重复后端的完整筛选语义。
 */
export function normalizeListingQuery(query: string): string {
  const entries = parseQuery(query)
  const selectedPriceUnit = entries.find(
    (entry) => entry.key === 'priceUnit' && isPriceDisplayUnit(entry.value),
  )
  const hasPriceUnit = selectedPriceUnit !== undefined

  return entries
    .filter((entry) => {
      if (entry.key === 'city') return false
      if (entry.key === 'priceUnit') return entry === selectedPriceUnit
      if (!hasPriceUnit && (entry.key === 'priceMin' || entry.key === 'priceMax')) return false
      if (!hasPriceUnit && entry.key === 'sort' && isPriceSort(entry.value)) return false
      return true
    })
    .map((entry) => `${encodeURIComponent(entry.key)}=${encodeURIComponent(entry.value)}`)
    .join('&')
}

export const LISTING_TYPES = [
  'traditional-office',
  'coworking',
  'full-floor',
  'serviced-office',
] as const

export type ListingType = (typeof LISTING_TYPES)[number]

export const LISTING_SORTS = [
  'recommended',
  'price-asc',
  'price-desc',
  'newest',
] as const

export type ListingSort = (typeof LISTING_SORTS)[number]

export interface ListingQuery {
  q?: string
  district?: readonly string[]
  type?: readonly ListingType[]
  areaMin?: number
  areaMax?: number
  priceMin?: number
  priceMax?: number
  priceUnit?: PriceDisplayUnit
  availableBefore?: string
  sort: ListingSort
  page: number
}

export type ListingQueryPatch = Readonly<Partial<ListingQuery>>

const RESULT_DIMENSIONS = new Set<keyof Omit<ListingQuery, 'page'>>([
  'q',
  'district',
  'type',
  'areaMin',
  'areaMax',
  'priceMin',
  'priceMax',
  'priceUnit',
  'availableBefore',
  'sort',
])

const MAX_ARRAY_LENGTH = 20
const MAX_QUERY_LENGTH = 100

function isListingType(value: string): value is ListingType {
  return (LISTING_TYPES as readonly string[]).includes(value)
}

function isListingSort(value: string): value is ListingSort {
  return (LISTING_SORTS as readonly string[]).includes(value)
}

function parseInteger(value: string | undefined, max: number): number | undefined {
  if (value === undefined || value.trim() !== value || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > max) return undefined
  return parsed
}

function parseDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day)
  ) {
    return undefined
  }
  return value
}

function dedupe(values: readonly string[]): readonly string[] | undefined {
  const unique = [...new Set(
    values
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && isWellFormed(value)),
  )]
  return unique.length > 0 ? unique.slice(0, MAX_ARRAY_LENGTH) : undefined
}

function parseDistricts(entries: readonly QueryEntry[]): readonly string[] | undefined {
  return dedupe(entries.filter((entry) => entry.key === 'district').map((entry) => entry.value))
}

function parseTypes(entries: readonly QueryEntry[]): readonly ListingType[] | undefined {
  const unique = [...new Set(
    entries
      .filter((entry) => entry.key === 'type')
      .map((entry) => entry.value)
      .filter(isListingType),
  )]
  return unique.length > 0 ? unique.slice(0, MAX_ARRAY_LENGTH) : undefined
}

/**
 * `rent-asc` / `rent-desc` 只作为历史 URL 兼容输入，绝不是 `ListingSort` 成员；
 * 状态和序列化始终只使用 `price-asc` / `price-desc`。
 */
function normalizeSort(value: string | undefined, priceUnit: PriceDisplayUnit | undefined): ListingSort {
  const aliased = value === 'rent-asc'
    ? 'price-asc'
    : value === 'rent-desc'
      ? 'price-desc'
      : value
  const sort = aliased !== undefined && isListingSort(aliased) ? aliased : 'recommended'
  if (!priceUnit && (sort === 'price-asc' || sort === 'price-desc')) return 'recommended'
  return sort
}

function normalizeQuery(query: ListingQueryPatch): ListingQuery {
  const qCandidate = typeof query.q === 'string' ? query.q.trim().slice(0, MAX_QUERY_LENGTH) : undefined
  const q = qCandidate && isWellFormed(qCandidate) ? qCandidate : undefined
  const district = query.district ? dedupe(query.district) : undefined
  const type = query.type
    ? parseTypes(query.type.map((value) => ({ key: 'type', value })))
    : undefined
  let areaMin = typeof query.areaMin === 'number' && Number.isSafeInteger(query.areaMin)
    && query.areaMin >= 0 && query.areaMin <= 1_000_000
    ? query.areaMin
    : undefined
  let areaMax = typeof query.areaMax === 'number' && Number.isSafeInteger(query.areaMax)
    && query.areaMax >= 0 && query.areaMax <= 1_000_000
    ? query.areaMax
    : undefined
  const priceUnit = typeof query.priceUnit === 'string' && isPriceDisplayUnit(query.priceUnit)
    ? query.priceUnit
    : undefined
  let priceMin = typeof query.priceMin === 'number' && Number.isSafeInteger(query.priceMin)
    && query.priceMin >= 0
    ? query.priceMin
    : undefined
  let priceMax = typeof query.priceMax === 'number' && Number.isSafeInteger(query.priceMax)
    && query.priceMax >= 0
    ? query.priceMax
    : undefined

  if (areaMin !== undefined && areaMax !== undefined && areaMin > areaMax) {
    areaMin = undefined
    areaMax = undefined
  }
  if (!priceUnit || (priceMin !== undefined && priceMax !== undefined && priceMin > priceMax)) {
    priceMin = undefined
    priceMax = undefined
  }

  const page = typeof query.page === 'number' && Number.isSafeInteger(query.page)
    && query.page >= 1 && query.page <= 10_000
    ? query.page
    : 1

  return {
    ...(q ? { q } : {}),
    ...(district ? { district } : {}),
    ...(type ? { type } : {}),
    ...(areaMin !== undefined ? { areaMin } : {}),
    ...(areaMax !== undefined ? { areaMax } : {}),
    ...(priceMin !== undefined ? { priceMin } : {}),
    ...(priceMax !== undefined ? { priceMax } : {}),
    ...(priceUnit ? { priceUnit } : {}),
    ...(typeof query.availableBefore === 'string' && parseDate(query.availableBefore)
      ? { availableBefore: query.availableBefore }
      : {}),
    sort: normalizeSort(query.sort, priceUnit),
    page,
  }
}

export function parseListingQuery(query: string): ListingQuery {
  const entries = parseQuery(normalizeListingQuery(query))
  const first = (key: string): string | undefined => entries.find((entry) => entry.key === key)?.value
  const priceUnitValue = first('priceUnit')
  const priceUnit = isPriceDisplayUnit(priceUnitValue) ? priceUnitValue : undefined

  return normalizeQuery({
    q: first('q'),
    district: parseDistricts(entries),
    type: parseTypes(entries),
    areaMin: parseInteger(first('areaMin'), 1_000_000),
    areaMax: parseInteger(first('areaMax'), 1_000_000),
    priceMin: parseInteger(first('priceMin'), Number.MAX_SAFE_INTEGER),
    priceMax: parseInteger(first('priceMax'), Number.MAX_SAFE_INTEGER),
    priceUnit,
    availableBefore: first('availableBefore'),
    sort: first('sort') as ListingSort | undefined,
    page: parseInteger(first('page'), 10_000),
  })
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  return left === right
}

export function applyListingPatch(query: ListingQuery, patch: ListingQueryPatch): ListingQuery {
  const current = normalizeQuery(query)
  const next = normalizeQuery({ ...current, ...patch })
  const resultChanged = [...RESULT_DIMENSIONS].some((key) => !sameValue(current[key], next[key]))
  return resultChanged ? { ...next, page: 1 } : next
}

export function nextPageQuery(query: ListingQuery, page: number): ListingQuery {
  return normalizeQuery({ ...normalizeQuery(query), page })
}

export function serializeListingQuery(query: ListingQuery): string {
  const normalized = normalizeQuery(query)
  const entries: QueryEntry[] = []
  if (normalized.q) entries.push({ key: 'q', value: normalized.q })
  for (const district of normalized.district ?? []) entries.push({ key: 'district', value: district })
  for (const type of normalized.type ?? []) entries.push({ key: 'type', value: type })
  if (normalized.areaMin !== undefined) entries.push({ key: 'areaMin', value: String(normalized.areaMin) })
  if (normalized.areaMax !== undefined) entries.push({ key: 'areaMax', value: String(normalized.areaMax) })
  if (normalized.priceMin !== undefined) entries.push({ key: 'priceMin', value: String(normalized.priceMin) })
  if (normalized.priceMax !== undefined) entries.push({ key: 'priceMax', value: String(normalized.priceMax) })
  if (normalized.priceUnit) entries.push({ key: 'priceUnit', value: normalized.priceUnit })
  if (normalized.availableBefore) entries.push({ key: 'availableBefore', value: normalized.availableBefore })
  if (normalized.sort !== 'recommended') entries.push({ key: 'sort', value: normalized.sort })
  if (normalized.page > 1) entries.push({ key: 'page', value: String(normalized.page) })
  return entries.map((entry) => `${encodeURIComponent(entry.key)}=${encodeURIComponent(entry.value)}`).join('&')
}
