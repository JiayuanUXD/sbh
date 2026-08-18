/**
 * 公开目录查询类型：搜索输入、排序、上下文
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§7.1、§7.4、§8
 *
 * 守护不变量：
 *   - ListingSearchInput 完全对齐 design.md §7.1 字段白名单；
 *   - 所有数组字段 readonly，调用方不可原地变更；
 *   - 排序枚举封闭，禁止跨币种、跨单位价格排序（design.md §7.4）；
 *   - SearchContext 强制 asOf / 时区 / 公开渠道标识，M4.7 完成后服务消费同上下文。
 */

import type { Listing } from '@/payload-types'
import type { PriceDisplayUnit } from './contracts'

/**
 * 租金计价单位（与 Listing.rentUnit 一致）。
 *
 * 仅用于兼容旧 URL 的 `rentUnit` 参数（3 个租赁单位）。新代码用
 * `PriceDisplayUnit`（12 值，含出售单位）。
 */
export type RentUnit = NonNullable<Listing['rentUnit']>

/**
 * 价格排序的完整语义键：周期与计价基础。
 *
 * 曾只有 'day' | 'month'，因为旧 rentUnit 参数只能表达这两种。改用 priceUnit
 * 后取值域与 PriceViewModel 对齐，出售的一次性计价（one-time）也能进筛选。
 */
export type PricePeriod = 'day' | 'month' | 'year' | 'one-time'
export type PriceBasis = 'sqm' | 'seat' | 'total'

/**
 * 排序方式（design.md §7.4）。
 *
 * `price-asc` / `price-desc` 取代了 `rent-asc` / `rent-desc`：出售频道按总价
 * 排序时「rent」这个词是错的。旧值在解析层仍被接受（见 search-params 的兼容映射），
 * canonical 只输出新值。同时消除了一处现存不一致——楼盘详情页的
 * BUILDING_SUPPLY_SORTS 早就是 price-* 了。
 */
export type ListingSort = 'recommended' | 'price-asc' | 'price-desc' | 'newest'

/**
 * 房源搜索输入
 *
 * 字段白名单依据 design.md §7.1：
 *   - city / district / businessArea / metro：地理筛选
 *   - listingType：办公类型筛选
 *   - areaMin / areaMax：面积范围
 *   - priceMin / priceMax / priceUnit：价格范围与单位（旧名 rentMin/rentMax/rentUnit 仍兼容）
 *   - availableBefore：可入驻时间上限
 *   - q：关键词
 *   - sort / page / pageSize：排序与分页
 *
 * 解析器视为 unknown 输入，对数组长度、数值边界、日期、枚举和页码做白名单校验。
 * 非法参数回退到安全默认值并生成规范化 canonical URL。
 */
export type ListingSearchInput = Readonly<{
  city?: string
  district?: readonly string[]
  businessArea?: readonly string[]
  metro?: readonly string[]
  listingType?: readonly string[]
  areaMin?: number
  areaMax?: number
  /** 价格下限。URL 上旧名 rentMin 仍被接受，canonical 只输出 priceMin。 */
  priceMin?: number
  /** 价格上限。URL 上旧名 rentMax 仍被接受，canonical 只输出 priceMax。 */
  priceMax?: number
  /**
   * 价格排序时必须指定单位，禁止跨单位直接排序。
   *
   * 取值为 PriceDisplayUnit 全集（12 值），含出售的 rmb-total / rmb-sqm-total。
   * URL 上旧名 rentUnit 仍被接受（只能表达 3 个租赁单位），canonical 只输出 priceUnit。
   */
  priceUnit?: PriceDisplayUnit
  /** 由 priceUnit 投影而来的结构化键。 */
  pricePeriod?: PricePeriod
  /** 由 priceUnit 投影而来的结构化键。 */
  priceBasis?: PriceBasis
  /** ISO 日期字符串，如 '2026-08-01' */
  availableBefore?: string
  q?: string
  sort?: ListingSort
  page: number
  pageSize: 24
}>

/**
 * 公开查询上下文
 *
 * design.md §3.1：context 必须包含 asOf、时区 Asia/Shanghai、公开渠道标识和城市。
 * 所有子查询在同一逻辑时点解析，避免列表隐藏但直链可见的差异。
 */
export type SearchContext = Readonly<{
  /** 查询逻辑时点（ISO 字符串）；缺省为当前时点 */
  asOf: string
  /** 固定 Asia/Shanghai，避免 UTC 偏移导致可用性判定漂移 */
  timezone: 'Asia/Shanghai'
  /** 公开渠道标识，M4.7 服务据此应用完整谓词 */
  channel: 'public-web'
  /** 当前城市 slug；所有公开查询必须显式绑定城市 */
  city: string
  /**
   * 当前租售频道；**不传表示不按租售过滤**。
   *
   * 与 city 同级的查询作用域：city 圈定「哪个城市」，businessType 圈定「租还是售」。
   * 刻意可选而非必填带默认，因为有几类查询确实需要全集：楼盘详情页要把 lease /
   * sale / coworking 分组展示、sitemap 两类都要收录、详情页直链要能访问任何有效
   * 房源。给它隐式默认会让出售频道查不到数据且看不出原因。
   *
   * 取值指引：租赁列表 / 首页精选 / 在租面积聚合传 'lease'；出售频道传 'sale'；
   * 楼盘详情页与 sitemap 不传。
   */
  businessType?: 'lease' | 'sale'
}>

/**
 * 创建显式城市搜索上下文（当前时点 / 上海时区 / 公开渠道）
 *
 * @param businessType 可选租售频道；不传表示不按租售过滤（楼盘详情页、sitemap 等
 *   需要全集的场景）。
 */
export function createSearchContext(
  city: string,
  now: Date = new Date(),
  businessType?: SearchContext['businessType'],
): SearchContext {
  const normalized = city.trim().toLowerCase()
  if (!normalized) throw new Error('search_context_city_required')
  return {
    asOf: now.toISOString(),
    timezone: 'Asia/Shanghai',
    channel: 'public-web',
    city: normalized,
    ...(businessType ? { businessType } : {}),
  }
}

/** 分页结果元数据 */
export type Pagination = Readonly<{
  page: number
  pageSize: 24
  totalDocs: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}>
