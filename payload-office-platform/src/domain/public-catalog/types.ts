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

/** 租金计价单位（与 Listing.rentUnit 一致） */
export type RentUnit = NonNullable<Listing['rentUnit']>

/** 价格排序的完整语义键中，由旧 rentUnit URL 投影出的周期与计价基础。 */
export type PricePeriod = 'day' | 'month'
export type PriceBasis = 'sqm' | 'seat' | 'total'

/** 排序方式（design.md §7.4） */
export type ListingSort = 'recommended' | 'rent-asc' | 'rent-desc' | 'newest'

/**
 * 房源搜索输入
 *
 * 字段白名单依据 design.md §7.1：
 *   - city / district / businessArea / metro：地理筛选
 *   - listingType：办公类型筛选
 *   - areaMin / areaMax：面积范围
 *   - rentMin / rentMax / rentUnit：租金范围与单位
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
  rentMin?: number
  rentMax?: number
  /** 价格排序时必须指定单位，禁止跨单位直接排序 */
  rentUnit?: RentUnit
  /** 由 rentUnit 兼容解析而来；新消费者应使用此结构化键。 */
  pricePeriod?: PricePeriod
  /** 由 rentUnit 兼容解析而来；新消费者应使用此结构化键。 */
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
 * design.md §3.1：context 必须包含 asOf、时区 Asia/Shanghai、公开渠道标识和可选城市。
 * 所有子查询在同一逻辑时点解析，避免列表隐藏但直链可见的差异。
 */
export type SearchContext = Readonly<{
  /** 查询逻辑时点（ISO 字符串）；缺省为当前时点 */
  asOf: string
  /** 固定 Asia/Shanghai，避免 UTC 偏移导致可用性判定漂移 */
  timezone: 'Asia/Shanghai'
  /** 公开渠道标识，M4.7 服务据此应用完整谓词 */
  channel: 'public-web'
  /** 当前城市 slug；MVP 单城市默认 shanghai */
  city?: string
}>

/** 默认搜索上下文（当前时点 / 上海时区 / 公开渠道） */
export function defaultSearchContext(now: Date = new Date()): SearchContext {
  return {
    asOf: now.toISOString(),
    timezone: 'Asia/Shanghai',
    channel: 'public-web',
    city: 'shanghai',
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
