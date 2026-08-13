import { revalidateTag } from 'next/cache'

import {
  ARTICLES_CATEGORY_TAG,
  PUBLIC_CACHE_TAG_PREFIX,
  SITEMAP_TAG,
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
