/**
 * 公开目录 Mapper
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§7
 *
 * Mapper 负责把 Payload 文档（或后续 M4.7 服务输出）投影成公开 DTO。
 * 组件只消费 DTO，不接收原始 Payload 文档。
 *
 * 安全规则（FRONTEND_AGENT.md §6.2）：
 *   - 字段白名单：不向浏览器暴露审核、举报、商户资质、内部电话、
 *     权限、审计、精确内部坐标或工作版本
 *   - 关系字段在 Payload depth ≥ 1 时为对象，depth = 0 时为 id；
 *     mapper 使用类型守卫安全收窄
 *   - 媒体统一映射为 MediaViewModel；缺失 alt 时回退到"楼盘名 + 空间类型"
 *   - 价格始终保留数值、币种、单位和可读文本
 */

import type { Listing, Building, Location, Media, Amenity, Page, Article } from '@/payload-types'
import type {
  BuildingDetailViewModel,
  BuildingSummaryViewModel,
  CoordinatesViewModel,
  DistrictViewModel,
  DistrictCardViewModel,
  ArticleCardViewModel,
  ArticleDetailViewModel,
  DetailMediaViewModel,
  FactGroupViewModel,
  AmenityGroupViewModel,
  ListingCardViewModel,
  ListingDetailViewModel,
  MediaViewModel,
  PageDetailViewModel,
  PageHeroViewModel,
  PageSeoViewModel,
  PageSummaryViewModel,
  PriceDisplayUnit,
  PriceViewBasis,
  PriceViewModel,
  PriceViewPeriod,
  PopulatedBuilding,
  PopulatedListing,
  PopulatedPage,
  PublicCityIdentity,
} from './contracts'
import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'
import { computeUsableArea, deriveSeatRange } from './detail-values'
import { normalizePublicMediaUrl } from './media-url'
import {
  BUILDING_TYPE_LABELS,
  REGISTRATION_CAPABILITY_LABELS,
} from '@/domain/supply/building'
import {
  COST_INCLUSION_STATUS_LABELS,
  DECORATION_STATUS_LABELS,
  FURNITURE_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
} from '@/domain/review/listing-fields'
import { formatAvailableDate } from '@/lib/frontend/format'

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isMedia(v: unknown): v is Media {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Media).id === 'number' &&
    typeof (v as Media).alt === 'string'
  )
}

function isLocation(v: unknown): v is Location {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Location).id === 'number' &&
    typeof (v as Location).slug === 'string' &&
    typeof (v as Location).name === 'string'
  )
}

/** Strictly maps an already-populated, active canonical city relationship. */
export function mapBuildingCity(building: unknown): PublicCityIdentity | null {
  if (!isObject(building)) return null
  const city = building.city
  if (!isLocation(city)) return null
  const normalizedSlug = normalizeCitySlug(city.slug)
  if (
    city.type !== 'city' ||
    city.status !== 'active' ||
    normalizedSlug === null ||
    city.slug !== normalizedSlug ||
    city.name.trim().length === 0
  ) {
    return null
  }
  return { citySlug: city.slug, cityName: city.name }
}

function isBuilding(v: unknown): v is Building {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Building).id === 'number' &&
    typeof (v as Building).slug === 'string' &&
    typeof (v as Building).name === 'string'
  )
}

function isAmenity(v: unknown): v is Amenity {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Amenity).id === 'number' &&
    typeof (v as Amenity).name === 'string'
  )
}

function isArticle(v: unknown): v is Article {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Article).id === 'number' &&
    typeof (v as Article).slug === 'string' &&
    typeof (v as Article).title === 'string'
  )
}

const PUBLIC_LISTING_TYPES = new Set<Listing['listingType']>([
  'traditional-office',
  'serviced-office',
  'coworking',
  'full-floor',
])

function isPopulatedListing(v: unknown): v is PopulatedListing {
  if (typeof v !== 'object' || v === null) return false
  const l = v as Partial<Listing>
  return (
    typeof l.id === 'number' &&
    typeof l.slug === 'string' &&
    typeof l.title === 'string' &&
    typeof l.listingType === 'string' &&
    PUBLIC_LISTING_TYPES.has(l.listingType as Listing['listingType'])
  )
}

function isPopulatedBuilding(v: unknown): v is PopulatedBuilding {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Partial<Building>
  return (
    typeof b.id === 'number' &&
    typeof b.slug === 'string' &&
    typeof b.name === 'string'
  )
}

// ---------------------------------------------------------------------------
// 基础值对象 mapper
// ---------------------------------------------------------------------------

/**
 * (period, basis) → displayUnit 的穷举映射。
 *
 * 必须是全映射，不允许 fallback。Record 类型让 TypeScript 在 period 或 basis
 * 新增取值时强制补齐这张表——历史上这里是一条 `? :` 链加一个 `'rmb-total'`
 * 兜底，导致 9 个组合里 6 个共用同一个 displayUnit，楼盘页按它分组筛选时会把
 * 月单价和年租金混作一类。
 */
