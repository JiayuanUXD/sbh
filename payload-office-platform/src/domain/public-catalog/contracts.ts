/**
 * 公开目录契约（Public Catalog DTO）
 *
 * 设计依据：specs/frontend-mvp/design.md §3.1、§7
 *
 * 这些类型是前台组件唯一允许消费的房源/楼盘/区域数据形态。
 * 它们与 Payload 内部文档完全隔离：
 *   - 不暴露审核、举报、商户资质、内部电话、权限、审计、精确内部坐标或工作版本
 *   - 媒体、价格、面积、时间和 SEO 使用统一值对象
 *   - 详情、卡片、聚合和结构化数据共用同一字段解释
 *
 * M4.7 统一有效供给服务未完成前，mapper 直接消费 Payload 文档；
 * 服务就绪后 mapper 改为消费服务输出，DTO 契约保持不变。
 */

import type {
  Listing,
  Building,
  Location,
  Media,
  Amenity,
  Page,
  Article,
} from '@/payload-types'

// ---------------------------------------------------------------------------
// 基础值对象
// ---------------------------------------------------------------------------

/** 公开媒体视图：仅暴露前台渲染所需字段 */
export type MediaViewModel = Readonly<{
  src: string
  width?: number
  height?: number
  alt: string
  blurDataURL?: string
}>

/**
 * 公开价格视图
 *
 * 始终保留数值、币种、计价周期和单位，禁止跨币种、跨单位直接聚合或排序
 * （specs/frontend-mvp/design.md §6.3、§7.4）。
 */
export type PriceViewModel = Readonly<{
  amount: number
  currency: 'CNY'
  businessType: 'lease' | 'sale'
  period: 'day' | 'month' | 'year' | 'one-time'
  basis: 'sqm' | 'seat' | 'total'
  displayUnit: 'rmb-sqm-day' | 'rmb-month' | 'rmb-seat-month' | 'rmb-total'
  /** 可读文本，如 "8.5 元/㎡/天" */
  text: string
}>

/** 公开区域视图：仅暴露 id/slug/name */
export type DistrictViewModel = Readonly<{
  id: number
  slug: string
  name: string
}>

/** Canonical city identity carried by every public listing/building DTO. */
export type PublicCityIdentity = Readonly<{
  citySlug: string
  cityName: string
}>

/** Minimal identity exposed only to legacy/correction redirect routes. */
export type PublicRouteIdentity = Readonly<{
  slug: string
  citySlug: string
}>

/** 公开楼盘摘要：用于卡片和详情中的楼盘信息 */
export type BuildingSummaryViewModel = Readonly<PublicCityIdentity & {
  id: number
  slug: string
  name: string
  address: string
  grade?: Building['grade']
  district?: DistrictViewModel
  coverImage?: MediaViewModel
  /** 楼盘一句话简介，用于详情页"所在楼盘"模块 */
  summary?: string
  /**
   * 地理坐标（高德 GCJ-02）；缺失时位置面板不渲染地图，仅展示静态地址。
   * P1 Task 3 引入，供 LocationPanel / AmapMapCanvas 使用。
   */
  coordinates?: CoordinatesViewModel
  /** 最近地铁站（P1 Task 3 位置面板静态区展示） */
  nearestMetro?: DistrictViewModel
  /** 在租面积（楼内有效房源面积总和，单位㎡）；楼盘列表页卡片展示 */
  leasableArea?: number
}>

/**
 * 地理坐标视图模型（高德 GCJ-02）。
 *
 * 与 location-services/contracts.Coordinates 解耦：public-catalog DTO 只承载
 * 已映射的公开数据，不依赖 provider 实现细节。
 */
export type CoordinatesViewModel = Readonly<{ latitude: number; longitude: number }>

// ---------------------------------------------------------------------------
// 卡片 DTO（ListingCardViewModel）
// ---------------------------------------------------------------------------

/**
 * 房源卡片视图模型
 *
 * 字段白名单依据 specs/frontend-mvp/design.md §7.2：
 *   id、slug、title、标准化价格、面积、类型、可入驻时间、
 *   楼盘名、行政区、商圈、一张公开封面、最多三个公开亮点、
 *   推荐标识及稳定排序键
 */
export type ListingCardViewModel = Readonly<PublicCityIdentity & {
  id: number
  slug: string
  title: string
  price: PriceViewModel | null
  area: number | null
  /** 历史房源缺失该字段时兼容为 lease。 */
  businessType: 'lease' | 'sale'
  decorationStatus: NonNullable<Listing['decorationStatus']> | null
  listingType: Listing['listingType']
  availableFrom: string | null
  isFeatured: boolean
  building: BuildingSummaryViewModel | null
  coverImage: MediaViewModel | null
  /** 最多三项公开亮点；空数组表示无 */
  highlights: readonly string[]
  /** 稳定排序收束键（不可变 listing_id） */
  stableSortKey: string
}>

export type DetailMediaViewModel = Readonly<{
  id: string
  kind: 'image' | 'floor-plan' | 'video'
  category: string
  resource: MediaViewModel
  capturedAt: string | null
  isSchematic: boolean
}>

