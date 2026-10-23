/**
 * 资讯日更的取数、快照与对账（OPT-124）：纯函数，`scripts/news/data.ts` 负责联网与写文件。
 *
 * 口径与来源：
 * - 取数走匿名公开 REST（不需要任何生产凭据），条件 = 发布 + 审核通过 + 租赁 + 供给正常，沿用 OPT-118 的
 *   `artifacts/verification/OPT-118/fetch_data.py`。匿名 REST 表达不了「被生效举报冻结」（见 Listings.access.read），
 *   这是一个简化谓词，所以**必须**再和前台对账：前台列表页与区域落地页走的是统一有效供给服务，对得上数字才可信
 *   （`.agent/supply.md`「统计和内容引用不得复制简化谓词」——对账就是这条规则的兜底）。
 * - 价格归一复用 `mappers.ts` 的 `DISPLAY_UNIT_BY_PERIOD_BASIS` / `LEGACY_PRICE`，与 `listing-query-sql.ts` 同一套映射，
 *   不另抄单位表；只有 `rmb-sqm-day`（元/㎡/天）进分位数，与区域落地页（`area-landing-sql.ts`）一致。
 * - 分位数照 PostgreSQL `percentile_cont` 线性插值，再按 `ROUND(x::numeric, 2)` 的方式舍入到分，
 *   这样快照里的中位数能与落地页逐位比对。
 */
import { AREA_LANDING_MIN_PRICE_SAMPLES } from '../../src/domain/public-catalog/area-landing'
import { DISPLAY_UNIT_BY_PERIOD_BASIS, LEGACY_PRICE } from '../../src/domain/public-catalog/mappers'

/** 与前台区域落地页相同的计价单位（`AREA_LANDING_PRICE_UNIT`）。 */
export const DAY_PRICE_UNIT = 'rmb-sqm-day'

/** 有效供给的 REST 近似条件（见文件头：必须再与前台对账）。 */
export const LISTING_SUPPLY_FILTER: Readonly<Record<string, string>> = {
  'where[publicationStatus][equals]': 'published',
  'where[reviewStatus][equals]': 'approved',
  'where[businessType][equals]': 'lease',
  // 待复核（被举报暂停等）的房源前台不展示，但匿名 REST 仍可读，必须排除
  'where[supplyVisibilityHold][equals]': 'normal',
}

export const LISTING_FIELDS = [
  'building',
  'price',
  'rent',
  'rentUnit',
  'area',
  'listingType',
  'decorationStatus',
  'spaceDetails',
  'minimumLeaseMonths',
  'paymentTerms',
  'costTerms',
  'floor',
] as const
export const BUILDING_FIELDS = [
  'name',
  'slug',
  'city',
  'district',
  'businessDistrict',
  'address',
  'grade',
  'buildingType',
  'nearestMetro',
  'latitude',
  'longitude',
  'status',
] as const
export const LOCATION_FIELDS = ['name', 'type', 'parent', 'slug', 'city', 'frontendVisible', 'status'] as const

// ---------------------------------------------------------------------------
// 数值
// ---------------------------------------------------------------------------