const DISPLAY_UNIT_BY_PERIOD_BASIS: Record<
  PriceViewPeriod,
  Record<PriceViewBasis, PriceDisplayUnit>
> = {
  day: { sqm: 'rmb-sqm-day', seat: 'rmb-seat-day', total: 'rmb-day' },
  month: { sqm: 'rmb-sqm-month', seat: 'rmb-seat-month', total: 'rmb-month' },
  year: { sqm: 'rmb-sqm-year', seat: 'rmb-seat-year', total: 'rmb-year' },
  'one-time': { sqm: 'rmb-sqm-total', seat: 'rmb-seat-total', total: 'rmb-total' },
}

function priceKeyOf(
  period: PriceViewPeriod,
  basis: PriceViewBasis,
): Omit<PriceViewModel, 'amount' | 'businessType' | 'text'> {
  return {
    currency: 'CNY',
    period,
    basis,
    displayUnit: DISPLAY_UNIT_BY_PERIOD_BASIS[period][basis],
  }
}

const LEGACY_PRICE: Record<NonNullable<Listing['rentUnit']>, Omit<PriceViewModel, 'amount' | 'businessType' | 'text'>> = {
  'rmb-sqm-day': priceKeyOf('day', 'sqm'),
  'rmb-month': priceKeyOf('month', 'total'),
  'rmb-seat-month': priceKeyOf('month', 'seat'),
}

type BusinessTypeWarnHandler = (message: string) => void

const defaultBusinessTypeWarnHandler: BusinessTypeWarnHandler = (message) => {
  console.warn(message)
}

let businessTypeWarnHandler: BusinessTypeWarnHandler = defaultBusinessTypeWarnHandler

/**
 * 进程内已告警过的未知取值。
 *
 * 去重是必需的，不是优化：`publicBusinessType` 在每张卡片上会被调用两次（价格
 * 映射一次、卡片 businessType 字段一次），一个 24 条的列表页就是 48 行同样的日志。
 * 未知取值的**种类**是有限的（新增交易类型没接线），所以按值去重既保住信号又不刷屏。
 */
const warnedBusinessTypes = new Set<string>()

/**
 * 替换未知 businessType 的告警出口，返回还原函数（测试用）。
 *
 * mapper 是无 payload 依赖的纯函数模块，不能直接拿 payload.logger；用可替换的
 * handler 保持纯度，同时让「未知交易类型」这件事在测试里可断言。
 *
 * 换 handler 会清空去重集合：新 handler 是一个新的观察窗口，否则前一个用例触发过
 * 的取值会让后一个用例静默收不到告警。
 */
export function setBusinessTypeWarnHandler(handler: BusinessTypeWarnHandler): () => void {
  const previous = businessTypeWarnHandler
  businessTypeWarnHandler = handler
  warnedBusinessTypes.clear()
  return () => {
    businessTypeWarnHandler = previous
    warnedBusinessTypes.clear()
  }
}

/**
 * 把原始 businessType 收窄为公开枚举。
 *
 * 三种情况分开处理，不能一律静默降级：
 *   - 'lease' / 'sale'：正常透传
 *   - null / undefined：历史数据缺该字段，按 lease 兼容，属预期，不告警
 *   - 其余值：枚举外的取值。可能是新增交易类型（转让、代管）没接线，也可能是
 *     脏数据。必须留下信号——静默当作 lease 会让新类型排进租赁列表、按租金聚合，
 *     全程零报错，只能靠用户投诉发现。
 *
 * 取值需与 `@/domain/review/listing-fields` 的 BUSINESS_TYPES 保持一致；此处不
 * 直接导入，避免 public-catalog 反向依赖 review 层。
 */
function publicBusinessType(value: unknown): PriceViewModel['businessType'] {
  if (value === 'sale' || value === 'lease') return value
  if (value == null) return 'lease'
  const key = String(value)
  if (!warnedBusinessTypes.has(key)) {
    warnedBusinessTypes.add(key)
    businessTypeWarnHandler(
      `[public-catalog] 未知 businessType=${key}，已降级为 lease。` +
        `若这是新增的交易类型，需同步 BUSINESS_TYPES、PriceViewModel 与筛选白名单。`,
    )
  }
  return 'lease'
}

function createPrice(
  amount: number,
  businessType: PriceViewModel['businessType'],
  key: Omit<PriceViewModel, 'amount' | 'businessType' | 'text'>,
): PriceViewModel {
  return {
    amount,
    businessType,
    ...key,
    text: formatPriceText(amount, key.period, key.basis),
  }
}

function formatPriceText(
  amount: number,
  period: PriceViewModel['period'],
  basis: PriceViewModel['basis'],
): string {
  const basisText = basis === 'sqm' ? '元/㎡' : basis === 'seat' ? '元/工位' : '元'
  if (period === 'one-time') return `${amount} ${basisText}`
  const periodText = period === 'day' ? '天' : period === 'month' ? '月' : '年'
  return `${amount} ${basisText}/${periodText}`
}

