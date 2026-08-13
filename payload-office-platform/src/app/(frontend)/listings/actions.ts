'use server'

import {
  createSearchContext,
  getSearchFacets,
  parseListingSearchInput,
} from '@/domain/public-catalog'
import { siteConfig } from '@/lib/frontend/site-config'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { isPublicCitySlug } from '@/lib/frontend/city-routes'

/**
 * 估算给定筛选条件下的房源数（OPT-009）
 *
 * 移动端筛选抽屉在暂存条件变化时调用，实时显示候选结果数。
 * 与列表页 totalDocs 使用同一 facet/total 口径（getSearchFacets），
 * 保证抽屉中 N 与提交后列表页 N 一致。
 *
 * 设计取舍：
 *   - 复用 getSearchFacets（内部 page=1/sort=recommended 宽松 input），
 *     不走 searchListings，避免分页/排序开销
 *   - 失败返回 null，调用方 fallback 到已应用条件 totalDocs
 */
export async function estimateListingCount(
  filters: Record<string, string>,
  requestedCitySlug?: string,
): Promise<number | null> {
  try {
    const candidateCitySlug = requestedCitySlug ?? siteConfig.defaultCity
    if (!isPublicCitySlug(candidateCitySlug)) return null
    const city = await resolveCityContext(candidateCitySlug)
    if (!city || city.serviceStatus !== 'live') return null
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v)
    }
    const input = parseListingSearchInput(params)
    const ctx = createSearchContext(city.slug)
    const facets = await getSearchFacets(input, ctx)
    return facets.totalDocs
  } catch {
    return null
  }
}
