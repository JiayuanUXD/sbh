/**
 * 稳定排序与分页工具
 *
 * 设计依据：specs/frontend-mvp/design.md §7.4
 *
 * 守护不变量：
 *   - 同权重必须以不可变 listing_id 升序收束，保证跨页稳定；
 *   - 价格排序仅按完整价格 key 相同的标准字段排序；
 *   - 跨币种、跨租售类型、周期或计价基础不合并排序；
 *   - 排序在内存中执行，假定输入已是有效供给结果（M4.7 完成后由服务返回）。
 *
 * 排序规则（design.md §7.4）：
 *   - recommended：isFeatured desc → lastEffectiveMaintainedAt desc → id asc
 *   - newest：lastEffectiveMaintainedAt desc → id asc
 *   - rent-asc / rent-desc：rent 同单位升降序 → id asc
 *
 * 注意：当前 Listing 模型尚无 `lastEffectiveMaintainedAt` 字段（M4.7 引入），
 * 此处以 `updatedAt` 作为过渡替代；M4.7 完成后字段名切换不影响外部 API。
 *
 * OPT-068：排序与价格预处理从「只认 `ListingCardViewModel`」泛型化为「任何带
 * `id` / `isFeatured` / `price` 的对象」。列表页现在先在紧凑的扫描行
 * （`listing-scan.ts#ListingScanRow`）上排序分页，再回捞本页卡片；卡片与扫描行
 * 必须用**同一份**比较器，否则两条路径迟早各排各的。
 */

import type { ListingCardViewModel, PriceViewModel } from './contracts'
import type { ListingSearchInput, ListingSort, Pagination } from './types'

/** 排序 / 价格预处理只读这三个字段：卡片与扫描行都满足。 */
export type PricedItem = Readonly<{ price: PriceViewModel | null }>
export type SortableListing = PricedItem & Readonly<{ id: number; isFeatured: boolean }>

/**
 * 把 Date 字符串安全转为时间戳；非法或缺失返回 -Infinity（排到末尾）
 *
 * 输入视为 unknown，避免 dirty data 导致排序崩溃。
 */
function toTime(v: unknown): number {
  if (typeof v !== 'string' || v.length === 0) return -Infinity
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : -Infinity
}

/** 比较函数：数值降序，等值返回 0 */
function descNumber(a: number, b: number): number {
  if (a > b) return -1
  if (a < b) return 1
  return 0
}

/** 比较函数：数值升序，等值返回 0 */
function ascNumber(a: number, b: number): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * 按 recommended 排序：isFeatured desc → lastEffectiveMaintainedAt desc → id asc
 *
 * 用 updatedAt 作为 lastEffectiveMaintainedAt 过渡，由调用方提供。
 */
function compareRecommended<T extends SortableListing>(
  a: T,
  b: T,
  lastEffAt: (item: T) => number,
): number {
  // isFeatured desc：true 在前
  const fa = a.isFeatured ? 1 : 0
  const fb = b.isFeatured ? 1 : 0
  if (fa !== fb) return descNumber(fa, fb)
  // lastEffectiveMaintainedAt desc
  const ta = lastEffAt(a)
  const tb = lastEffAt(b)
  if (ta !== tb) return descNumber(ta, tb)
  // listing_id 升序收束
  return ascNumber(a.id, b.id)
}

/**
 * 按 newest 排序：lastEffectiveMaintainedAt desc → id asc
 */
function compareNewest<T extends SortableListing>(
  a: T,
  b: T,
  lastEffAt: (item: T) => number,
): number {
  const ta = lastEffAt(a)
  const tb = lastEffAt(b)
  if (ta !== tb) return descNumber(ta, tb)
  return ascNumber(a.id, b.id)
}

/**
 * 按价格排序（必须同完整价格 key）：rent asc/desc → id asc
 *
 * 调用方必须在分组前已校验所有条目的 businessType/currency/period/basis 相同；
 * 此函数不再做单位校验，假设输入已分组。
 *
 * 缺失价格（price=null）的条目始终排到末尾，无论升降序。
 */
