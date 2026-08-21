import type {
  BuildingSupplyAreaRange,
  BuildingSupplyGroup,
  BuildingSupplyGroupAvailability,
  BuildingSupplyGroupViewModel,
  BuildingSupplyPriceRange,
  BuildingSupplySnapshot,
  ListingCardViewModel,
  PriceViewModel,
} from './contracts'
import { priceKeyOf } from './stable-sort'
import { parseUtcIso, shanghaiDate } from '@/domain/shared/time'

export type BuildingSupplyInput = Readonly<{
  group?: BuildingSupplyGroup
  areaMin?: number
  areaMax?: number
  /**
   * 价格区间下界（含）。**必须与 `priceUnit` 同时给出**，否则整段被忽略。
   *
   * 元/月、元/㎡/天、元/工位/月 三者不可通约，脱离单位的 amount 之间没有可比性，
   * 「8 以上」跨单位比出来的结果毫无意义且会误导用户。守卫落在 `matchesInput`
   * 真正做数值比较的那一行（解析层也会丢弃缺单位的区间，但那只是 URL 卫生，
   * 不是不变量本身——域层不能依赖调用方一定走过解析层）。
   */
  priceMin?: number
  /** 价格区间上界（含）。约束同 `priceMin`。 */
  priceMax?: number
  decorationStatus?: string
  availableBefore?: string
  priceUnit?: PriceViewModel['displayUnit']
  sort?: 'recommended' | 'area-asc' | 'area-desc' | 'price-asc' | 'price-desc'
}>

const GROUP_ORDER: readonly BuildingSupplyGroup[] = ['lease', 'sale', 'coworking']

function groupOf(card: ListingCardViewModel): BuildingSupplyGroup {
  // Listing type is the domain discriminator for coworking. It intentionally
  // wins over businessType because coworking listings are normally leases.
  if (card.listingType === 'coworking') return 'coworking'
  return card.businessType
}

/**
 * 「可入驻日期」的**唯一**比较实现——按 Asia/Shanghai 自然日，不按时刻。
 *
 * 为什么是日粒度而不是 `Date.parse` 的时刻粒度：`Listings.availableFrom` 是
 * Payload 的 `date` 字段（业务语义就是「哪一天可以入驻」），但落库/序列化后是带
 * 时刻的完整 ISO；URL 上的 `availableBefore` 则由 `parseBuildingSupplySearchParams`
 * 保证是 `YYYY-MM-DD`。两侧粒度不同，用哪一侧的粒度做比较都会在「恰好当天」出错：
 *   - 旧的字符串比较：`'2026-08-19T00:00:00.000Z' > '2026-08-19'` 为真，
 *     当天可入驻的房源被过滤掉；
 *   - 改成 `Date.parse` 两侧硬比：`availableBefore` 会被当成当天零点，当天
 *     晚些时候可入驻的房源同样被排除——只是把同一个 off-by-one 挪了个位置。
 * 只有把两侧都归一到自然日，「可即刻入驻 N」的计数与「可即刻入驻」pill 的过滤
 * 才是同一个判据（见 `isImmediatelyAvailable` 直接复用本函数）。
 *
 * 时区取 Asia/Shanghai 而不是 UTC 日：仓库既有不变量是「库存 UTC，产品显示与
 * 自然日统计用 Asia/Shanghai」（`domain/shared/time.ts` 文件头），而供给行展示
 * 具体日期时走的 `formatAvailableDate` 也是 `shanghaiDate`。用 UTC 日截断会让
 * 「显示 8 月 20 日」和「按 8 月 19 日参与比较」同时成立，等于换一个时段复发
 * 同一类自相矛盾。本函数也是视图层构造 `availableBefore` pill 取值的来源，
 * 保证 pill 的参数值与计数用的那一天是同一天。
 */
export function availabilityDay(value: string): string | null {
  const parsed = parseUtcIso(value)
  return parsed ? shanghaiDate(parsed) : null
}

/**
 * 该房源是否「不晚于 `day`（YYYY-MM-DD）可入驻」。
 * 无 `availableFrom` 视为随时可入驻（与「未填 = 现房」的既有口径一致）。
 */
function isAvailableByDay(card: ListingCardViewModel, day: string): boolean {
  if (!card.availableFrom) return true
  const cardDay = availabilityDay(card.availableFrom)
  return cardDay != null && cardDay <= day
}

