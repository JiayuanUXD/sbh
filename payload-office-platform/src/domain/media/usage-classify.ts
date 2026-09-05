/**
 * OPT-069 存量媒体的 `usage` 判定（spec §6.1）。
 *
 * 反查引用，命中即定，优先级 listing-photo > article > brand > other。
 * 优先级的理由：一张图既被房源引用又被首页背景引用时，**打水印的代价可逆**
 * （media-source/ 留着干净原件），而漏打不可逆。所以往「要打水印」的那一侧靠。
 */

export type MediaUsage = 'listing-photo' | 'article' | 'brand' | 'other'

export type MediaReferenceCounts = {
  /** Listings / Buildings 的相册、封面、平面图资源 */
  listingPhoto: number
  /** Articles 封面 */
  article: number
  /** SiteSettings / Pages / Locations / CitySiteProfiles */
  brand: number
  /** ListingReports 的举报截图 */
  report: number
}

export function classifyMediaUsage(counts: MediaReferenceCounts): MediaUsage {
  if (counts.listingPhoto > 0) return 'listing-photo'
  if (counts.article > 0) return 'article'
  if (counts.brand > 0) return 'brand'
  return 'other'
}
