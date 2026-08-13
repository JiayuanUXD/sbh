/**
 * 公开目录缓存 tag 体系（design.md §9.2 / F6.5）
 *
 * 职责：
 *   - 统一定义 home / listings / listing / building / facets / page / sitemap tag 命名规则
 *   - 提供 tag 构建函数，Facade 与 cache-invalidator 共用
 *   - 提供"无法安全计算局部影响"时的城市级安全失效集合
 *
 * 不变量（design.md §9.2）：
 *   - Listing 发布/审核/冻结/举报/媒体/可用性变化 → 失效 listing + 楼盘 + 城市列表/facet/sitemap
 *   - Building/区域状态变化 → 失效 building + 城市列表/facet/sitemap
 *   - 商户关系/资格/服务城市变化 → 无法安全计算局部影响 → 城市级安全失效
 *   - Page 变化 → 失效 page + sitemap
 *
 * Tag 命名约定（design.md §9.2）：
 *   - public:home:{city}
 *   - public:listings:{queryHash}
 *   - public:listing:{listingId}
 *   - public:building:{buildingId}
 *   - public:facets:{city}
 *   - public:page:{slug}
 *   - public:sitemap
 *
 * Supply cache tags always use a concrete canonical city slug.
 */

/** Tag 前缀：所有公开目录 tag 共用，避免与后台 tag 冲突 */
export const PUBLIC_CACHE_TAG_PREFIX = 'public' as const

/** sitemap 固定 tag（不区分城市，sitemap 包含全量公开 URL） */
export const SITEMAP_TAG = `${PUBLIC_CACHE_TAG_PREFIX}:sitemap` as const

/** 资讯列表/详情类别 tag */
export const ARTICLES_CATEGORY_TAG = `${PUBLIC_CACHE_TAG_PREFIX}:articles` as const

/** Conservative supply categories used when an owning city cannot be resolved. */
export const LISTINGS_CATEGORY_TAG = `${PUBLIC_CACHE_TAG_PREFIX}:listings` as const
export const BUILDINGS_CATEGORY_TAG = `${PUBLIC_CACHE_TAG_PREFIX}:buildings` as const

/**
 * 首页 tag：按城市区分
 * @param city Canonical city slug
 */
export function homeTag(city: string): string {
  return `${PUBLIC_CACHE_TAG_PREFIX}:home:${city}`
}

/**
 * 房源详情 tag：按 listingId 区分
 */
export function listingTag(listingId: number | string): string {
  return `${PUBLIC_CACHE_TAG_PREFIX}:listing:${listingId}`
}

/**
 * 楼盘详情 tag：按 buildingId 区分
 */
export function buildingTag(buildingId: number | string): string {
  return `${PUBLIC_CACHE_TAG_PREFIX}:building:${buildingId}`
}

/**
 * 房源列表 tag：按查询哈希区分
 *
 * queryHash 由 canonical 搜索参数派生（Facade 已实现 buildCanonicalSearchParams）。
 * MVP 阶段不缓存具体列表查询，仅在城市级安全失效时批量清除。
 * 保留此函数供未来按查询缓存使用。
 */
export function listingsTag(queryHash: string): string {
  return `${PUBLIC_CACHE_TAG_PREFIX}:listings:${queryHash}`
}

/** City-scoped listing category for per-city cache invalidation. */
export function listingsCityTag(city: string): string {
  return `${LISTINGS_CATEGORY_TAG}:city:${city}`
}

/** City-scoped building category for per-city cache invalidation. */
export function buildingsCityTag(city: string): string {
  return `${BUILDINGS_CATEGORY_TAG}:city:${city}`
}

/**
 * 搜索 facet tag：按城市区分
 */
export function facetsTag(city: string): string {
  return `${PUBLIC_CACHE_TAG_PREFIX}:facets:${city}`
}

/**
 * 内容页 tag：按 slug 区分
 */
export function pageTag(slug: string): string {
  return `${PUBLIC_CACHE_TAG_PREFIX}:page:${slug}`
}

/**
 * 城市级安全失效 tag 集合
 *
 * 当无法安全计算局部影响时（如商户关系/资格/服务城市变化），
 * 失效城市级列表、facet、首页与 sitemap，不延长陈旧窗口。
 *
 * @param city Canonical affected city slug, or null for category-wide fallback
 */
export function cityLevelSafeInvalidationTags(city: string | null): readonly string[] {
  if (!city) {
    return [LISTINGS_CATEGORY_TAG, BUILDINGS_CATEGORY_TAG, SITEMAP_TAG]
  }
  return [
    homeTag(city),
    facetsTag(city),
    listingsCityTag(city),
    buildingsCityTag(city),
    SITEMAP_TAG,
  ]
}

/**
 * 全量公开目录 tag（用于全量失效场景）
 *
 * 注意：Next.js revalidateTag 不支持通配符，但支持精确 tag。
 * 全量失效需要逐个调用 revalidateTag，或使用 revalidatePath('/')。
 * 此处仅提供 tag 列表，由调用方决定失效策略。
 */
export const ALL_PUBLIC_CACHE_TAG_GROUPS = [
  'home',
  'listings',
  'listing',
  'building',
  'facets',
  'page',
  'articles',
  'sitemap',
] as const

/**
 * 判断 tag 是否属于公开目录缓存
 */
export function isPublicCacheTag(tag: string): boolean {
  return tag.startsWith(`${PUBLIC_CACHE_TAG_PREFIX}:`)
}
