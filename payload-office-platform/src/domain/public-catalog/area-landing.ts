/**
 * 区域 / 商圈落地页的纯领域规则（OPT-119）。
 *
 * 只放可测试的纯函数：收录门槛、路径、价格摘要、文案与 FAQ。取数（SQL / 缓存）在
 * `area-landing-sql.ts` 与 facade，渲染在 `app/(frontend)/[city]/area/[slug]`。
 *
 * ## 数字口径（与 `artifacts/verification/OPT-118/` 一致）
 *
 * - 只统计租赁、单位 `元/㎡/天` 的挂牌价：其它计价单位彼此不可换算，不参与聚合，
 *   只给出「另有 N 套按其它单位报价」的计数（`otherUnitCount`），不换算、不并入。
 * - 月租估算 = 日单价 × 面积 × 30，与 `estimateMonthlyRent` 同口径。
 * - 全部文案只由传入的数字拼出，不含任何地理 / 历史 / 交通描述——那些没有数据支撑，
 *   运营想写就写在后台 `Locations.description`，页面会优先使用。
 */

/** 低于此在租套数的区域页照常渲染（诚实空态），但 noindex 且不进 sitemap。 */
export const AREA_LANDING_MIN_LISTINGS = 10

/** 价格区块所需的「元/㎡/天」报价样本数下限；不足则整块不渲染，不展示不稳的数字。 */
export const AREA_LANDING_MIN_PRICE_SAMPLES = 10

/** 价格统计唯一参与聚合的计价单位。 */
export const AREA_LANDING_PRICE_UNIT = 'rmb-sqm-day' as const

/** 估算月租用的标准面积（㎡）与月天数，写进 FAQ 让读者能复算。 */
const ESTIMATE_AREA_SQM = 100
const ESTIMATE_DAYS_PER_MONTH = 30

export type AreaLandingKind = 'district' | 'business_area'

/** 单个行政区 / 商圈在有效供给口径下的统计行（SQL 聚合结果的类型化形态）。 */
export type AreaLandingStatsRow = Readonly<{
  kind: AreaLandingKind
  id: number
  slug: string
  name: string
  /** 商圈所属行政区；行政区本身为 null。 */
  parentSlug: string | null
  parentName: string | null
  /** 有效在租房源数（租赁、任意计价单位）。 */
  listingCount: number
  /** 有在租房源的楼盘数。 */
  buildingCount: number
  /** 按 `元/㎡/天` 报价的房源数（价格统计的样本量）。 */
  priceSampleCount: number
  priceMin: number | null
  priceP25: number | null
  priceMedian: number | null
  priceP75: number | null
  priceMax: number | null
  /** 有效在租但不是 `元/㎡/天` 报价的房源数（含面议）。 */
  otherUnitCount: number
  areaMedian: number | null
  /** 该区域有效房源 `updated_at` 的最大值（ISO）；sitemap 的真实 lastmod 来源。 */
  lastUpdatedAt: string | null
}>

export function isAreaLandingIndexable(row: Pick<AreaLandingStatsRow, 'listingCount'>): boolean {
  return row.listingCount >= AREA_LANDING_MIN_LISTINGS
}

/** 落地页的站内路径。slug 已是 URL 安全的拼音，仍统一编码一次，防御后台录入了奇怪字符。 */
export function areaLandingPath(citySlug: string, locationSlug: string): string {
  return `/${citySlug}/area/${encodeURIComponent(locationSlug)}`
}

export type AreaPriceSummary = Readonly<{
  unit: typeof AREA_LANDING_PRICE_UNIT
  sampleCount: number
  min: number
  p25: number
  median: number
  p75: number
  max: number
  /** 100㎡ 办公室的月租估算（元/月）：低 = P25、中 = 中位数、高 = P75。 */
  monthlyFor100Sqm: Readonly<{ low: number; median: number; high: number }>
}>

function monthlyFor(dailyPrice: number): number {
  return Math.round(dailyPrice * ESTIMATE_AREA_SQM * ESTIMATE_DAYS_PER_MONTH)
}

/** 样本不足或任一分位缺失时返回 null——宁可不展示，也不编造。 */
export function summarizeAreaPrice(row: AreaLandingStatsRow): AreaPriceSummary | null {
  if (row.priceSampleCount < AREA_LANDING_MIN_PRICE_SAMPLES) return null
  const { priceMin, priceP25, priceMedian, priceP75, priceMax } = row
  if (priceMin == null || priceP25 == null || priceMedian == null || priceP75 == null || priceMax == null) return null
  return {
    unit: AREA_LANDING_PRICE_UNIT,
    sampleCount: row.priceSampleCount,
    min: priceMin,
    p25: priceP25,
    median: priceMedian,
    p75: priceP75,
    max: priceMax,
    monthlyFor100Sqm: {
      low: monthlyFor(priceP25),
      median: monthlyFor(priceMedian),
      high: monthlyFor(priceP75),
    },
  }
}

export type AreaLandingFaqItem = Readonly<{ question: string; answer: string }>

export type AreaLandingCopy = Readonly<{
  title: string
  description: string
  intro: string
  faq: readonly AreaLandingFaqItem[]
}>

