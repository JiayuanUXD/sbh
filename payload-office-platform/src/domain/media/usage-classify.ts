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

/**
 * 从文档里取出某个路径下的 media id，兼容单值与数组（array 字段展开后是数组）、
 * 裸数字 id 与 `depth>0` 时展开出来的 `{ id, ... }` 对象两种形态。
 *
 * 这是「路径写错 → 该分类计数静默归零」这个失效模式的直接责任方——
 * `backfill-media-usage.ts` 的 `REFERENCE_SOURCES` 路径一旦拼错，不会报错，
 * 只会让这个函数对每份文档都返回空数组，因此专门拆出来独立测试。
 */
export function extractMediaIds(doc: Record<string, unknown>, path: string): number[] {
  const segments = path.split('.')
  let current: unknown[] = [doc]
  for (const segment of segments) {
    const next: unknown[] = []
    for (const node of current) {
      if (node && typeof node === 'object') {
        const value = (node as Record<string, unknown>)[segment]
        if (Array.isArray(value)) next.push(...value)
        else if (value != null) next.push(value)
      }
    }
    current = next
  }
  const ids: number[] = []
  for (const value of current) {
    if (typeof value === 'number') ids.push(value)
    else if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'number') {
      ids.push((value as { id: number }).id)
    }
  }
  return ids
}
