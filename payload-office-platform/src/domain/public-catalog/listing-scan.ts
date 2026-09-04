/**
 * OPT-068 房源扫描层：紧凑行模型 + 行上的纯函数。
 *
 * ## 为什么有这一层
 *
 * 列表页原先的做法是 `findEffectiveListings`：把最多 1000 条候选按 depth 2 整棵
 * 拉出（线上实测每 200 条 1.5 秒、8MB），在内存里做精筛 / 价格过滤 / 排序 / 分页；
 * facet 再对同一候选集重复扫描。任何 5 分钟内没人访问过的筛选组合，第一位用户
 * 要等 5–20 秒。
 *
 * 现在：适配器只做**一次轻量扫描**（`select` + `populate` 收窄到下面这些字段），
 * 产出 `ListingScanRow`；区域 / 类型 / 价格单位 / 价格区间这四个维度不再进 where，
 * 而是在行上做——于是同城同频道下，这四个维度的任意组合、任意页码、任意排序
 * 都命中**同一份**扫描缓存；只有面积 / 商圈 / 地铁 / 关键词 / 可用日期这类维度
 * 才产生新的扫描键。当前页需要的 24 张卡片再按 id 回捞 depth 2 映射。
 *
 * ## 行必须紧凑、必须可 JSON 序列化
 *
 * 扫描结果整份进 `unstable_cache`（单条 2MB 硬上限，超限**静默**写不进去）。
 * 每行只放过滤 / 排序 / facet / 推荐候选真正读取的字段，目标 ≤ 300 字节；
 * `lastEffAt` 缺省用 0 而不是 -Infinity——`JSON.stringify(-Infinity)` 是 `null`，
 * 反序列化后排序比较会把它当 0 之外的东西处理，两条路径就不一致了。
 *
 * ## 与旧路径同口径
 *
 * - 有效供给谓词不变：粗筛 where、举报暂停排除、`fineFilter` 都在适配器扫描时
 *   照常执行，本文件只处理已经合格的行。
 * - 区域过滤：旧路径把 district 解析成楼盘 id 列表下推到 where；行上按
 *   `building.district.slug` 判等，两者对「楼盘在该城且属该区」的语义一致。
 * - 价格过滤：`matchesPriceFilter` 是 `supply-adapter#filterByPrice` 那条裁定的
 *   唯一实现，适配器现在也调用它。
 * - facet：`computeFacets` 与原 `facade#getSearchFacets` 的聚合逐字段等价。
 */

import { toId } from '@/domain/review/effective-supply-snapshot'
import type { RecommendationCandidate } from '@/domain/recommendation/detail-recommendations'
import type { CoordinatesViewModel, DistrictViewModel, PriceViewModel } from './contracts'
import { mapCoordinates, mapDistrict, resolveListingPrice } from './mappers'
import { buildCanonicalSearchParams } from './search-params'
import { buildPagination, paginate, prepareForPriceSort, stableSortListings } from './stable-sort'
import type { ListingSearchInput, Pagination } from './types'

export type ListingScanRow = Readonly<{
  id: number
  slug: string
  listingType: string | null
  businessType: 'lease' | 'sale'
  area: number | null
  price: PriceViewModel | null
  isFeatured: boolean
  /** `Date.parse(updatedAt)`；无法解析为 0（不能用 -Infinity：JSON 会变 null） */
  lastEffAt: number
  buildingId: number | null
  district: DistrictViewModel | null
  businessDistrictId: number | null
  coordinates: CoordinatesViewModel | null
}>

/**
 * 在扫描行上、而不是在 where 里生效的维度。
 *
 * 这四个维度的取值空间小、判定只读行自身字段，放到内存里换来的是缓存键空间
 * 坍缩：`district × listingType × priceUnit × 区间 × page × sort` 的全部组合共用
 * 同一份扫描。
 */
export type ScanMemoryDimension = 'district' | 'listingType' | 'priceUnit' | 'price'
export const SCAN_MEMORY_DIMENSIONS: readonly ScanMemoryDimension[] = [
  'district',
  'listingType',
  'priceUnit',
  'price',
]

