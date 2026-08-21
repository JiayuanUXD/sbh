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
 * 公开价格计价周期。`one-time` 为一次性计价（出售），无周期含义。
 *
 * 注意与 `./types` 的 `PricePeriod` 区分：那个是**搜索输入**侧的类型，取值只有
 * `'day' | 'month'`，因为旧 `rentUnit` URL 参数只能表达这两种。此处是价格**视图
 * 模型**侧的完整取值域。两者不可互换，故不共用名字。
 */
export type PriceViewPeriod = 'day' | 'month' | 'year' | 'one-time'

/** 公开价格计价基础：按面积 / 按工位 / 按整体。 */
export type PriceViewBasis = 'sqm' | 'seat' | 'total'

/**
 * 公开价格展示单位：period × basis 的完整笛卡尔积（4 × 3 = 12）。
 *
 * 每个 (period, basis) 组合必须映射到**唯一**的 displayUnit，不允许兜底桶。
 * 楼盘详情页按 displayUnit 分组筛选（`BUILDING_SUPPLY_PRICE_UNITS`），一旦两个
 * 语义不同的组合共用同一个值，「筛某个单位」就会同时命中不可比的价格——例如
 * 月单价与一次性总价并排出现。历史上 `rmb-total` 曾是「其余全归这里」的兜底
 * 桶（9 个组合里有 6 个落进去），出售总价接入前已收窄为专指 one-time + total。
 *
 * 命名规则：`rmb-{basis}-{period}`，其中 basis=total 时省略 basis 段，
 * period=one-time 时写作 `total`。保持四个历史值不变以兼容既有 URL 与
 * `enum_supply_submissions_rent_unit`。
 */
export type PriceDisplayUnit =
  // basis = sqm
  | 'rmb-sqm-day'
  | 'rmb-sqm-month'
  | 'rmb-sqm-year'
  | 'rmb-sqm-total'
  // basis = seat
  | 'rmb-seat-day'
  | 'rmb-seat-month'
  | 'rmb-seat-year'
  | 'rmb-seat-total'
  // basis = total（省略 basis 段）
  | 'rmb-day'
  | 'rmb-month'
  | 'rmb-year'
  | 'rmb-total'

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
  period: PriceViewPeriod
  basis: PriceViewBasis
  displayUnit: PriceDisplayUnit
  /** 可读文本，如 "8.5 元/㎡/天"；one-time 不带周期后缀，如 "38000000 元" */
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
  /**
   * 在租套数（楼内有效房源计数）；口径与 leasableArea 完全一致——同一次
   * SupplyAdapter.aggregateEffectiveSupplyByBuildings 聚合、同一批有效供给谓词、
   * 强制 businessType='lease'（与调用方当前频道无关，理由同 leasableArea：出售
   * 频道页上的楼盘卡片同样只应统计在租套数，不能把待售房源计进去）。
   * 缺失/0 语义与 leasableArea 相同：不出现在聚合结果里的楼盘视为「暂无在租」，
   * 不渲染 0。楼盘列表页卡片展示。
   */
  listingCount?: number
  /** 竣工日期（ISO 字符串）；楼盘列表页 completedAfter 筛选与 completion-desc 排序用 */
  completionDate?: string
  /**
   * 标准层面积（单位㎡），来自 Buildings.developerAndScale.typicalFloorArea——
   * 楼盘固有属性，与在租状态无关（详情页「建筑信息」事实行已在用同一个字段，
   * 见 mappers.ts getBuildingDetail 的 fact('标准层面积', scale.typicalFloorArea)）。
   * 楼盘列表页「暂无在租」紧凑行用它替代 leasableArea——那是在租面积，对暂无
   * 在租的楼盘恒为 undefined，语义上不能顶替标准层面积。
   */
  typicalFloorArea?: number
  /**
   * 楼宇级空调 / 网络 / 停车费说明（自由文本），来自
   * `Buildings.buildingServices.{airConditioning,network,parkingFee}`——与楼盘
   * 详情页「楼宇服务」事实行（mappers.ts mapBuildingFactGroups 的 services 组）
   * 同一来源字段，不是另开一份数据。
   *
   * OPT-037 Task 3 review 补充：房源概况面板原判定这三项「DTO 未暴露」为
   * 结构性省略，但字段本身在 Buildings collection 上存在，属于映射缺口而非
   * 数据缺口——缺口能以一次低成本映射补齐时应该补，不应该设计成看不见。
   */
  airConditioning?: string
  network?: string
  parkingFee?: string
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
 *
 * `floor` / `seats`（OPT-037 Task 7 补充）：楼盘详情供给密度表按业务组区分
 * 列（租赁/出售显示「面积」、联合办公显示「工位数」），这两个字段在
 * `Listings` collection 早已存在（`floor` 文本、`seats` 建议工位数），此前只是
 * 未映射进本 DTO——按三层判定顺序，第 2 层（mapper 缺映射）即须补，不能因为
 * 只有本任务这一个消费方就跳过。两者都可能为 null（历史房源未填写）。
 */
