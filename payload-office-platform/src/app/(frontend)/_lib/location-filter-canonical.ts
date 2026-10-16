import type { Metadata } from 'next'
import { getCachedAreaLandingIndex } from '@/lib/frontend/cached-queries'
import { resolveAreaLandingCanonicalPath, withAreaLandingCanonical } from '@/lib/frontend/area-landing-canonical'
import { getMultiCityRoutingEnabled, siteConfig } from '@/lib/frontend/site-config'

/**
 * 房源 / 楼盘列表路由共用：纯地点筛选页（`?district=` / `?businessArea=`）的 canonical 合并到
 * 区域落地页（OPT-119 §2.2）。两个路由各自算好 canonical 查询串后调用，不在路由里各写一份判断。
 *
 * 落地页只在多城路由开启时可索引（前缀路径本身否则 noindex），所以开关关闭时不合并；未开通城市
 * 没有落地页，同样不合并（也不查库）。
 */
export async function withLocationFilterCanonical(
  base: Metadata,
  input: Readonly<{ citySlug: string; serviceStatus: 'live' | 'coming-soon'; canonicalQuery: string }>,
): Promise<Metadata> {
  if (input.serviceStatus !== 'live' || !getMultiCityRoutingEnabled()) return base
  const landingPath = await resolveAreaLandingCanonicalPath(input.citySlug, input.canonicalQuery, getCachedAreaLandingIndex)
  return landingPath ? withAreaLandingCanonical(base, landingPath, siteConfig.siteOrigin) : base
}