/** 把 Listing.rent + rentUnit 投影为 PriceViewModel；rent 缺失或非法时返回 null */
export function mapPrice(
  rent: number | null | undefined,
  unit: Listing['rentUnit'],
  businessType: Listing['businessType'] = 'lease',
): PriceViewModel | null {
  if (typeof rent !== 'number' || !Number.isFinite(rent) || rent < 0) return null
  if (!unit) return null
  const key = LEGACY_PRICE[unit]
  return key ? createPrice(rent, publicBusinessType(businessType), key) : null
}

function mapStructuredPrice(
  raw: unknown,
  businessType: Listing['businessType'],
): PriceViewModel | null {
  if (!isObject(raw) || typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) || raw.amount < 0) {
    return null
  }
  if (raw.currency !== 'CNY') return null
  const basis: PriceViewBasis | null =
    raw.unit === 'sqm' || raw.unit === 'seat' ? raw.unit : raw.unit === 'suite' ? 'total' : null
  if (!basis) return null
  const period = raw.period
  if (period !== 'day' && period !== 'month' && period !== 'year' && period !== 'one-time') {
    return null
  }

  return createPrice(raw.amount, publicBusinessType(businessType), priceKeyOf(period, basis))
}

/** 把 Media 投影为 MediaViewModel；非媒体或无 url 返回 null */
export function mapMedia(
  raw: unknown,
  fallbackAlt: string,
): MediaViewModel | null {
  if (!isMedia(raw)) return null
  const url = normalizePublicMediaUrl(raw.url)
  if (!url) return null
  return {
    src: url,
    width: raw.width ?? undefined,
    height: raw.height ?? undefined,
    alt: raw.alt || fallbackAlt,
    blurDataURL: raw.blurDataUrl ?? undefined,
  }
}

/** 把 Location 投影为 DistrictViewModel */
export function mapDistrict(raw: unknown): DistrictViewModel | undefined {
  if (!isLocation(raw)) return undefined
  return { id: raw.id, slug: raw.slug, name: raw.name }
}

/**
 * 公开坐标精度：小数点后 4 位（约 11m，楼盘级近似坐标）。
 *
 * PRD（04-楼盘详情 §358 / 03-房源详情 §258）要求「高精度内部坐标不得进入 DTO」，
 * 故公开 DTO 仅暴露近似坐标；内部高精度距离计算（supply-adapter.proximitySquared）
 * 直接读原始坐标，不经此函数。位置服务（POI）消费此近似坐标，不消费内部高精度
 * 坐标（P1 Task 1 契约：Building DTO 的公开近似坐标）。
 */
export const PUBLIC_COORDINATE_PRECISION = 4

function roundToPrecision(value: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

/**
 * 把 Payload 楼盘坐标投影为 CoordinatesViewModel（高德 GCJ-02）。
 *
 * 非有限数字或超界（纬度 [-90,90]、经度 [-180,180]）返回 undefined，
 * 位置面板据此降级为静态地址卡片，不渲染地图。
 * 坐标舍入到 PUBLIC_COORDINATE_PRECISION 位小数，仅暴露公开近似坐标。
 */
export function mapCoordinates(
  latitude: unknown,
  longitude: unknown,
): CoordinatesViewModel | undefined {
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return undefined
  }
  if (latitude < -90 || latitude > 90) return undefined
  if (longitude < -180 || longitude > 180) return undefined
  return {
    latitude: roundToPrecision(latitude, PUBLIC_COORDINATE_PRECISION),
    longitude: roundToPrecision(longitude, PUBLIC_COORDINATE_PRECISION),
  }
}

/** 把 Building 投影为 BuildingSummaryViewModel；非楼盘返回 null */
export function mapBuildingSummary(raw: unknown): BuildingSummaryViewModel | null {
  if (!isBuilding(raw)) return null
  const city = mapBuildingCity(raw)
  if (!city) return null
  const populated = isPopulatedBuilding(raw) ? raw : null
  const districtRaw = populated?.district
  const coverRaw = populated?.coverImage
  return {
    ...city,
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    address: raw.address ?? '',
    grade: raw.grade ?? undefined,
    district: mapDistrict(districtRaw),
    coverImage: mapMedia(coverRaw, raw.name) ?? undefined,
    summary: raw.summary ?? undefined,
    coordinates: mapCoordinates(raw.latitude, raw.longitude),
    nearestMetro: mapDistrict(populated?.nearestMetro),
    completionDate: raw.completionDate ?? undefined,
    typicalFloorArea:
      typeof raw.developerAndScale?.typicalFloorArea === 'number'
        ? raw.developerAndScale.typicalFloorArea
        : undefined,
    // 与 mapBuildingFactGroups 的 services 组同一来源字段（buildingServices），
    // 房源概况面板（OPT-037 Task 3）与楼盘详情页「楼宇服务」不能各读一份。
    airConditioning: trimPublicText(raw.buildingServices?.airConditioning) ?? undefined,
    network: trimPublicText(raw.buildingServices?.network) ?? undefined,
    parkingFee: trimPublicText(raw.buildingServices?.parkingFee) ?? undefined,
  }
}