function comparePrice<T extends SortableListing>(a: T, b: T, direction: 'asc' | 'desc'): number {
  const pa = a.price?.amount
  const pb = b.price?.amount
  // 缺失价格统一末尾（asc 时大、desc 时小，借助 ±Infinity）
  const sa = pa == null ? (direction === 'asc' ? Infinity : -Infinity) : pa
  const sb = pb == null ? (direction === 'asc' ? Infinity : -Infinity) : pb
  if (sa !== sb) {
    return direction === 'asc' ? ascNumber(sa, sb) : descNumber(sa, sb)
  }
  return ascNumber(a.id, b.id)
}

/**
 * 稳定排序（卡片或扫描行）
 *
 * @param items 已经过有效供给筛选的条目
 * @param sort 排序方式
 * @param lastEffAt 提取 lastEffectiveMaintainedAt 时间戳的函数（过渡用 updatedAt）
 *
 * 不变量：
 *   - 不修改输入数组，返回新数组；
 *   - 同权重以 id 升序收束，保证跨页稳定（不依赖 Array.prototype.sort 的稳定性）；
 *   - 价格排序调用方必须先按 rentUnit 分组，否则跨单位排序非法。
 */
export function stableSortListings<T extends SortableListing>(
  items: readonly T[],
  sort: ListingSort,
  lastEffAt: (item: T) => number,
): T[] {
  const arr = items.slice()
  const canSortByPrice = isSameRentUnit(arr)
  arr.sort((a, b) => {
    switch (sort) {
      case 'recommended':
        return compareRecommended(a, b, lastEffAt)
      case 'newest':
        return compareNewest(a, b, lastEffAt)
      case 'price-asc':
        return canSortByPrice ? comparePrice(a, b, 'asc') : ascNumber(a.id, b.id)
      case 'price-desc':
        return canSortByPrice ? comparePrice(a, b, 'desc') : ascNumber(a.id, b.id)
    }
  })
  return arr
}

/** 稳定排序房源卡片列表——`stableSortListings` 的卡片特化，保留给既有调用方。 */
export function stableSortCards(
  cards: readonly ListingCardViewModel[],
  sort: ListingSort,
  lastEffAt: (card: ListingCardViewModel) => number,
): ListingCardViewModel[] {
  return stableSortListings(cards, sort, lastEffAt)
}

/**
 * 返回完整价格 key。displayUnit 仅用于展示，不能作为排序/聚合键。
 */
export function priceKeyOf(price: PriceViewModel | null | undefined): string | null {
  if (!price) return null
  return `${price.businessType}:${price.currency}:${price.period}:${price.basis}`
}

/**
 * 检查列表是否所有非空价格都属同一完整价格 key。
 *
 * 用于价格排序前的安全校验。design.md §7.4：禁止跨单位直接价格排序。
 */
export function isSameRentUnit<T extends PricedItem>(items: readonly T[]): boolean {
  let key: string | null = null
  for (const c of items) {
    const current = priceKeyOf(c.price)
    if (current == null) continue
    if (key == null) {
      key = current
    } else if (current !== key) {
      return false
    }
  }
  return true
}

/**
 * 按价格排序时安全分组：仅保留指定计价单位的条目
 *
 * 注意：此函数不"丢弃"其他单位的条目，而是返回同单位子集。
 * 调用方负责在 UI 上提示"价格排序仅显示同单位房源"或单独发起查询。
 *
 * MVP 策略：价格排序按钮仅在用户选定 priceUnit 后可点击；
 * 未选定时 UI 应禁用按钮（见 search-params.ts normalizeSort）。
 *
 * `unit` 直接与 `displayUnit` 比对，**不经中间映射表**。这里曾经握着一张只列了
 * 旧 `rentUnit` 那 3 个取值的表（`rmb-sqm-day` / `rmb-month` / `rmb-seat-month`），
 * 是参数改名前的遗产；`PriceDisplayUnit` 有 12 个取值，其余 9 个查表得 `undefined`，
 * 于是 `c.price?.displayUnit === undefined` 恒为 false，**整页被清空**——用户选了
 * 「元/总价」再按价格排序，看到的是「一套都没有」，而库里明明有。表和枚举同义却
 * 各写一份，多出来的那份迟早只覆盖一部分取值；两者本就同名同义，比对即可。
 */