function matchesInput(card: ListingCardViewModel, input: BuildingSupplyInput): boolean {
  if (input.group && groupOf(card) !== input.group) return false
  if (input.areaMin != null && (card.area == null || card.area < input.areaMin)) return false
  if (input.areaMax != null && (card.area == null || card.area > input.areaMax)) return false
  if (input.decorationStatus && card.decorationStatus !== input.decorationStatus) return false
  if (input.availableBefore) {
    const beforeDay = availabilityDay(input.availableBefore)
    if (beforeDay == null || !isAvailableByDay(card, beforeDay)) return false
  }
  // A price-on-request card stays visible when the caller chooses a price unit.
  if (input.priceUnit && card.price && card.price.displayUnit !== input.priceUnit) return false
  // 价格区间：单位闸门是硬前提。缺 priceUnit 时整段不生效（而不是退化成跨单位
  // 比价）；生效时，只有「有价格且单位正好等于 priceUnit」的房源能参与比较——
  // 价格面议（price=null）无法落进任何价格区间，与改造前的分桶行为一致。
  if ((input.priceMin != null || input.priceMax != null) && input.priceUnit) {
    const amount = card.price?.displayUnit === input.priceUnit ? card.price.amount : null
    if (amount == null) return false
    if (input.priceMin != null && amount < input.priceMin) return false
    if (input.priceMax != null && amount > input.priceMax) return false
  }
  return true
}

function compareIds(a: ListingCardViewModel, b: ListingCardViewModel): number {
  return a.id - b.id
}

function compareRecommended(a: ListingCardViewModel, b: ListingCardViewModel): number {
  if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1
  return compareIds(a, b)
}

function compareArea(a: ListingCardViewModel, b: ListingCardViewModel, direction: 'asc' | 'desc'): number {
  const av = a.area ?? (direction === 'asc' ? Infinity : -Infinity)
  const bv = b.area ?? (direction === 'asc' ? Infinity : -Infinity)
  if (av !== bv) return direction === 'asc' ? av - bv : bv - av
  return compareIds(a, b)
}

function comparePrice(a: ListingCardViewModel, b: ListingCardViewModel, direction: 'asc' | 'desc'): number {
  const av = a.price?.amount ?? (direction === 'asc' ? Infinity : -Infinity)
  const bv = b.price?.amount ?? (direction === 'asc' ? Infinity : -Infinity)
  if (av !== bv) return direction === 'asc' ? av - bv : bv - av
  return compareIds(a, b)
}

function hasMixedPriceKeys(cards: readonly ListingCardViewModel[]): boolean {
  let key: string | null = null
  for (const card of cards) {
    const current = priceKeyOf(card.price)
    if (!current) continue
    if (key && key !== current) return true
    key = current
  }
  return false
}

function sortCards(
  cards: readonly ListingCardViewModel[],
  input: BuildingSupplyInput,
  canComparePrices: boolean,
): ListingCardViewModel[] {
  const sort = input.sort ?? 'recommended'
  return cards.slice().sort((a, b) => {
    switch (sort) {
      case 'area-asc':
        return compareArea(a, b, 'asc')
      case 'area-desc':
        return compareArea(a, b, 'desc')
      case 'price-asc':
        return canComparePrices ? comparePrice(a, b, 'asc') : compareIds(a, b)
      case 'price-desc':
        return canComparePrices ? comparePrice(a, b, 'desc') : compareIds(a, b)
      case 'recommended':
        return compareRecommended(a, b)
    }
  })
}

function buildPriceRanges(cards: readonly ListingCardViewModel[]): readonly BuildingSupplyPriceRange[] {
  const ranges = new Map<string, BuildingSupplyPriceRange>()
  for (const card of cards) {
    const price = card.price
    const key = priceKeyOf(price)
    if (!price || !key) continue
    const existing = ranges.get(key)
    if (existing) {
      ranges.set(key, {
        ...existing,
        min: Math.min(existing.min, price.amount),
        max: Math.max(existing.max, price.amount),
        count: existing.count + 1,
      })
    } else {
      ranges.set(key, {
        key,
        businessType: price.businessType,
        currency: price.currency,
        period: price.period,
        basis: price.basis,
        displayUnit: price.displayUnit,
        min: price.amount,
        max: price.amount,
        count: 1,
      })
    }
  }
  return Array.from(ranges.values()).sort((a, b) => a.key.localeCompare(b.key))
}