/**
 * 首页商圈卡：Location + 代表楼盘封面。
 *
 * 封面由 facade 从「有封面的公开楼盘」按商圈分组派生后传入；
 * 若该商圈暂无代表楼盘封面，coverImage 为 null（组件降级为纸色底卡片）。
 * 非区域返回 null。
 */
export function mapDistrictCard(
  raw: unknown,
  coverImage: MediaViewModel | null,
  buildings: readonly string[] = [],
): DistrictCardViewModel | null {
  if (!isLocation(raw)) return null
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    coverImage,
    buildings,
  }
}

/**
 * 把 Article 文档投影为 ArticleCardViewModel。
 *
 * 仅消费白名单字段；content/seo/审计字段不进入 DTO。
 * coverImage 缺失时为 null；publishedAt/category 缺失时为 null。
 * 非资讯或被逻辑删除的记录不应到达此函数（SupplyAdapter 已过滤），
 * 但仍以类型守卫兜底，返回 null 由上层跳过。
 */
export function mapArticleCard(raw: unknown): ArticleCardViewModel | null {
  if (!isArticle(raw)) return null
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    category: raw.category ?? null,
    excerpt: raw.excerpt ?? null,
    coverImage: mapMedia(raw.coverImage, raw.title),
    publishedAt: raw.publishedAt ?? null,
    stableSortKey: `article-${raw.id}`,
  }
}

/**
 * 把 Article 文档投影为 ArticleDetailViewModel（详情页）。
 *
 * 在卡片基础上增加 content、关联楼盘/区域与 SEO。
 * 关联字段在 depth ≥ 2 时为对象数组；非数组或缺失时为空数组。
 * 非资讯或被逻辑删除的记录不应到达此函数，仍以类型守卫兜底返回 null。
 */
export function mapArticleDetail(raw: unknown): ArticleDetailViewModel | null {
  if (!isArticle(raw)) return null
  const relatedBuildings: BuildingSummaryViewModel[] = []
  if (Array.isArray(raw.relatedBuildings)) {
    for (const b of raw.relatedBuildings) {
      const vm = mapBuildingSummary(b)
      if (vm) relatedBuildings.push(vm)
    }
  }
  const relatedDistricts: DistrictViewModel[] = []
  if (Array.isArray(raw.relatedDistricts)) {
    for (const d of raw.relatedDistricts) {
      const vm = mapDistrict(d)
      if (vm) relatedDistricts.push(vm)
    }
  }
  const seo = raw.seo
    ? {
        title: raw.seo.title ?? null,
        description: raw.seo.description ?? null,
      }
    : null
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    category: raw.category ?? null,
    excerpt: raw.excerpt ?? null,
    coverImage: mapMedia(raw.coverImage, raw.title),
    publishedAt: raw.publishedAt ?? null,
    content: raw.content ?? null,
    relatedBuildings,
    relatedDistricts,
    seo,
  }
}

// ---------------------------------------------------------------------------
// 卡片 DTO mapper
// ---------------------------------------------------------------------------

const MAX_CARD_HIGHLIGHTS = 3

/**
 * 把 Payload Listing 文档投影为 ListingCardViewModel。
 *
 * 输入视为 `unknown`，由类型守卫收窄；任何字段缺失都返回 null 而非抛错，
 * 让上层决定如何处理（404 / 空列表 / 错误状态）。
 */