export type AreaLandingCopyInput = Readonly<{
  cityName: string
  location: Readonly<{ kind: AreaLandingKind; name: string; description: string | null }>
  /** 商圈所属行政区名；行政区页为 null。 */
  parentName: string | null
  stats: AreaLandingStatsRow
  /** 在租套数最多的楼盘（顺序无关，函数内部按套数降序）。 */
  topBuildings: ReadonlyArray<Readonly<{ name: string; listingCount: number }>>
  /** 行政区页的下辖商圈（顺序无关）；商圈页传空数组。 */
  childAreas: ReadonlyArray<Readonly<{ name: string; listingCount: number }>>
}>

const count = (value: number) => value.toLocaleString('en-US')
const price = (value: number) => value.toFixed(2)
const yuan = (value: number) => `¥${count(value)}`

function byListingCountDesc<T extends Readonly<{ listingCount: number }>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.listingCount - a.listingCount)
}

const DESCRIPTION_SEPARATOR = '、'
const TOP_NAMES_IN_COPY = 3

export function buildAreaLandingCopy(input: AreaLandingCopyInput): AreaLandingCopy {
  const { cityName, location, parentName, stats } = input
  const name = location.name
  const priceSummary = summarizeAreaPrice(stats)
  const topBuildings = byListingCountDesc(input.topBuildings)
  const childAreas = byListingCountDesc(input.childAreas)
  // 商圈在描述里带上所属行政区（「上海浦东新区陆家嘴」），行政区则直接「上海徐汇区」。
  const place = location.kind === 'business_area' && parentName ? `${cityName}${parentName}${name}` : `${cityName}${name}`

  const title = `${name}写字楼出租 · 办公室租金与热门楼盘`

  const descriptionParts = [`${place}现有 ${count(stats.buildingCount)} 栋写字楼、${count(stats.listingCount)} 套在租办公室房源`]
  if (priceSummary) descriptionParts.push(`租金中位数 ${price(priceSummary.median)} 元/㎡/天（挂牌价）`)
  const description = `${descriptionParts.join('，')}，提供楼盘、租金区间与实时房源。`

  const topAreaNames = childAreas.slice(0, TOP_NAMES_IN_COPY).map((area) => area.name)
  const generatedIntro = [
    `${name}目前在平台上有 ${count(stats.buildingCount)} 栋写字楼在租，共 ${count(stats.listingCount)} 套有效房源。`,
    location.kind === 'district' && topAreaNames.length > 0 ? `在租房源主要分布在${topAreaNames.join(DESCRIPTION_SEPARATOR)}等商圈。` : '',
    location.kind === 'business_area' && parentName ? `${name}属于${parentName}。` : '',
    '以下数据来自平台当前在租房源，随房源上下架实时更新。',
  ].filter(Boolean).join('')
  const intro = location.description?.trim() || generatedIntro

  const faq: AreaLandingFaqItem[] = []

  if (priceSummary) {
    const other = stats.otherUnitCount > 0
      ? `另有 ${count(stats.otherUnitCount)} 套按其他单位或面议报价，因单位不可换算，未计入上述统计。`
      : ''
    faq.push({
      question: `${name}写字楼租金大概多少？`,
      answer: `${name}在租办公室的挂牌租金中位数约为 ${price(priceSummary.median)} 元/㎡/天，多数集中在 ${price(priceSummary.p25)}–${price(priceSummary.p75)} 元/㎡/天，最低 ${price(priceSummary.min)}、最高 ${price(priceSummary.max)} 元/㎡/天（共 ${count(priceSummary.sampleCount)} 套报价样本）。以上为平台在租房源的挂牌价，不是成交价，实际租金以洽谈为准。${other}`,
    })
    const { low, median, high } = priceSummary.monthlyFor100Sqm
    faq.push({
      question: `${name}租 ${ESTIMATE_AREA_SQM} 平方米的办公室，月租大概多少？`,
      answer: `按挂牌价中位数估算约 ${yuan(median)}/月，常见区间约 ${yuan(low)}–${yuan(high)}/月。估算方式为 日单价 × ${ESTIMATE_AREA_SQM}㎡ × ${ESTIMATE_DAYS_PER_MONTH} 天，未含物业费、停车费等，也不含押金；实际以具体房源报价为准。`,
    })
  }

  if (topBuildings.length > 0) {
    const names = topBuildings.slice(0, 5).map((building) => `${building.name}（${count(building.listingCount)} 套）`)
    faq.push({
      question: `${name}有哪些热门写字楼？`,
      answer: `按在租房源数量排序，${name}目前在租较多的写字楼有：${names.join(DESCRIPTION_SEPARATOR)}。数据随房源上下架变化。`,
    })
  }

  if (location.kind === 'district' && childAreas.length > 0) {
    const names = childAreas.slice(0, 6).map((area) => `${area.name}（${count(area.listingCount)} 套）`)
    faq.push({
      question: `${name}主要有哪些商圈？`,
      answer: `按在租房源数量排序，${name}在租房源较多的商圈有：${names.join(DESCRIPTION_SEPARATOR)}。`,
    })
  }

  faq.push({
    question: `${name}现在有多少套在租房源？`,
    answer: `目前平台共有 ${count(stats.listingCount)} 套有效在租房源，分布在 ${count(stats.buildingCount)} 栋写字楼。房源会随上下架实时变化，可点击页面下方入口查看全部。`,
  })

  return { title, description, intro, faq }
}
