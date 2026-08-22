import { revalidateTag } from 'next/cache'

import {
  ARTICLES_CATEGORY_TAG,
  PUBLIC_CACHE_TAG_PREFIX,
  SITEMAP_TAG,
  cityLevelSafeInvalidationTags,
} from '@/domain/public-catalog'

const PAGES_CATEGORY_TAG = `${PUBLIC_CACHE_TAG_PREFIX}:pages`

function revalidatePublicCacheTags(
  tags: readonly string[],
  reason: string,
): void {
  const failedTags: Array<{ tag: string; error: string }> = []

  for (const tag of new Set(tags)) {
    try {
      revalidateTag(tag, 'max')
    } catch (error) {
      failedTags.push({
        tag,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (failedTags.length > 0) {
    console.error('[public-cache-revalidation] failed', {
      reason,
      failedTags,
    })
  }
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

/**
 * 批量导入写入 Job 完成后 / 批次回滚成功后触发的供给缓存失效（OPT-041 D11）。
 *
 * 背景：`lib/frontend/cached-queries.ts` 里 listing/building 相关查询用
 * `unstable_cache` 包了 `revalidate: 300` 的 5 分钟兜底 TTL，但导入与回滚链路此前
 * 都不调用任何失效函数——"确认后 N 套房源将立即对外可见"与"一键下架"的止血承诺，
 * 全部要靠这个 TTL 才会生效，最长滞后 5 分钟。
 *
 * 导入/回滚一次可能影响多个楼盘/房源、跨多个城市，不像单条 listing.published 事件
 * 那样能精确算出受影响 tag，复用 `cache-tags.ts` 已经定义好的"城市级安全失效"策略
 * （`cityLevelSafeInvalidationTags`）：能解析出城市 slug 就按城市失效
 * home/facets/listings/buildings + sitemap；一个都解析不出来（比如批次的 validRows
 * 快照已过 7 天清空窗口）就退化到该函数自带的类目级 + sitemap 全城市兜底——降级语义
 * 由那个函数本身承担，这里不重新发明。
 */
export function invalidateSupplyImportPublicCache(
  citySlugs: readonly string[],
  reason: 'supply_import' | 'supply_import_rollback',
): void {
  const tags = new Set<string>()
  const resolvedSlugs = citySlugs.filter((slug) => slug.trim() !== '')
  const slugGroups = resolvedSlugs.length > 0 ? resolvedSlugs : [null]
  for (const slug of slugGroups) {
    for (const tag of cityLevelSafeInvalidationTags(slug)) tags.add(tag)
  }
  revalidatePublicCacheTags([...tags], reason)
}
