import type { FilterRow } from '@/components/frontend/listing/FilterFormC'
import type {
  DistrictViewModel,
  ListingSearchDimension,
  ListingSearchInput,
  PriceDisplayUnit,
} from '@/domain/public-catalog'
import { LISTING_TYPE_LABEL } from './listing-display'
import { priceUnitLabel } from './format'

/**
 * 房源列表页筛选行（形态 C）的构造。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「筛选形态 C：分行文本条件区」
 * specRows「形态 C 条件行」——comp 稿写的是 5 行：位置 / 类型 / 价格 / 面积 / 装修。
 *
 * ## 与 comp 的两处差异（显式取舍，不是遗漏）
 *
 *   - **装修行没有实现**：`ListingSearchInput` 里没有 `decorationStatus` 这个维度
 *     （楼盘详情页的供给筛选 `BuildingSupplyInput` 才有）。造一个写进 URL 却不参与
 *     查询的筛选行，就是「点了没反应的死控件」；给房源搜索加一个真实的装修维度
 *     要动解析层白名单 + canonical + SupplyAdapter 的 where + 域层测试，属于
 *     Task 1/2 那一类域层工作，不在接线任务范围内。因此本批次少一行，**并在任务
 *     报告里显式记为遗留**，而不是渲染一个假行。
 *   - **价格行是「上限」单选而不是 comp 的区间桶**：`FilterRow` 一行只写一个
 *     URL 参数（`buildOptionHref` 的契约），而区间要同时写 `priceMin`+`priceMax`。
 *     comp 自己的空态②退路也把这个维度叫做「租金上限」（`≤ 6 元/㎡/天 → ≤ 8`），
 *     说明上限才是这一页真正建模的那个量，因此这里按上限建模，标签也照实写
 *     「租金上限」而不是含糊的「价格」。
 *
 * ## 价格行只在选定计价单位后出现
 *
 * 没有 `priceUnit` 时结果集里混着元/㎡/天、元/月、元/工位/月三种彼此不可换算的
 * 报价，「≤ 5」这个门槛跨单位没有意义（5 元/㎡/天 与 5 元/月 不是同一个量级）。
 * 此时价格行的候选为空，`FilterFormC` 会整行不渲染——这与「无候选值的行不渲染」
 * 是同一条既有规则，不需要特殊分支。选定单位后按该单位的门槛表出现。
 */

/** 一行筛选对应的搜索维度：空态②按维度构造退路时要用同一份对应关系。 */
export type ListingFilterDimensionSpec = Readonly<{
  /** 域层维度名，交给 `omitListingSearchDimensions` / `getCachedSearchFacetsIgnoring`。 */
  dimension: ListingSearchDimension
  /** 维度中文名，用于空态②的退路文案。 */
  label: string
  /** 该维度占用的 URL 参数键（构造「去掉这一个条件」的 href 时全部删掉）。 */
  paramKeys: readonly string[]
  /** 当前生效值的可读文案；未生效时为 null。 */
  activeText: string | null
}>

/** 面积下限门槛（㎡）。与计价单位无关，因此不分表。 */
const AREA_MIN_BUCKETS: readonly number[] = [100, 300, 500, 1000, 2000]

/**
 * 各计价单位的价格上限门槛。
 *
 * `Record<PriceDisplayUnit, ...>` 保证 12 个单位一个不漏——新增单位时编译期报错，
 * 而不是在页面上静默少一行筛选。门槛是产品档位（不是从数据算出来的分位数）：
 * 同一单位下门槛固定，用户在不同城市、不同时间看到的是同一组档位，可比。
 */
const PRICE_MAX_BUCKETS: Readonly<Record<PriceDisplayUnit, readonly number[]>> = {
  'rmb-sqm-day': [4, 6, 8, 12],
  'rmb-sqm-month': [120, 180, 240, 360],
  'rmb-sqm-year': [1500, 2200, 3000, 4500],
  'rmb-sqm-total': [30000, 50000, 80000, 120000],
  'rmb-seat-day': [80, 120, 180, 260],
  'rmb-seat-month': [1500, 2500, 4000, 6000],
  'rmb-seat-year': [18000, 30000, 48000, 72000],
  'rmb-seat-total': [50000, 100000, 200000, 400000],
  'rmb-day': [500, 1000, 2000, 4000],
  'rmb-month': [20000, 50000, 100000, 200000],
  'rmb-year': [240000, 600000, 1200000, 2400000],
  'rmb-total': [5000000, 10000000, 30000000, 80000000],
}

