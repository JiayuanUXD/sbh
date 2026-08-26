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

/**
 * 站点设置（OPT-053）固定 tag。不区分城市——它是全平台单例。
 *
 * logo 与页脚出现在**每一个页面**上，所以这条 tag 的失效面是全站。
 * 注意 `OPT-042` 未解：CloudRun 多实例下 `revalidateTag` 只作用于当前实例，
 * 其余实例要等 TTL 自然过期。站点设置的 TTL 因此刻意压到 60 秒
 * （见 `SITE_SETTINGS_REVALIDATE_SECONDS`），后台也明写了「最长 60 秒生效」。
 */
export const SITE_SETTINGS_TAG = `${PUBLIC_CACHE_TAG_PREFIX}:site-settings` as const

/**
 * 站点设置的缓存 TTL（秒）。
 *
 * 比其它公开查询的 300 秒短得多，理由不是它变得更频繁——恰恰相反，它极少变。
 * 短 TTL 买的是**多实例下的收敛速度**：运营改完 logo 却要等五分钟才全站一致，
 * 会被直接理解成「功能坏了」，而那正是 OPT-053 这个工作项的起因。
 */
export const SITE_SETTINGS_REVALIDATE_SECONDS = 60

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
 * `revalidateTag` 的失效档位：立即过期，不留 stale-while-revalidate 窗口。
 *
 * Next 16 起 `revalidateTag(tag, profile)` 第二参数必填。档位决定的不是
 * "重新验证多久"，而是**这次失效有多硬**——两条路径在 Next 内部完全不同：
 *
 *   - 传 `'max'`（内置档位 `{stale:300, revalidate:2592000, expire:31536000}`）：
 *     `revalidation-utils` 只取 `expire` 传给 cache handler，于是 tag 被写成
 *     `{ stale: now, expired: now + 一年 }`。读取时 `areTagsExpired` 为 false、
 *     `areTagsStale` 为 true → `incremental-cache` 返回 `isStale: true` →
 *     `unstable_cache` 走 SWR 分支：**先把陈旧值返回给这一个请求**，同时后台刷新。
 *     结果就是"下架后紧接着的一次读仍然看得到已下架内容，再下一次才正确"。
 *   - 传 `{ expire: 0 }`：tag 被写成 `{ stale: now, expired: now }`，
 *     `areTagsExpired` 为 true → `incremental-cache.get` 直接返回 null → 硬 miss →
 *     当前请求就回源。零陈旧窗口。
 *
 * 公开目录的失效全部由"内容已不该再对外可见/已变化"驱动（下架、驳回、举报暂停、
 * 批次回滚），**放行一次陈旧读等于放行一次错误的对外可见性**，所以这里统一用硬失效。
 * 代价是失效瞬间该城市缓存被清空，并发请求会各自回源一次（`unstable_cache` 没有
 * 跨请求 single-flight）；相对 300s 兜底 TTL 本来就会发生的回源，这个尖峰是可接受的。
 *
 * 不要为了消掉 `revalidateTag` 不传第二参数的 deprecation 警告而改回 `'max'`——
 * 那个警告说的是"参数必填"，不是"必须用 max"。`tests/public-cache-immediate-expiry.test.ts`
 * 直接跑 Next 自己的 tags-manifest 守护这条语义。
 */
export const IMMEDIATE_CACHE_EXPIRE_PROFILE = { expire: 0 } as const

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
