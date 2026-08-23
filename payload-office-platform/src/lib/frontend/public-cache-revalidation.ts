import { revalidateTag } from 'next/cache'

import {
  ARTICLES_CATEGORY_TAG,
  IMMEDIATE_CACHE_EXPIRE_PROFILE,
  PUBLIC_CACHE_TAG_PREFIX,
  SITEMAP_TAG,
  cityLevelSafeInvalidationTags,
} from '@/domain/public-catalog'

const PAGES_CATEGORY_TAG = `${PUBLIC_CACHE_TAG_PREFIX}:pages`

/**
 * `revalidateTag` 在没有 Next 请求上下文时抛的 invariant 文案。
 * Job / 脚本 / 种子里的写入走不到请求上下文，每个 tag 都会以同一个原因失败——
 * 那是"这条链路本来就没法失效"，不是"失效坏了"，不该按错误逐条上报。
 */
const MISSING_REQUEST_SCOPE_HINT = 'static generation store missing'

function revalidatePublicCacheTags(
  tags: readonly string[],
  reason: string,
): void {
  const uniqueTags = [...new Set(tags)]
  const failedTags: Array<{ tag: string; error: string }> = []

  for (const tag of uniqueTags) {
    try {
      // 档位必须是硬失效，不能用 'max'（那会放行一次陈旧读）。
      // 完整原因见 domain/public-catalog/cache-tags.ts 的 IMMEDIATE_CACHE_EXPIRE_PROFILE 注释。
      revalidateTag(tag, IMMEDIATE_CACHE_EXPIRE_PROFILE)
    } catch (error) {
      failedTags.push({
        tag,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (failedTags.length === 0) return

  // 全部 tag 都因为"不在请求上下文"失败 → 整条链路不具备失效条件，降级成一条 warn。
  // 部分失败仍按 error 上报：那才是真的丢了失效，必须刺眼。
  const allOutOfScope =
    failedTags.length === uniqueTags.length &&
    failedTags.every(({ error }) => error.includes(MISSING_REQUEST_SCOPE_HINT))

  if (allOutOfScope) {
    console.warn('[public-cache-revalidation] skipped_outside_request_scope', {
      reason,
      tagCount: uniqueTags.length,
    })
    return
  }

  console.error('[public-cache-revalidation] failed', {
    reason,
    failedTags,
  })
}

export function invalidatePagePublicCache(): void {
  revalidatePublicCacheTags(
    [
      PAGES_CATEGORY_TAG,
      SITEMAP_TAG,
    ],
    'page',
  )
}

export function invalidateArticlePublicCache(): void {
  revalidatePublicCacheTags(
    [
      ARTICLES_CATEGORY_TAG,
      SITEMAP_TAG,
    ],
    'article',
  )
}

export function invalidateCitySiteProfilePublicCache(
  tags: readonly string[],
  reason: 'city_site_profile' | 'location',
): void {
  revalidatePublicCacheTags(tags, reason)
}

/** 触发供给缓存失效的来源。房源与楼盘的公开可见性口径不同，日志要能分辨。 */
export type SupplyCacheInvalidationReason = 'listing' | 'building'

/** 批量导入 / 批次回滚触发的失效来源（OPT-041 D11）。 */
export type SupplyImportCacheInvalidationReason = 'supply_import' | 'supply_import_rollback'

/**
 * 供给相关的「城市级安全失效」。
 *
 * 为什么是城市级而不是按 listingId 精确失效：
 * `lib/frontend/cached-queries.ts` 里的 `unstable_cache` 只能在闭包里静态声明 tags，
 * 一条房源同时出现在城市列表、首页精选、facet 计数、楼盘详情的房源块、sitemap 里，
 * 这些缓存项挂的都是城市级/类目级 tag，没有一个挂 `public:listing:<id>`。
 * 只失效具体 tag 等于什么都没失效——所以复用 `cityLevelSafeInvalidationTags`
 * 已经定义好的城市级集合。具体 tag 留给将来启用 Cache Components `cacheTag` 时用。
 *
 * @param citySlugs 受影响城市。传空数组或全空串 → 退化为该函数自带的类目级全城市兜底。
 */
function invalidateCityLevelSupplyCache(
  citySlugs: readonly string[],
  reason: string,
): void {
  const tags = new Set<string>()
  const resolved = citySlugs.filter((slug) => slug.trim() !== '')
  // 一个城市都解析不出来时用 [null] 触发 cityLevelSafeInvalidationTags 的兜底分支，
  // 降级语义由那个函数承担，这里不重新发明。
  for (const slug of resolved.length > 0 ? resolved : [null]) {
    for (const tag of cityLevelSafeInvalidationTags(slug)) tags.add(tag)
  }
  revalidatePublicCacheTags([...tags], reason)
}

/** 房源/楼盘单条变化后的公开目录缓存失效（Listings / Buildings 的 afterChange 接线）。 */
export function invalidateSupplyPublicCache(
  citySlugs: readonly string[],
  reason: SupplyCacheInvalidationReason,
): void {
  invalidateCityLevelSupplyCache(citySlugs, reason)
}

/**
 * 批量导入写入 Job 完成后 / 批次回滚成功后触发的供给缓存失效（OPT-041 D11）。
 *
 * 背景：listing/building 相关查询用 `unstable_cache` 包了 `revalidate: 300` 的
 * 5 分钟兜底 TTL，但导入与回滚链路此前都不调用任何失效函数——「确认后 N 套房源
 * 将立即对外可见」与「一键下架」的止血承诺，全部要靠这个 TTL 才会生效，最长滞后
 * 5 分钟。导入/回滚一次可能影响多个楼盘/房源、跨多个城市，不像单条 listing.published
 * 事件那样能精确算出受影响 tag，同样走上面的城市级安全失效。
 */
export function invalidateSupplyImportPublicCache(
  citySlugs: readonly string[],
  reason: SupplyImportCacheInvalidationReason,
): void {
  invalidateCityLevelSupplyCache(citySlugs, reason)
}