/** 数字读法：万位以上折成「N 万」，避免筛选行里出现 200000 这种难扫读的长串。 */
function compactNumber(value: number): string {
  if (value >= 10000 && value % 1000 === 0) {
    const wan = value / 10000
    return `${Number.isInteger(wan) ? wan : wan.toFixed(1)} 万`
  }
  return String(value)
}

function firstOrUndefined(values: readonly string[] | undefined): string | undefined {
  // 单选行：URL 上出现多值（老链接或手改）时只认第一个，其余交给
  // FilterFormC.findActiveOption 防御性丢弃，不在这里报错。
  return values && values.length > 0 ? values[0] : undefined
}

export type ListingFilterRowsResult = Readonly<{
  rows: readonly FilterRow[]
  /** 与 rows 一一对应之外，还包含未渲染成行但确实生效的维度（关键词/商圈/地铁等）。 */
  dimensions: readonly ListingFilterDimensionSpec[]
}>

/**
 * 构造筛选行 + 维度清单。
 *
 * @param districts 城市可见区域全集（`getCachedListingDistrictOptions`）。
 * @param districtCounts 剥掉「区域」维度后的各区计数——**必须是剥离后的**，
 *   否则选中静安以后其余区计数全为 0（Task 2 的「facets 算在筛选前」同型问题）。
 * @param typeCounts 剥掉「类型」维度后的各类型计数，同上。
 */