export type ListingCardViewModel = Readonly<PublicCityIdentity & {
  id: number
  slug: string
  title: string
  price: PriceViewModel | null
  area: number | null
  /** 楼层（文本，如「9」「9-12」），历史房源可能未填写。 */
  floor: string | null
  /** 建议工位数，仅联合办公类房源常用；历史房源 / 非工位计价房源可能为 null。 */
  seats: number | null
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
  /**
   * 展示串，**含**单位后缀（"42000 ㎡"、"28 层"）。既有消费方
   * （`DetailFacts`、`SpecTable` 系列、`HeroSummaryPanel`）读的一直是它，
   * 语义未变——下面两个字段是**新增的拆分形态**，不是它的替代品。
   */
  value: string | null
  /**
   * 「大数值 + 独立单位」版式用的拆分形态：`value === magnitude + unit`
   * （无后缀时 `unit` 为 null、`magnitude === value`）。
   *
   * 为什么要有它：`fact()` 在 mapper 里把数值与单位后缀拼成一个串，之后
   * 谁也拆不回来——想把数值排 32px、单位排 14px（无图替代构图
   * `NoImageHeroGrid` 的宫格）就只剩「对着 value 做字符串解析」这一条路，
   * 而那正是 Task 2 明确拒绝的做法。所以在**唯一知道后缀是什么的地方**
   * （`fact()` 自己）把两半一起产出，而不是让消费方去猜。
   *
   * 刻意做成**追加**而非改 `value` 的语义：`value` 被四处消费，把它改成
   * 裸值会让另外三个面板的单位静默消失——正是本项目反复栽的那个坑。
   * 键值行（`SpecTable` / `DetailFacts`）继续读 `value`，只有需要拆分版式
   * 的调用方读这两个。
   */
  magnitude?: string | null
  unit?: string | null
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
  /**
   * 工位数区间（联合办公组的「可选工位」聚合口径）。
   *
   * 与 `areaRange` 并列而不是让视图层自己遍历 `listings` 现算：`availableGroups`
   * 里根本没有 `listings`（它是未过滤口径的概览），视图层要展示未过滤的工位区间
   * 就只能拿到过滤后的行去算，口径立刻和 `areaRange` 分叉。聚合归聚合层。
   */
  seatRange: BuildingSupplyAreaRange | null
  immediateAvailabilityCount: number
  priceRanges: readonly BuildingSupplyPriceRange[]
}>

/** 一个租赁、出售或联合办公供给组。 */
export type BuildingSupplyGroupViewModel = Readonly<{
  key: BuildingSupplyGroup
  listings: readonly ListingCardViewModel[]
  priceRanges: readonly BuildingSupplyPriceRange[]
  areaRange: BuildingSupplyAreaRange | null
  seatRange: BuildingSupplyAreaRange | null
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

// ---------------------------------------------------------------------------
// 首页扩展 DTO（OPT-035 Task 3：stats / typeSummaries / nearbyListings）
// ---------------------------------------------------------------------------

/**
 * 首页统计计数：三个数字与全站列表页/楼盘列表页/商圈链接同口径。
 *
 *   - listings：当前城市全部有效房源数（口径同 buildListingSearchSource 全集）
 *   - buildings：当前城市全部有效公开楼盘数（口径同 searchBuildings 的 totalDocs）
 *   - businessAreas：当前城市前台可见商圈数（口径同「全部 N 个商圈」链接）
 */
export type HomepageStats = Readonly<{
  listings: number
  buildings: number
  businessAreas: number
}>

/** 首页按房源类型（listingType）聚合的计数与代表封面。 */
export type HomepageTypeSummary = Readonly<{
  count: number
  cover: MediaViewModel | null
}>

/**
 * 首页「核心商圈附近房源」卡片：标准房源卡片 + 到城市中心的直线距离（km，保留 1 位小数）。
 */
export type NearbyListingViewModel = Readonly<
  ListingCardViewModel & { distanceKm: number }
>