/** facet 统计与 `SearchFacets` 同构（定义在 facade），这里只依赖字段形状。 */
export type ScanFacets = Readonly<{
  districts: ReadonlyArray<DistrictViewModel & { count: number }>
  listingTypes: ReadonlyArray<{ value: string; count: number }>
  rentUnits: ReadonlyArray<{ value: string; count: number }>
  totalDocs: number
}>

export type ListingPageSelection = Readonly<{
  ids: number[]
  pagination: Pagination
  filteredByRentUnit: boolean
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberId(value: unknown): number | null {
  const id = toId(value)
  return typeof id === 'number' ? id : null
}

function parseTime(value: unknown): number {
  if (typeof value !== 'string' || value.length === 0) return 0
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : 0
}

/**
 * 把 depth ≥ 2 的 Listing 文档投影为扫描行。楼盘缺失（未展开或为 null）返回 null——
 * 与 `mapListingCard` 在 `mapBuildingSummary` 失败时返回 null 同一取舍：没有楼盘的
 * 房源在任何公开列表里都不可见。
 */
export function rowFromListing(raw: unknown): ListingScanRow | null {
  if (!isRecord(raw)) return null
  const id = numberId(raw.id)
  if (id === null || typeof raw.slug !== 'string') return null
  const building = raw.building
  if (!isRecord(building)) return null
  const buildingId = numberId(building.id)
  if (buildingId === null) return null
  const businessType = raw.businessType === 'sale' ? 'sale' : 'lease'
  return {
    id,
    slug: raw.slug,
    listingType: typeof raw.listingType === 'string' ? raw.listingType : null,
    businessType,
    area: typeof raw.area === 'number' && Number.isFinite(raw.area) ? raw.area : null,
    price: resolveListingPrice(raw),
    isFeatured: raw.isFeatured === true,
    lastEffAt: parseTime(raw.updatedAt),
    buildingId,
    district: mapDistrict(building.district) ?? null,
    businessDistrictId: numberId(building.businessDistrict),
    coordinates: mapCoordinates(building.latitude, building.longitude) ?? null,
  }
}

export function rowsFromListings(docs: readonly unknown[]): ListingScanRow[] {
  const rows: ListingScanRow[] = []
  for (const doc of docs) {
    const row = rowFromListing(doc)
    if (row) rows.push(row)
  }
  return rows
}

/**
 * 扫描输入：剥掉内存维度，页码与排序归零。
 *
 * 不复用 `facade#omitListingSearchDimensions` 而是在这里逐字段删，是因为 facade
 * 依赖本文件（循环导入）；两处剥离的字段清单以 `SCAN_MEMORY_DIMENSIONS` 为准，
 * 剥 `priceUnit` 时连派生的 `pricePeriod` / `priceBasis` 与区间一起剥，与那边一致。
 */
export function toScanInput(input: ListingSearchInput): ListingSearchInput {
  const next: Record<string, unknown> = { ...input }
  delete next.district
  delete next.listingType
  delete next.priceUnit
  delete next.pricePeriod
  delete next.priceBasis
  delete next.priceMin
  delete next.priceMax
  next.page = 1
  next.sort = 'recommended'
  return next as unknown as ListingSearchInput
}

/** 扫描缓存键：只含会进 where 的维度（含城市 / 频道由调用方另加）。 */
export function buildListingScanCacheKey(input: ListingSearchInput): string {
  return buildCanonicalSearchParams(toScanInput(input)).toString()
}

/**
 * 价格精筛：`priceUnit` 是单位断言，`priceMin` / `priceMax` 是它之上的数值断言。
 *
 * 裁定（与楼盘详情供给区 `building-supply.ts#matchesInput` 同一不变量）：
 *   - 缺 `priceUnit` 时整段不生效——元/月、元/㎡/天、元/工位/月三个量纲不可通约，
 *     拿 `amount` 直接比大小得到的只是随单位分布漂移的随机子集；
 *   - 单位不等于 `priceUnit` 的房源不入选，即使金额落在区间内；
 *   - 无价格的房源（「面议」）**选单位时仍然入选、给区间时不入选**：区间是数值
 *     断言，面议既不满足也无法比较；单位断言对一条没有报价的房源无从证伪，
 *     剔掉它等于让它从列表和「另有 N 套按 X 报价」计数里同时消失。
 */
export function matchesPriceFilter(price: PriceViewModel | null, input: ListingSearchInput): boolean {
  const { priceMin, priceMax, priceUnit } = input
  if (!priceUnit) return true
  const hasRange = priceMin != null || priceMax != null
  if (!price) return !hasRange
  if (price.displayUnit !== priceUnit) return false
  if (priceMin != null && price.amount < priceMin) return false
  if (priceMax != null && price.amount > priceMax) return false
  return true
}

/** 在扫描行上应用内存维度（区域 / 类型 / 价格）。 */
export function applyMemoryFilters(
  rows: readonly ListingScanRow[],
  input: ListingSearchInput,
): ListingScanRow[] {
  const districts = input.district && input.district.length > 0 ? new Set(input.district) : null
  const types = input.listingType && input.listingType.length > 0 ? new Set(input.listingType) : null
  return rows.filter((row) => {
    if (districts && (!row.district || !districts.has(row.district.slug))) return false
    if (types && (!row.listingType || !types.has(row.listingType))) return false
    return matchesPriceFilter(row.price, input)
  })
}

/**
 * facet：当前可见行的分布统计（区域 / 类型 / 计价单位）。
 *
 * 与原 `getSearchFacets` 逐字段等价：区域按楼盘所属区聚合、类型按 `listingType`、
 * 单位只统计非空价格；`totalDocs` 是行数。插入顺序即首次出现顺序（Map 语义）。
 */
export function computeFacets(rows: readonly ListingScanRow[]): ScanFacets {
  const districtCounts = new Map<string, { vm: DistrictViewModel; count: number }>()
  const listingTypeCounts = new Map<string, number>()
  const rentUnitCounts = new Map<string, number>()

  for (const row of rows) {
    if (row.district) {
      const existing = districtCounts.get(row.district.slug)
      if (existing) {
        existing.count += 1
      } else {
        districtCounts.set(row.district.slug, { vm: row.district, count: 1 })
      }
    }
    if (row.listingType) {
      listingTypeCounts.set(row.listingType, (listingTypeCounts.get(row.listingType) ?? 0) + 1)
    }
    if (row.price) {
      rentUnitCounts.set(row.price.displayUnit, (rentUnitCounts.get(row.price.displayUnit) ?? 0) + 1)
    }
  }

  return {
    districts: Array.from(districtCounts.values()).map(({ vm, count }) => ({ ...vm, count })),
    listingTypes: Array.from(listingTypeCounts.entries()).map(([value, count]) => ({ value, count })),
    rentUnits: Array.from(rentUnitCounts.entries()).map(([value, count]) => ({ value, count })),
    totalDocs: rows.length,
  }
}

/**
 * 在扫描行上完成过滤 → 价格预处理 → 稳定排序 → 分页，只返回本页 id。
 *
 * 排序键与卡片路径共用 `stable-sort.ts`；`lastEffAt` 直接读行字段。
 */
export function selectListingPage(
  rows: readonly ListingScanRow[],
  input: ListingSearchInput,
): ListingPageSelection {
  const filtered = applyMemoryFilters(rows, input)
  const { items, filteredByRentUnit } = prepareForPriceSort(filtered, input)
  const sorted = stableSortListings(items, input.sort ?? 'recommended', (row) => row.lastEffAt)
  const paged = paginate(sorted, input.page, input.pageSize)
  return {
    ids: paged.docs.map((row) => row.id),
    pagination: buildPagination(paged.totalDocs, input.page, input.pageSize),
    filteredByRentUnit,
  }
}

/** 推荐候选：与 facade 原 `listingToCandidate` 同口径，只是从行而不是原始文档取值。 */
export function rowToCandidate(row: ListingScanRow): RecommendationCandidate {
  return {
    id: row.id,
    // 候选契约里 listingType 是必填字符串；行上为 null 时给空串，打分只做相等比较，
    // 空串与任何真实类型都不相等，等价于「类型未知不加分」。
    listingType: row.listingType ?? '',
    businessType: row.businessType,
    area: row.area,
    priceAmount: row.price?.amount ?? null,
    priceUnit: row.price?.displayUnit ?? null,
    buildingDistrictId: row.district?.id ?? null,
    buildingBusinessDistrictId: row.businessDistrictId,
  }
}