export type FactValue = Readonly<{
  label: string
  value: string | null
  estimated: boolean
  critical: boolean
}>

export type FactGroupViewModel = Readonly<{
  id: string
  title: string
  facts: readonly FactValue[]
}>

export type AmenityGroupViewModel = Readonly<{
  id: string
  title: string
  items: readonly string[]
}>

export type VerificationViewModel = Readonly<{
  verifiedAt: string | null
  priceVerifiedAt: string | null
}>

export type BuildingSupplyGroup = 'lease' | 'sale' | 'coworking'

/** 楼盘供给的单一、不可跨用比较的价格区间。 */
export type BuildingSupplyPriceRange = Readonly<{
  /** businessType:currency:period:basis；仅相同 key 的价格可以聚合或比较。 */
  key: string
  businessType: PriceViewModel['businessType']
  currency: PriceViewModel['currency']
  period: PriceViewModel['period']
  basis: PriceViewModel['basis']
  displayUnit: PriceViewModel['displayUnit']
  min: number
  max: number
  count: number
}>

export type BuildingSupplyAreaRange = Readonly<{
  min: number
  max: number
}>

/** 未受页面 query 影响的业务组公开供给概览。 */
export type BuildingSupplyGroupAvailability = Readonly<{
  key: BuildingSupplyGroup
  totalEffectiveListings: number
  areaRange: BuildingSupplyAreaRange | null
  immediateAvailabilityCount: number
  priceRanges: readonly BuildingSupplyPriceRange[]
}>

/** 一个租赁、出售或联合办公供给组。 */
export type BuildingSupplyGroupViewModel = Readonly<{
  key: BuildingSupplyGroup
  listings: readonly ListingCardViewModel[]
  priceRanges: readonly BuildingSupplyPriceRange[]
  areaRange: BuildingSupplyAreaRange | null
  immediateAvailabilityCount: number
}>

/** 楼盘详情页在同一 asOf 时刻生成的供给快照。 */
export type BuildingSupplySnapshot = Readonly<{
  asOf: string
  /** 当前 query 对应的结果行和分组。 */
  groups: readonly BuildingSupplyGroupViewModel[]
  /** 未受 group/filter/sort query 影响的非空业务组和 canonical 聚合。 */
  availableGroups: readonly BuildingSupplyGroupAvailability[]
  /** 同一公开快照内的全部有效供给数。 */
  totalEffectiveListings: number
  /** 当前 query 对应的结果数。 */
  resultCount: number
  validationErrors: readonly 'price_unit_required'[]
}>

// ---------------------------------------------------------------------------
// 详情 DTO
// ---------------------------------------------------------------------------

/** 房源详情视图模型：完整卡片字段 + 详情专属公开数据。 */
export type ListingDetailViewModel = Readonly<ListingCardViewModel & {
  seats: number | null
  gallery: readonly MediaViewModel[]
  mediaItems: readonly DetailMediaViewModel[]
  factGroups: readonly FactGroupViewModel[]
  amenityGroups: readonly AmenityGroupViewModel[]
  verification: VerificationViewModel
  /** 富文本说明（Lexical JSON），由服务端白名单渲染 */
  description: Listing['description']
}>

/** 楼盘详情视图模型 */
export type BuildingDetailViewModel = Readonly<PublicCityIdentity & {
  id: number
  slug: string
  name: string
  address: string
  buildingType?: Building['buildingType']
  grade?: Building['grade']
  district?: DistrictViewModel
  businessDistrict?: DistrictViewModel
  nearestMetro?: DistrictViewModel
  coverImage: MediaViewModel | null
  gallery: readonly MediaViewModel[]
  mediaItems: readonly DetailMediaViewModel[]
  factGroups: readonly FactGroupViewModel[]
  amenityGroups: readonly AmenityGroupViewModel[]
  verification: VerificationViewModel
  amenities: readonly string[]
  summary: string
  description: Building['description']
  /**
   * 地理坐标（高德 GCJ-02）；缺失时位置面板不渲染地图，仅展示静态地址。
   * P1 Task 3 引入。
   */
  coordinates?: CoordinatesViewModel
}>

// ---------------------------------------------------------------------------
// Payload 文档类型别名（供 mapper 收窄使用）
// ---------------------------------------------------------------------------

/**
 * Payload find 返回的文档在 depth ≥ 1 时关系字段会被填充为完整对象。
 * 这里定义"已填充关系"的窄化类型，供 mapper 收窄用。
 * mapper 内部使用类型守卫验证后才视为已填充。
 */
export type PopulatedListing = Listing & {
  building: number | Building
  coverImage?: (number | null) | Media
  highlights?:
    | ReadonlyArray<{ text?: string | null; id?: string | null }>
    | null
}

export type PopulatedBuilding = Building & {
  district: number | Location
  businessDistrict?: (number | null) | Location
  nearestMetro?: (number | null) | Location
  coverImage?: (number | null) | Media
  gallery?:
    | ReadonlyArray<{ image?: (number | null) | Media; id?: string | null }>
    | null
  amenities?: readonly (number | Amenity)[] | null
}