export function mapListingCard(raw: unknown): ListingCardViewModel | null {
  if (!isPopulatedListing(raw)) return null
  const listing = raw as PopulatedListing

  const fullBuilding = mapBuildingSummary(listing.building)
  if (!fullBuilding) return null

  // 楼盘封面是房源封面的兜底来源（房源没自己的图时用楼盘的）。
  const rawCover = mapMedia(listing.coverImage, listing.title) ?? fullBuilding.coverImage ?? null

  /**
   * 卡片封面剔掉 `blurDataURL`（OPT-047）。
   *
   * 它是一段约 **480 字节**的 base64 内联占位图，而全仓**没有任何一处渲染它**——
   * `Media.tsx` 只在 props 类型里声明了这个字段，实现里既没传给 `<Image>` 的
   * `placeholder`/`blurDataURL`，也没做别的用途（2026-08-25 全仓核实）。
   *
   * 1000 张卡片 × 480 字节 ≈ **480KB**，占超限前总量的两成以上，纯粹是死重。
   *
   * **只在房源卡片这条链路剔**：`MediaViewModel` 是共享类型，详情页等其它消费方
   * 保持原样——万一将来真要做模糊占位图，那些路径不受影响（它们也不受 2MB 上限
   * 约束，因为不走全量数组缓存）。
   */
  const coverImage = rawCover ? { ...rawCover, blurDataURL: undefined } : null

  /**
   * 卡片里的 `building` **只保留卡片链路真正读取的字段**（OPT-047）。
   *
   * ## 为什么必须收窄
   *
   * 列表页的 `unstable_cache` 缓存的是**全量卡片数组**（刻意设计：让 `?page=2`
   * 不重跑最重的候选集查询）。所以条目体积 ∝ 该城市房源数 × 单张卡片大小。
   *
   * 生产实测：2,278,117 字节，**超过 Next.js 的 2MB 硬上限**，缓存写入被拒 →
   * `revalidate: 300` 完全没生效 → 这个路由每次请求都在真打库。而且**静默失败**：
   * 页面照常 200、响应时间也不突变，只有一行 stderr。
   *
   * 本地量得单张卡片 2160 字节，其中 `building` 占 1034（48%）、`coverImage` 占
   * 541（25%）。而 `blurDataURL`（约 480 字节的 base64 内联图）**被存了两遍**——
   * 一遍在 `card.coverImage`，一遍在 `card.building.coverImage`，
   * 后者在上面兜底用完之后就再没人读了。
   *
   * ## 剔掉的三个字段，逐个核实过零消费
   *
   * 全仓扫描接收 `ListingCardViewModel` 的 8 个模块，`building` 的实际读取只有：
   *   - `ListingResultCard` / `ListingResultRow`：`name`
   *   - `ListingCard`：`name` / `address` / `district` / `grade` / `nearestMetro`
   *
   * `coverImage` / `summary` 在卡片链路上引用 **0 次**。
   *（`coordinates` 起初也判为 0，但那是漏扫——首页「附近房源」在 domain 层用它
   * 算距离，见下方注释。教训：扫消费方不能只扫组件目录。）
   *（`leasableArea` / `listingCount` / `completionDate` 等同样是 0，但它们
   * 本来就只在楼盘卡片那条**另一条缓存**上有值，这里剔不剔无差别）。
   *
   * ## 为什么不改类型定义
   *
   * `BuildingSummaryViewModel` 同时被楼盘卡片与详情页复用，收窄类型会波及它们。
   * 这里只在**映射进房源卡片时**丢掉字段，类型保持不变（可选字段，缺失合法）。
   * 契约注释原本声明的白名单就是「楼盘名、行政区、商圈」——实现此前比契约更宽。
   */
  const {
    // 卡片链路零消费，且体积最大的三个（coverImage 含约 480 字节的 blur base64）
    coverImage: _buildingCover,
    summary: _summary,
    // ⚠️ `coordinates` **不能剔**：首页「附近房源」用它算距城市中心的距离
    //（facade.ts:983 的 haversineKm(cityCenter, c.building.coordinates)）。
    // 初版剔掉了，被 opt035-homepage-stats 那条测试抓住——我先前只扫了
    // src/components/frontend/，漏了 domain 层的消费方。
    // 它只有约 45 字节，留着无碍。
    // 楼盘卡片那条**另一条缓存**才用到的聚合字段，房源卡片上恒不读
    leasableArea: _leasableArea,
    listingCount: _listingCount,
    completionDate: _completionDate,
    typicalFloorArea: _typicalFloorArea,
    // 详情页字段（ListingOverviewPanel 读的是详情 DTO，不是卡片）
    airConditioning: _airConditioning,
    network: _network,
    parkingFee: _parkingFee,
    ...building
  } = fullBuilding

  const highlights: string[] = []
  if (Array.isArray(listing.highlights)) {
    for (const h of listing.highlights) {
      if (h && typeof h.text === 'string' && h.text.length > 0) {
        highlights.push(h.text)
      }
      if (highlights.length >= MAX_CARD_HIGHLIGHTS) break
    }
  }

  return {
    citySlug: building.citySlug,
    cityName: building.cityName,
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    price: mapStructuredPrice(listing.price, listing.businessType) ?? mapPrice(listing.rent, listing.rentUnit, listing.businessType),
    area: listing.area ?? null,
    floor: listing.floor ?? null,
    seats: listing.seats ?? null,
    businessType: publicBusinessType(listing.businessType),
    decorationStatus: listing.decorationStatus ?? null,
    listingType: listing.listingType,
    availableFrom: listing.availableFrom ?? null,
    isFeatured: listing.isFeatured === true,
    building,
    coverImage,
    highlights,
    stableSortKey: `listing-${listing.id}`,
  }
}

// ---------------------------------------------------------------------------
// 详情 DTO mapper
// ---------------------------------------------------------------------------

function trimPublicText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isDetailMediaKind(value: unknown): value is DetailMediaViewModel['kind'] {
  return value === 'image' || value === 'floor-plan' || value === 'video'
}

const LISTING_DETAIL_MEDIA_CATEGORIES = new Set(['workspace', 'meeting-room', 'common-area', 'exterior'])
const BUILDING_DETAIL_MEDIA_CATEGORIES = new Set(['exterior', 'lobby', 'common-area', 'facilities'])

function mapDetailMedia(
  items: unknown,
  fallbackAlt: string,
  categories: ReadonlySet<string>,
): readonly DetailMediaViewModel[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item, index) => {
    if (!isObject(item)) return []
    const resource = mapMedia(item.resource, fallbackAlt)
    if (!resource || !isDetailMediaKind(item.kind) || typeof item.category !== 'string' || !categories.has(item.category)) return []
    return [{
      id: `${resource.src}:${index}`,
      kind: item.kind,
      category: item.category,
      resource: { ...resource, alt: trimPublicText(item.alt) || resource.alt },
      capturedAt: typeof item.capturedAt === 'string' ? item.capturedAt : null,
      isSchematic: item.isSchematic === true,
    }]
  })
}