export function filterByRentUnit<T extends PricedItem>(items: readonly T[], unit: string): T[] {
  return items.filter((c) => c.price?.displayUnit === unit)
}

/** 仅保留完整价格 key 相同的条目，供价格排序前收束。 */
export function filterByPriceKey<T extends PricedItem>(items: readonly T[], key: string): T[] {
  return items.filter((item) => priceKeyOf(item.price) === key)
}

/**
 * 价格排序预处理：若条目价格单位不一致，按首个非空单位过滤。
 *
 * 守护不变量（design.md §7.4、FRONTEND_AGENT.md §6.3）：
 *   - 禁止跨 rentUnit 价格排序；
 *   - UI 应在 sort=price-asc/price-desc 且未指定 priceUnit 时提示"已按统一单位显示"。
 *
 * 曾是 facade 里只认卡片的 `prepareCardsForPriceSort`；OPT-068 起扫描行与卡片共用。
 */
export function prepareForPriceSort<T extends PricedItem>(
  items: readonly T[],
  input: ListingSearchInput,
): { items: T[]; filteredByRentUnit: boolean } {
  if (input.sort !== 'price-asc' && input.sort !== 'price-desc') {
    return { items: items.slice(), filteredByRentUnit: false }
  }
  // 已显式选定 priceUnit：直接按该单位过滤
  if (input.priceUnit) {
    return {
      items: filterByRentUnit(items, input.priceUnit),
      filteredByRentUnit: items.some((item) => item.price != null && item.price.displayUnit !== input.priceUnit),
    }
  }
  // 未指定 priceUnit 但请求价格排序：取首个非空单位
  if (isSameRentUnit(items)) {
    return { items: items.slice(), filteredByRentUnit: false }
  }
  const firstWithPrice = items.find((c) => c.price != null)
  if (!firstWithPrice?.price) {
    return { items: items.slice(), filteredByRentUnit: false }
  }
  return {
    items: filterByPriceKey(items, priceKeyOf(firstWithPrice.price)!),
    filteredByRentUnit: true,
  }
}

/**
 * 分页工具：从有序列表中切出当前页
 *
 * - page < 1 时自动回退为 1（防御非法输入）；
 * - page > totalPages 时返回空数组但保留 totalDocs/totalPages（便于 UI 显示「无结果」
 *   而非伪装成第 1 页；design.md §7.4 越界页 → 空文档）；
 * - 空列表返回 docs=[]、totalDocs=0、totalPages=1（避免 totalPages=0 在渲染层引发除零）。
 */
export function paginate<T>(
  sorted: readonly T[],
  page: number,
  pageSize: number,
): { docs: T[]; totalDocs: number; totalPages: number } {
  const totalDocs = sorted.length
  const safePageSize = pageSize > 0 ? pageSize : 1
  const totalPages = Math.max(1, Math.ceil(totalDocs / safePageSize))
  // page < 1 视为非法 → 回退为 1；page > totalPages 不 clamp（返回空文档）
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * safePageSize
  const end = start + safePageSize
  return {
    docs: sorted.slice(start, end),
    totalDocs,
    totalPages,
  }
}

/** 计算分页元数据（与 `paginate` 同一套 page / totalPages 规则）。 */
export function buildPagination(totalDocs: number, page: number, pageSize: number): Pagination {
  const safePageSize = pageSize > 0 ? pageSize : 1
  const totalPages = Math.max(1, Math.ceil(totalDocs / safePageSize))
  // page < 1 视为非法 → 回退为 1；page > totalPages 不 clamp（与 paginate 一致）
  const safePage = Math.max(1, page)
  return {
    page: safePage,
    pageSize: pageSize as 24,
    totalDocs,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
  }
}

export { toTime as __toTimeForTest }