// ---------------------------------------------------------------------------
// 内容页 DTO（PageDetailViewModel）
// ---------------------------------------------------------------------------

/**
 * 内容页 SEO 视图：仅暴露前台渲染所需字段
 *
 * 不暴露内部 _status、trash、createdBy、lastModifiedBy、deletedAt 等敏感字段。
 */
export type PageSeoViewModel = Readonly<{
  title: string | null
  description: string | null
}>

/**
 * 内容页 Hero 视图：eyebrow / heading / summary / 背景图
 */
export type PageHeroViewModel = Readonly<{
  eyebrow: string | null
  heading: string | null
  summary: string | null
  image: MediaViewModel | null
}>

/**
 * 内容页详情视图模型
 *
 * 字段白名单依据 specs/frontend-mvp/tasks.md F6.1 与 FP-06 §2–§5：
 *   - id / slug / title / status / hero / content / seo
 *   - 不暴露 _status / trash / createdAt / createdBy / lastModifiedBy / deletedAt 等内部字段
 *   - content 是 Lexical richText JSON，由 PageContent 组件按白名单节点类型渲染
 *
 * 草稿、逻辑删除或未发布的页面不会进入此 DTO（由 SupplyAdapter 与 Facade 过滤）。
 */
export type PageDetailViewModel = Readonly<{
  id: number
  slug: string
  title: string
  status: 'published'
  hero: PageHeroViewModel
  /** Lexical richText JSON；由 PageContent 组件按白名单节点渲染 */
  content: Page['content']
  seo: PageSeoViewModel
  /** 稳定排序收束键（page-<id>） */
  stableSortKey: string
  /** 页面最后更新时间（ISO 字符串），用于 sitemap lastModified；不可作为发布日期声明 */
  updatedAt: string
}>

/**
 * 内容页摘要视图模型：用于 sitemap 与列表
 *
 * 仅暴露 sitemap 与列表渲染所需的字段，不暴露 content / hero 详情。
 */
export type PageSummaryViewModel = Readonly<{
  id: number
  slug: string
  updatedAt: string
}>

/**
 * Payload Page 文档的窄化类型（depth ≥ 1 时 image 已填充为 Media）。
 * mapper 内部使用类型守卫验证后才视为已填充。
 */
export type PopulatedPage = Page & {
  hero?: {
    eyebrow?: string | null
    heading?: string | null
    summary?: string | null
    image?: (number | null) | Media
  } | null
}

// ---------------------------------------------------------------------------
// 资讯 DTO（ArticleCardViewModel）+ 首页商圈卡
// ---------------------------------------------------------------------------

/**
 * 资讯卡片视图模型：首页「资讯中心」分区 + /news 列表
 *
 * 字段白名单：id / slug / title / category / excerpt / coverImage / publishedAt。
 * 不暴露 content（富文本正文仅在详情页渲染）、seo、createdBy 等内部字段。
 * 草稿、逻辑删除的文章不会进入此 DTO（由 SupplyAdapter 过滤 status=published）。
 */
export type ArticleCardViewModel = Readonly<{
  id: number
  slug: string
  title: string
  category: Article['category'] | null
  excerpt: string | null
  coverImage: MediaViewModel | null
  publishedAt: string | null
  /** 稳定排序收束键（article-<id>） */
  stableSortKey: string
}>

/**
 * 首页商圈卡视图模型：区域 + 代表楼盘封面
 *
 * 封面由该商圈下一个有封面的公开楼盘派生（D6：不改 locations schema）。
 * 本期不计「在售房源数」--避免首页每次请求全量聚合有效房源；
 * 如需计数，后续可走 facet 缓存或 buildings 聚合字段。
 */
export type DistrictCardViewModel = Readonly<{
  id: number
  slug: string
  name: string
  coverImage: MediaViewModel | null
  /**
   * 代表楼盘名（最多 4 个，按 recommendedOrder 取）。
   *
   * 卡片在商圈名下方列出这几个名字，让用户一眼看出该商圈有什么楼——只有名字，
   * 不带链接，点击仍走整卡跳转。楼盘不足时按实有数量渲染，不补位。
   */
  buildings: readonly string[]
}>

/**
 * 资讯详情视图模型：/news/[slug] 详情页
 *
 * 在卡片白名单基础上增加 content（Lexical 富文本，仅详情页渲染）、
 * 关联楼盘/区域（可选，组件缺失时跳过）与 SEO。
 * 草稿、未发布、逻辑删除的资讯不会进入此 DTO。
 */
export type ArticleDetailViewModel = Readonly<{
  id: number
  slug: string
  title: string
  category: Article['category'] | null
  excerpt: string | null
  coverImage: MediaViewModel | null
  publishedAt: string | null
  content: Article['content']
  relatedBuildings: readonly BuildingSummaryViewModel[]
  relatedDistricts: readonly DistrictViewModel[]
  seo: Readonly<{ title: string | null; description: string | null }> | null
}>

/** 资讯列表结果：/news 列表页 */
export type ArticleListResult = Readonly<{
  docs: readonly ArticleCardViewModel[]
  totalDocs: number
  page: number
  totalPages: number
}>