function publicValue(value: unknown, suffix = ''): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}${suffix}`
  return trimPublicText(value)
}

function fact(
  label: string,
  value: unknown,
  options: Readonly<{ estimated?: boolean; critical?: boolean; suffix?: string }> = {},
) {
  // `publicValue` 只对有限数字追加后缀，字符串值的后缀被忽略——`magnitude`/
  // `unit` 必须与那条既有规则完全一致，否则拆分形态与 `value` 会对不上。
  // 这里不是重算一遍 `value`，而是把 `publicValue` 内部本来就分开的两半
  // 一起暴露出去（见 contracts.ts `FactValue` 注释）。
  const magnitude = publicValue(value)
  const hasUnit =
    magnitude != null &&
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Boolean(options.suffix)
  return {
    label,
    value: publicValue(value, options.suffix),
    magnitude,
    unit: hasUnit ? options.suffix!.trim() : null,
    estimated: options.estimated === true,
    critical: options.critical === true,
  }
}

function mapVerification(raw: unknown) {
  const value = isObject(raw) ? raw : {}
  return {
    verifiedAt: typeof value.verifiedAt === 'string' ? value.verifiedAt : null,
    priceVerifiedAt: typeof value.priceVerifiedAt === 'string' ? value.priceVerifiedAt : null,
  }
}

function mapListingFactGroups(listing: PopulatedListing): readonly FactGroupViewModel[] {
  const details = isObject(listing.spaceDetails) ? listing.spaceDetails : {}
  const costs = isObject(listing.costTerms) ? listing.costTerms : {}
  const usableArea = computeUsableArea(
    typeof listing.area === 'number' ? listing.area : null,
    typeof details.efficiencyRate === 'number' ? details.efficiencyRate : null,
  )
  const seats = deriveSeatRange({
    seatMin: typeof details.seatMin === 'number' ? details.seatMin : null,
    seatMax: typeof details.seatMax === 'number' ? details.seatMax : null,
    suggestedSeats: typeof listing.seats === 'number' ? listing.seats : null,
    area: typeof listing.area === 'number' ? listing.area : null,
  })
  return [
    {
      id: 'space',
      title: '空间信息',
      facts: [
        fact('建筑面积', listing.area, { suffix: ' ㎡', critical: true }),
        fact('套内参考面积', usableArea?.amount ?? null, { suffix: ' ㎡', estimated: usableArea?.estimated === true }),
        fact('得房率', details.efficiencyRate, { suffix: '%' }),
        fact('工位数', seats ? `${seats.min}–${seats.max}` : null, { estimated: seats?.estimated === true }),
        fact('房源楼层', listing.floor),
        fact('朝向', details.orientation),
        fact('净层高', details.netCeilingHeight, { suffix: ' m' }),
        fact('可分割', details.isDivisible === true ? '可分割' : details.isDivisible === false ? '不可分割' : null),
      ],
    },
    {
      id: 'delivery',
      title: '装修与交付',
      facts: [
        fact(
          '装修',
          listing.decorationStatus ? DECORATION_STATUS_LABELS[listing.decorationStatus] : null,
        ),
        fact(
          '家具',
          details.furnitureStatus && details.furnitureStatus in FURNITURE_STATUS_LABELS
            ? FURNITURE_STATUS_LABELS[details.furnitureStatus as keyof typeof FURNITURE_STATUS_LABELS]
            : null,
        ),
        fact('可入驻日期', listing.availableFrom),
      ],
    },
    {
      id: 'cost',
      title: '费用条款',
      facts: [
        fact(
          '注册',
          listing.registrationStatus === 'available'
            ? '可注册'
            : listing.registrationStatus === 'conditional'
              ? '有条件注册'
              : listing.registrationStatus === 'unavailable'
                ? '不可注册'
                : listing.registrationStatus === 'confirm'
                  ? '咨询确认'
                  : null,
        ),
        fact('最短租期', listing.minimumLeaseMonths, { suffix: ' 个月' }),
        fact('付款方式', listing.paymentTerms),
        fact('押金月数', costs.depositMonths, { suffix: ' 个月' }),
        fact(
          '物业费',
          costs.propertyFeeInclusion && costs.propertyFeeInclusion in COST_INCLUSION_STATUS_LABELS
            ? COST_INCLUSION_STATUS_LABELS[
                costs.propertyFeeInclusion as keyof typeof COST_INCLUSION_STATUS_LABELS
              ]
            : null,
        ),
        fact('物业费金额', costs.propertyFeeAmount, { suffix: ' 元/㎡/月' }),
        fact(
          '发票',
          costs.invoiceStatus && costs.invoiceStatus in INVOICE_STATUS_LABELS
            ? INVOICE_STATUS_LABELS[costs.invoiceStatus as keyof typeof INVOICE_STATUS_LABELS]
            : null,
        ),
        fact('其他固定费用', costs.otherFixedCosts),
      ],
    },
    {
      id: 'verification',
      title: '信息时效',
      facts: [
        fact('信息核验时间', listing.verificationInfo?.verifiedAt),
        fact('价格核验时间', listing.verificationInfo?.priceVerifiedAt),
      ],
    },
  ]
}

function mapBuildingFactGroups(building: PopulatedBuilding): readonly FactGroupViewModel[] {
  const scale = isObject(building.developerAndScale) ? building.developerAndScale : {}
  const transport = isObject(building.verticalTransport) ? building.verticalTransport : {}
  const services = isObject(building.buildingServices) ? building.buildingServices : {}
  return [
    {
      id: 'identity',
      title: '身份与注册',
      facts: [
        fact(
          '物业类型',
          building.buildingType ? BUILDING_TYPE_LABELS[building.buildingType] : null,
        ),
        fact(
          '楼宇等级',
          building.grade === 'grade-a'
            ? '甲级'
            : building.grade === 'super-grade-a'
              ? '超甲级'
              : building.grade === 'creative-park'
                ? '创意园区'
                : building.grade === 'serviced-office'
                  ? '服务式办公'
                  : null,
        ),
        fact(
          '注册能力',
          building.registrationCapability
            ? REGISTRATION_CAPABILITY_LABELS[building.registrationCapability]
            : null,
        ),
      ],
    },
    {
      id: 'building',
      title: '建筑信息',
      facts: [
        fact('竣工时间', building.completionDate),
        fact('总楼层', building.totalFloors, { suffix: ' 层' }),
        fact('总建筑面积', scale.grossFloorArea, { suffix: ' ㎡' }),
        fact('标准层面积', scale.typicalFloorArea, { suffix: ' ㎡' }),
        fact('标准层高', scale.standardFloorHeight, { suffix: ' m' }),
        fact('净层高', scale.netCeilingHeight, { suffix: ' m' }),
        fact('得房率', scale.efficiencyRate, { suffix: '%' }),
      ],
    },
    {
      id: 'property',
      title: '开发物业',
      facts: [
        fact('开发商', scale.developer),
        fact('物业公司', building.propertyCompany),
        fact('物业费', building.propertyFee, { suffix: ' 元/㎡/月' }),
      ],
    },
    {
      id: 'transport',
      title: '电梯与停车',
      facts: [
        fact('客梯', transport.passengerElevators, { suffix: ' 部' }),
        fact('货梯', transport.freightElevators, { suffix: ' 部' }),
        fact('分区说明', transport.zoningNote),
        fact('停车位', building.parkingSpaces, { suffix: ' 个' }),
        fact('停车费', services.parkingFee),
      ],
    },
    {
      id: 'services',
      title: '楼宇服务',
      facts: [
        fact('空调', services.airConditioning),
        fact('网络', services.network),
        fact('供电', services.powerSupply),
        fact('门禁', services.accessControl),
        fact('服务时间', services.serviceHours),
      ],
    },
  ]
}

function isCertificationPublicAt(
  item: NonNullable<Building['certifications']>[number],
  asOf: Date,
): boolean {
  if (item.publicVisible !== true || !trimPublicText(item.name)) return false
  if (!Number.isFinite(asOf.getTime())) return false
  const validFrom = item.validFrom == null ? null : Date.parse(item.validFrom)
  const validTo = item.validTo == null ? null : Date.parse(item.validTo)
  if (item.validFrom != null && !Number.isFinite(validFrom)) return false
  if (item.validTo != null && !Number.isFinite(validTo)) return false
  const instant = asOf.getTime()
  return (validFrom == null || validFrom <= instant) && (validTo == null || instant < validTo)
}

function mapBuildingAmenityGroups(
  building: PopulatedBuilding,
  asOf: Date,
): readonly AmenityGroupViewModel[] {
  const amenities = Array.isArray(building.amenities)
    ? building.amenities.flatMap((item) => isAmenity(item) ? [item.name] : [])
    : []
  const certifications = Array.isArray(building.certifications)
    ? building.certifications.flatMap((item) => isCertificationPublicAt(item, asOf) ? [item.name.trim()] : [])
    : []
  return [
    { id: 'amenities', title: '配套', items: amenities },
    { id: 'certifications', title: '认证', items: certifications },
  ]
}

/**
 * 把 Payload Listing 文档投影为 ListingDetailViewModel。
 *
 * 详情 DTO 在卡片字段上增加画廊、楼盘摘要和富文本说明。
 * 画廊来源：房源 coverImage + 房源 legacy gallery，去重后保留有效 url。
 */
export function mapListingDetail(raw: unknown): ListingDetailViewModel | null {
  const card = mapListingCard(raw)
  if (!card) return null
  const listing = raw as PopulatedListing

  const gallery: MediaViewModel[] = []
  const listingCover = mapMedia(listing.coverImage, listing.title)
  if (listingCover) gallery.push(listingCover)

  if (Array.isArray(listing.gallery)) {
    for (const g of listing.gallery) {
      if (!g || typeof g !== 'object') continue
      const img = (g as { image?: unknown }).image
      const media = mapMedia(img, listing.title)
      if (media && !gallery.some((m) => m.src === media.src)) {
        gallery.push(media)
      }
    }
  }

  return {
    ...card,
    seats: listing.seats ?? null,
    gallery,
    mediaItems: mapDetailMedia(listing.mediaItems, listing.title, LISTING_DETAIL_MEDIA_CATEGORIES),
    factGroups: mapListingFactGroups(listing),
    amenityGroups: [{ id: 'highlights', title: '亮点', items: card.highlights }],
    verification: mapVerification(listing.verificationInfo),
    description: listing.description,
  }
}

/** 把 Payload Building 文档投影为 BuildingDetailViewModel */
export function mapBuildingDetail(
  raw: unknown,
  asOfInput: string | Date = new Date(),
): BuildingDetailViewModel | null {
  if (!isPopulatedBuilding(raw)) return null
  const building = raw as PopulatedBuilding
  const city = mapBuildingCity(building)
  if (!city) return null
  const asOf = asOfInput instanceof Date ? asOfInput : new Date(asOfInput)

  const coverImage = mapMedia(building.coverImage, building.name) ?? null

  const gallery: MediaViewModel[] = []
  if (coverImage) gallery.push(coverImage)
  if (Array.isArray(building.gallery)) {
    for (const g of building.gallery) {
      if (!g || typeof g !== 'object') continue
      const img = (g as { image?: unknown }).image
      const media = mapMedia(img, building.name)
      if (media && !gallery.some((m) => m.src === media.src)) {
        gallery.push(media)
      }
    }
  }

  const amenities: string[] = []
  if (Array.isArray(building.amenities)) {
    for (const a of building.amenities) {
      if (isAmenity(a)) amenities.push(a.name)
    }
  }

  return {
    ...city,
    id: building.id,
    slug: building.slug,
    name: building.name,
    address: building.address ?? '',
    buildingType: building.buildingType ?? undefined,
    grade: building.grade ?? undefined,
    district: mapDistrict(building.district),
    businessDistrict: mapDistrict(building.businessDistrict),
    nearestMetro: mapDistrict(building.nearestMetro),
    coverImage,
    gallery,
    mediaItems: mapDetailMedia(building.mediaItems, building.name, BUILDING_DETAIL_MEDIA_CATEGORIES),
    factGroups: mapBuildingFactGroups(building),
    amenityGroups: mapBuildingAmenityGroups(building, asOf),
    verification: mapVerification(building.verificationInfo),
    amenities,
    summary: building.summary ?? '',
    description: building.description,
    coordinates: mapCoordinates(building.latitude, building.longitude),
  }
}

// ---------------------------------------------------------------------------
// 内容页 DTO mapper（F6.1）
// ---------------------------------------------------------------------------

/**
 * 类型守卫：判断输入是否为已填充关系的 Page 文档
 *
 * Page 文档必须包含 id / slug / title；status 可选（默认 published）。
 * 不要求 status='published'，因为发布状态过滤由 SupplyAdapter 负责；
 * mapper 只负责字段投影。
 */
function isPopulatedPage(v: unknown): v is PopulatedPage {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Partial<Page>
  return (
    typeof p.id === 'number' &&
    typeof p.slug === 'string' &&
    typeof p.title === 'string'
  )
}

/**
 * 把 Payload Page 文档投影为 PageDetailViewModel。
 *
 * 字段白名单：只暴露 id / slug / title / status / hero / content / seo / updatedAt；
 * 不暴露 createdBy / lastModifiedBy / deletedAt / _status 等内部字段。
 *
 * 草稿、删除或未发布页面不应进入此 mapper（由 SupplyAdapter 过滤）；
 * 若上游错误传入，mapper 仍返回 null（守护不变量）。
 */
export function mapPageDetail(raw: unknown): PageDetailViewModel | null {
  if (!isPopulatedPage(raw)) return null
  const page = raw as PopulatedPage

  const heroRaw = page.hero
  const heroImageRaw = heroRaw?.image
  const heroImage = mapMedia(heroImageRaw, page.title)
  const hero: PageHeroViewModel = {
    eyebrow: heroRaw?.eyebrow ?? null,
    heading: heroRaw?.heading ?? null,
    summary: heroRaw?.summary ?? null,
    image: heroImage,
  }

  const seoRaw = page.seo
  const seo: PageSeoViewModel = {
    title: seoRaw?.title ?? null,
    description: seoRaw?.description ?? null,
  }

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    status: 'published',
    hero,
    content: page.content ?? null,
    seo,
    stableSortKey: `page-${page.id}`,
    updatedAt: page.updatedAt,
  }
}

/**
 * 把 Payload Page 文档投影为 PageSummaryViewModel（用于 sitemap）。
 *
 * 仅暴露 id / slug / updatedAt；不暴露 content / hero / seo 详情。
 */
export function mapPageSummary(raw: unknown): PageSummaryViewModel | null {
  if (!isPopulatedPage(raw)) return null
  const page = raw as PopulatedPage
  return {
    id: page.id,
    slug: page.slug,
    updatedAt: page.updatedAt,
  }
}