/** PostgreSQL `percentile_cont`：对已升序的数组线性插值；空数组返回 null。 */
export function percentileCont(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null
  const h = (sorted.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

/**
 * 模拟 `ROUND(float8::numeric, digits)`：float8 → numeric 先取 15 位有效数字，再四舍五入（远离零）。
 * 直接 `Math.round(x * 100) / 100` 会把 4.245（二进制里是 4.24499…）舍成 4.24，而库里是 4.25。
 */
export function roundLikePg(value: number, digits: number): number {
  const normalized = Number(value.toPrecision(15))
  const factor = 10 ** digits
  return (Math.sign(normalized) * Math.round(Math.abs(normalized) * factor + 1e-9)) / factor
}

// ---------------------------------------------------------------------------
// 价格归一（与 listing-query-sql.ts 的 amount / unit 片段同口径）
// ---------------------------------------------------------------------------

type PriceUnit = string

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function structuredUnit(period: unknown, unit: unknown): PriceUnit | null {
  if (typeof period !== 'string' || typeof unit !== 'string') return null
  if (!Object.hasOwn(DISPLAY_UNIT_BY_PERIOD_BASIS, period)) return null
  const bases = DISPLAY_UNIT_BY_PERIOD_BASIS[period as keyof typeof DISPLAY_UNIT_BY_PERIOD_BASIS]
  // 库里整套计价存的是 suite，映射表里叫 total（同 listing-query-sql.ts）
  const basis = unit === 'suite' ? 'total' : unit
  if (!Object.hasOwn(bases, basis)) return null
  return bases[basis as keyof typeof bases]
}

/** 结构化价格有效就用它，否则退回旧字段 rent / rentUnit；都无效返回 null（面议、无报价）。 */
export function normalizePrice(listing: Readonly<{ price?: unknown; rent?: unknown; rentUnit?: unknown }>): { amount: number; unit: PriceUnit } | null {
  const p = (typeof listing.price === 'object' && listing.price !== null ? listing.price : {}) as Record<string, unknown>
  const sUnit = structuredUnit(p.period, p.unit)
  if (isNonNegativeFinite(p.amount) && p.currency === 'CNY' && sUnit !== null) return { amount: p.amount, unit: sUnit }
  const rentUnit = listing.rentUnit
  if (isNonNegativeFinite(listing.rent) && typeof rentUnit === 'string' && Object.hasOwn(LEGACY_PRICE, rentUnit)) {
    return { amount: listing.rent, unit: LEGACY_PRICE[rentUnit as keyof typeof LEGACY_PRICE].displayUnit }
  }
  return null
}

// ---------------------------------------------------------------------------
// 快照
// ---------------------------------------------------------------------------

export type RawLocation = Readonly<{ id: number; name?: string; slug?: string; type?: string; city?: unknown; parent?: unknown }>
export type RawBuilding = Readonly<{ id: number; city?: unknown; district?: unknown; businessDistrict?: unknown }>
export type RawListing = Readonly<{ id: number; building?: unknown; price?: unknown; rent?: unknown; rentUnit?: unknown; area?: unknown }>

export type AreaStat = Readonly<{
  slug: string
  name: string
  listingCount: number
  buildingCount: number
  priceSampleCount: number
  min: number | null
  p25: number | null
  median: number | null
  p75: number | null
  max: number | null
}>

export type SupplySnapshot = Readonly<{
  asOf: string
  city: string
  listingCount: number
  buildingCount: number
  priceSampleCount: number
  /** 非「元/㎡/天」报价（含面议、按工位、按套）的条数：单位不可换算，不进分位数 */
  otherUnitCount: number
  median: number | null
  districts: readonly AreaStat[]
  businessAreas: readonly AreaStat[]
}>

function idOf(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'number') return (value as { id: number }).id
  return null
}

/** 只保留属于该城市（楼盘的 city）的房源；楼盘查不到的房源丢弃（前台同样展示不出来）。 */
export function listingsInCity(
  listings: readonly RawListing[],
  buildings: ReadonlyMap<number, RawBuilding>,
  cityId: number,
): RawListing[] {
  return listings.filter((l) => {
    const b = buildings.get(idOf(l.building) ?? -1)
    return b !== undefined && idOf(b.city) === cityId
  })
}

function statsOf(slug: string, name: string, rows: readonly { buildingId: number; price: { amount: number; unit: string } | null }[]): AreaStat {
  const prices = rows
    .map((r) => r.price)
    .filter((p): p is { amount: number; unit: string } => p !== null && p.unit === DAY_PRICE_UNIT)
    .map((p) => p.amount)
    .sort((a, b) => a - b)
  const q = (x: number) => {
    const v = percentileCont(prices, x)
    return v === null ? null : roundLikePg(v, 2)
  }
  return {
    slug,
    name,
    listingCount: rows.length,
    buildingCount: new Set(rows.map((r) => r.buildingId)).size,
    priceSampleCount: prices.length,
    min: prices.length > 0 ? prices[0] : null,
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    max: prices.length > 0 ? prices[prices.length - 1] : null,
  }
}

/** 全市 + 各行政区 + 各商圈的条数与「元/㎡/天」分位数；分组口径同落地页（楼盘的 district / businessDistrict）。 */
export function buildSnapshot(input: Readonly<{
  asOf: string
  city: string
  listings: readonly RawListing[]
  buildings: ReadonlyMap<number, RawBuilding>
  locations: ReadonlyMap<number, RawLocation>
}>): SupplySnapshot {
  const rows = input.listings.map((l) => {
    const buildingId = idOf(l.building) ?? -1
    return { buildingId, building: input.buildings.get(buildingId), price: normalizePrice(l) }
  })
  const group = (key: 'district' | 'businessDistrict'): AreaStat[] => {
    const byLocation = new Map<number, typeof rows>()
    for (const r of rows) {
      const locId = idOf(r.building?.[key])
      if (locId === null) continue
      const list = byLocation.get(locId) ?? []
      list.push(r)
      byLocation.set(locId, list)
    }
    return [...byLocation.entries()]
      .map(([locId, list]) => {
        const loc = input.locations.get(locId)
        return statsOf(loc?.slug ?? `#${locId}`, loc?.name ?? `#${locId}`, list)
      })
      .sort((a, b) => b.listingCount - a.listingCount || a.slug.localeCompare(b.slug))
  }
  const city = statsOf(input.city, input.city, rows)
  return {
    asOf: input.asOf,
    city: input.city,
    listingCount: city.listingCount,
    buildingCount: city.buildingCount,
    priceSampleCount: city.priceSampleCount,
    otherUnitCount: city.listingCount - city.priceSampleCount,
    median: city.median,
    districts: group('district'),
    businessAreas: group('businessDistrict'),
  }
}

// ---------------------------------------------------------------------------
// 前台页面解析与对账
// ---------------------------------------------------------------------------

/** 去掉 script / style / 标签后按行切分（React 插的 `<!-- -->` 也是标签，一并去掉）。 */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

/** 列表页「共 N 套」与「位置」筛选行里各区的计数。解析不到返回 null（页面结构变了，宁可停下也不瞎对）。 */
export function parseListPageCounts(html: string): { total: number; districts: Record<string, number> } | null {
  const lines = htmlToLines(html)
  const at = lines.indexOf('共')
  if (at < 0 || !/^\d+$/.test(lines[at + 1] ?? '')) return null
  const total = Number(lines[at + 1])
  const districts: Record<string, number> = {}
  const start = lines.indexOf('位置')
  if (start >= 0) {
    for (let i = start + 1; i < lines.length - 1; i += 1) {
      if (lines[i] === '类型') break
      if (/^\d+$/.test(lines[i + 1]) && !/^\d+$/.test(lines[i])) districts[lines[i]] = Number(lines[i + 1])
    }
  }
  return { total, districts }
}

export type LandingPriceSummary = Readonly<{ median: number; p25: number; p75: number; sampleCount: number }>

/** 区域落地页 FAQ 里的价格摘要：「中位数约为 X 元/㎡/天，多数集中在 A–B 元/㎡/天……（共 N 套报价样本）」。 */
export function parseLandingPriceSummary(html: string): LandingPriceSummary | null {
  const text = htmlToLines(html).join('')
  const m = /中位数约为\s*([\d.]+)\s*元\/㎡\/天，多数集中在\s*([\d.]+)–([\d.]+)\s*元\/㎡\/天[\s\S]*?共\s*([\d,]+)\s*套报价样本/.exec(text)
  if (!m) return null
  return { median: Number(m[1]), p25: Number(m[2]), p75: Number(m[3]), sampleCount: Number(m[4].replace(/,/g, '')) }
}

/** 落地页展示价格摘要的最少报价样本数，直接用前台的常量 */
export const LANDING_MIN_PRICE_SAMPLES = AREA_LANDING_MIN_PRICE_SAMPLES

export type ReconcileRow = Readonly<{ scope: string; field: string; frontend: number | null; ours: number | null; ok: boolean }>

/**
 * 逐项比对：全市总数、列表页各区计数（按区名），以及抽查的落地页价格摘要（按 slug，样本数 + P25/中位数/P75）。
 * 前台有、我们没有，或数值不等，都算不一致。
 *
 * 只对上全市总数不算通过：对账是简化 REST 谓词的兜底（`.agent/supply.md`），覆盖不全时必须失败。
 * 所以还要求：列表页解析出了各区计数；列表页上出现、且报价样本够落地页展示（≥ 10）的行政区，每个都有落地页价格摘要。
 */
export function reconcile(
  snapshot: SupplySnapshot,
  listPage: Readonly<{ total: number; districts: Readonly<Record<string, number>> }>,
  landings: ReadonlyMap<string, LandingPriceSummary>,
): { ok: boolean; rows: ReconcileRow[]; coverageProblems: string[] } {
  const rows: ReconcileRow[] = []
  const coverageProblems: string[] = []
  const push = (scope: string, field: string, frontend: number | null, ours: number | null) =>
    rows.push({ scope, field, frontend, ours, ok: frontend !== null && ours !== null && Math.abs(frontend - ours) < 1e-9 })

  push('全市', '在租条数', listPage.total, snapshot.listingCount)
  const byName = new Map(snapshot.districts.map((d) => [d.name, d]))
  for (const [name, count] of Object.entries(listPage.districts)) push(name, '在租条数', count, byName.get(name)?.listingCount ?? null)

  const bySlug = new Map([...snapshot.districts, ...snapshot.businessAreas].map((a) => [a.slug, a]))
  for (const [slug, summary] of landings) {
    const ours = bySlug.get(slug)
    const label = ours?.name ?? slug
    push(label, '报价样本数', summary.sampleCount, ours?.priceSampleCount ?? null)
    push(label, 'P25', summary.p25, ours?.p25 ?? null)
    push(label, '中位数', summary.median, ours?.median ?? null)
    push(label, 'P75', summary.p75, ours?.p75 ?? null)
  }
  if (Object.keys(listPage.districts).length === 0) coverageProblems.push('列表页没解析出各区计数（「位置」筛选行），行政区分布没有核对')
  for (const name of Object.keys(listPage.districts)) {
    const d = byName.get(name)
    if (d && d.priceSampleCount >= LANDING_MIN_PRICE_SAMPLES && !landings.has(d.slug)) {
      coverageProblems.push(`${name} 在列表页上有、报价样本 ${d.priceSampleCount} 条，却没拿到落地页价格摘要（404 或页面文案变了）`)
    }
  }
  if (landings.size === 0) coverageProblems.push('一个落地页价格摘要都没拿到，P25 / 中位数 / P75 没有核对')
  return { ok: rows.length > 0 && rows.every((r) => r.ok) && coverageProblems.length === 0, rows, coverageProblems }
}