export function buildListingFilterRows(params: Readonly<{
  input: ListingSearchInput
  districts: readonly DistrictViewModel[]
  districtCounts: ReadonlyMap<string, number>
  typeCounts: ReadonlyMap<string, number>
  /** 价格行标签，租售语境不同（「租金上限」/「总价上限」），从 CHANNEL_COPY 取。 */
  priceRowLabel: string
  /**
   * 价格**维度**标签（「租金」/「总价」）。与 `priceRowLabel` 刻意分开：筛选行
   * 只写上限，叫「租金上限」准确；但维度覆盖 priceMin+priceMax 两个字段，空态②
   * 的退路文案若沿用「租金上限」，遇到同时有下限的 URL 会说出「租金上限：
   * 3 元以上 · 8 元以下」这种自相矛盾的话。
   */
  priceDimensionLabel: string
}>): ListingFilterRowsResult {
  const { input, districts, districtCounts, typeCounts, priceRowLabel, priceDimensionLabel } = params

  const activeDistrict = firstOrUndefined(input.district)
  const activeType = firstOrUndefined(input.listingType)
  const activePriceMax = input.priceMax != null ? String(input.priceMax) : undefined
  const activeAreaMin = input.areaMin != null ? String(input.areaMin) : undefined

  // 计数为 0 的候选不渲染：点进去必然空手而归，比不出现更糟（与批次统一的
  // 「不显示 0」同源）。当前已选项永远保留，否则用户会看不到自己选中的是什么。
  const districtOptions = districts
    .filter((district) => district.slug === activeDistrict || (districtCounts.get(district.slug) ?? 0) > 0)
    .map((district) => ({
      value: district.slug,
      label: district.name,
      ...(districtCounts.get(district.slug) != null && districtCounts.get(district.slug)! > 0
        ? { count: districtCounts.get(district.slug)! }
        : {}),
    }))

  const typeOptions = (Object.keys(LISTING_TYPE_LABEL) as (keyof typeof LISTING_TYPE_LABEL)[])
    .filter((value) => value === activeType || (typeCounts.get(value) ?? 0) > 0)
    .map((value) => ({
      value,
      label: LISTING_TYPE_LABEL[value],
      ...(typeCounts.get(value) != null && typeCounts.get(value)! > 0
        ? { count: typeCounts.get(value)! }
        : {}),
    }))

  const priceBuckets = input.priceUnit ? PRICE_MAX_BUCKETS[input.priceUnit] : []
  const unitText = input.priceUnit ? priceUnitLabel(input.priceUnit) : ''
  const priceOptions = priceBuckets.map((threshold) => ({
    value: String(threshold),
    label: `${compactNumber(threshold)} 元以下`,
  }))

  const areaOptions = AREA_MIN_BUCKETS.map((threshold) => ({
    value: String(threshold),
    label: `${compactNumber(threshold)} ㎡以上`,
  }))

  const rows: FilterRow[] = [
    { key: 'district', label: '位置', options: districtOptions, ...(activeDistrict ? { activeValue: activeDistrict } : {}) },
    { key: 'type', label: '类型', options: typeOptions, ...(activeType ? { activeValue: activeType } : {}) },
    { key: 'priceMax', label: priceRowLabel, options: priceOptions, ...(activePriceMax ? { activeValue: activePriceMax } : {}) },
    { key: 'areaMin', label: '面积下限', options: areaOptions, ...(activeAreaMin ? { activeValue: activeAreaMin } : {}) },
  ]

  const activeDistrictName = activeDistrict
    ? (districts.find((d) => d.slug === activeDistrict)?.name ?? activeDistrict)
    : null

  const dimensions: ListingFilterDimensionSpec[] = [
    {
      dimension: 'district',
      label: '位置',
      paramKeys: ['district'],
      activeText: activeDistrictName,
    },
    {
      dimension: 'listingType',
      label: '类型',
      paramKeys: ['type'],
      activeText: activeType ? LISTING_TYPE_LABEL[activeType as keyof typeof LISTING_TYPE_LABEL] ?? activeType : null,
    },
    {
      dimension: 'price',
      label: priceDimensionLabel,
      // 旧名 rentMin/rentMax 仍被解析层接受，构造「去掉这个条件」的 href 时
      // 必须一并删掉，否则旧链接上的残留值会在放宽后立刻把条件加回来。
      paramKeys: ['priceMin', 'priceMax', 'rentMin', 'rentMax'],
      activeText:
        input.priceMin != null || input.priceMax != null
          ? [
              input.priceMin != null ? `${compactNumber(input.priceMin)} 元以上` : null,
              input.priceMax != null ? `${compactNumber(input.priceMax)} 元以下` : null,
            ]
              .filter(Boolean)
              .join(' · ') + (unitText ? `（${unitText}）` : '')
          : null,
    },
    {
      dimension: 'area',
      label: '面积',
      paramKeys: ['areaMin', 'areaMax'],
      activeText:
        input.areaMin != null || input.areaMax != null
          ? [
              input.areaMin != null ? `${compactNumber(input.areaMin)} ㎡以上` : null,
              input.areaMax != null ? `${compactNumber(input.areaMax)} ㎡以下` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : null,
    },
    {
      dimension: 'businessArea',
      label: '商圈',
      paramKeys: ['businessArea'],
      activeText: firstOrUndefined(input.businessArea) ?? null,
    },
    {
      dimension: 'metro',
      label: '地铁',
      paramKeys: ['metro'],
      activeText: firstOrUndefined(input.metro) ?? null,
    },
    {
      dimension: 'availableBefore',
      label: '可入驻时间',
      paramKeys: ['availableBefore'],
      activeText: input.availableBefore ?? null,
    },
    {
      dimension: 'q',
      label: '关键词',
      paramKeys: ['q'],
      activeText: input.q ?? null,
    },
  ]

  return { rows, dimensions }
}

/** 全部可被「清除全部条件」清掉的维度——不含 priceUnit，理由见 CityListingsView。 */
export const LISTING_CLEARABLE_DIMENSIONS: readonly ListingSearchDimension[] = [
  'district',
  'listingType',
  'price',
  'area',
  'businessArea',
  'metro',
  'availableBefore',
  'q',
]