/** 数值区间聚合：面积与工位数是两种聚合对象，但「取一列数的 min/max」是同一件事。 */
function buildNumericRange(values: readonly (number | null)[]): BuildingSupplyAreaRange | null {
  const usable = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
  if (usable.length === 0) return null
  return { min: Math.min(...usable), max: Math.max(...usable) }
}

/**
 * 该房源在 `asOf` 这一刻是否「可即刻入驻」。
 *
 * 导出给视图层用（供给行的「可即刻」徽标），**不要在组件里再写一份**：
 * 楼盘页同时展示「可即刻入驻 N」计数、「可即刻入驻」筛选 pill 和逐行徽标，
 * 三者必须是同一个判据，否则会出现「计入了 N 却被 pill 过滤掉」这类自相矛盾。
 * 与 `availableBefore` 过滤共用 `isAvailableByDay`，构造上不可能分叉。
 */
export function isImmediatelyAvailable(card: ListingCardViewModel, asOf: string): boolean {
  const day = availabilityDay(asOf)
  return day != null && isAvailableByDay(card, day)
}

function aggregateGroup(
  key: BuildingSupplyGroup,
  cards: readonly ListingCardViewModel[],
  asOf: string,
): Omit<BuildingSupplyGroupAvailability, 'totalEffectiveListings'> {
  return {
    key,
    areaRange: buildNumericRange(cards.map((card) => card.area)),
    seatRange: buildNumericRange(cards.map((card) => card.seats)),
    immediateAvailabilityCount: cards.filter((card) => isImmediatelyAvailable(card, asOf)).length,
    priceRanges: buildPriceRanges(cards),
  }
}

export function emptyBuildingSupplySnapshot(asOf: string): BuildingSupplySnapshot {
  return {
    asOf,
    groups: [],
    availableGroups: [],
    totalEffectiveListings: 0,
    resultCount: 0,
    validationErrors: [],
  }
}

export function buildBuildingSupplySnapshot(
  cards: readonly ListingCardViewModel[],
  input: BuildingSupplyInput,
  asOf: string,
): BuildingSupplySnapshot {
  const filtered = cards.filter((card) => matchesInput(card, input))
  const isPriceSort = input.sort === 'price-asc' || input.sort === 'price-desc'
  const groups: BuildingSupplyGroupViewModel[] = []
  const availableGroups: BuildingSupplyGroupAvailability[] = []

  for (const key of GROUP_ORDER) {
    const availableCards = cards.filter((card) => groupOf(card) === key)
    if (availableCards.length > 0) {
      availableGroups.push({
        ...aggregateGroup(key, availableCards, asOf),
        totalEffectiveListings: availableCards.length,
      })
    }

    const groupCards = filtered.filter((card) => groupOf(card) === key)
    if (groupCards.length === 0) continue
    /**
     * 「能不能比价」**按组算**，不用跨组的 `filtered`。
     *
     * 页面把默认组的 href 写成不带 `group` 参数（canonical 惯例），于是默认组下
     * `input.group === undefined`、`filtered` 是跨全部业务组的卡片。`priceKeyOf`
     * 含 `businessType`，所以「这栋楼同时有租赁与出售」这一个事实就让
     * `hasMixedPriceKeys(filtered)` 恒真 → 每个组的价格排序统统退化成 `compareIds`，
     * 而视图层按当前组算「单位是否唯一」照常渲染排序选项并高亮。排序本来就是
     * 组内行为（`listings` 按组切、`sortCards` 按组各排各的），判据必须同粒度。
     * 有 `priceUnit` 时 `matchesInput` 已经把结果收敛到单一单位，仍显式写出来，
     * 让「单位闸门 = 可比价」的因果留在代码里而不是靠推。
     */
    const groupCanComparePrices = Boolean(input.priceUnit) || !hasMixedPriceKeys(groupCards)
    const sorted = sortCards(groupCards, input, groupCanComparePrices)
    groups.push({
      ...aggregateGroup(key, sorted, asOf),
      listings: sorted,
      priceSortDegraded: isPriceSort && !groupCanComparePrices,
    })
  }

  // 快照级汇总信号（见 contracts.ts）：任一组降级即置位。组级提示读组自己的
  // `priceSortDegraded`，不读这里。
  const validationErrors = groups.some((group) => group.priceSortDegraded)
    ? (['price_unit_required'] as const)
    : []

  return {
    asOf,
    groups,
    availableGroups,
    totalEffectiveListings: cards.length,
    resultCount: filtered.length,
    validationErrors,
  }
}
