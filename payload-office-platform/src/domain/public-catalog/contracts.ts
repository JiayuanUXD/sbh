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

/** 公开楼盘摘要：用于卡片和详情中的楼盘信息 */
export type BuildingSummaryViewModel = Readonly<{
  id: number
  slug: string
  name: string
  address: string
  grade?: Building['grade']
  district?: DistrictViewModel
  coverImage?: MediaViewModel
  /** 楼盘一句话简介，用于详情页"所在楼盘"模块 */
  summary?: string
}>

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
export type ListingCardViewModel = Readonly<{
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

// ---------------------------------------------------------------------------
// 详情 DTO
// ---------------------------------------------------------------------------

/** 房源详情视图模型：卡片字段 + 公开画廊 + 楼盘摘要 + 富文本说明 */
export type ListingDetailViewModel = Readonly<{
  id: number
  slug: string
  title: string
  price: PriceViewModel | null
  area: number | null
  seats: number | null
  listingType: Listing['listingType']
  availableFrom: string | null
  isFeatured: boolean
  building: BuildingSummaryViewModel | null
  coverImage: MediaViewModel | null
  gallery: readonly MediaViewModel[]
  mediaItems: readonly DetailMediaViewModel[]
  factGroups: readonly FactGroupViewModel[]
  amenityGroups: readonly AmenityGroupViewModel[]
  verification: VerificationViewModel
  highlights: readonly string[]
  /** 富文本说明（Lexical JSON），由服务端白名单渲染 */
  description: Listing['description']
  /** 稳定排序收束键 */
  stableSortKey: string
}>

/** 楼盘详情视图模型 */
export type BuildingDetailViewModel = Readonly<{
  id: number
  slug: string
  name: string
  address: string
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
