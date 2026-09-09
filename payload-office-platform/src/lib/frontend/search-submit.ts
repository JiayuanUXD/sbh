/**
 * 房源搜索的 URL 拼装（OPT-075）。
 *
 * 首页 Hero 的 `HomeSearchPill` 与顶栏的 `HeaderSearch` 共用这一份。抽出来的理由不是
 * 复用几行代码，而是**避免两处各拼一份 query 而漂移**：参数名（q / district / type /
 * areaMin / areaMax）与「空值不写进 URL」这条约定必须两边一致，否则同一个词从两个入口
 * 搜出来会是两条不同的 canonical。
 *
 * 这里只负责拼 href，**不做任何规范化**——排序白名单、价格单位缺失时丢弃区间、
 * 非法区名剔出 canonical 等，全部由列表页服务端的
 * `domain/public-catalog/search-params.ts` 收敛。前台多拼一层校验只会制造第二个事实源。
 */

/** 关键词长度上限。与 `HomeSearchPill` 原有的 `.slice(0, 100)` 保持一致。 */
export const SEARCH_KEYWORD_MAX = 100

/** 房源列表页路径。多城路由下带城市前缀，否则走无前缀路由（由服务端 307 到默认城市）。 */
export function listingsPathFor(citySlug?: string): string {
  return citySlug ? `/${encodeURIComponent(citySlug)}/listings` : '/listings'
}

export type ListingSearchInput = Readonly<{
  q?: string
  district?: string
  type?: string
  /** 面积区间，编码为 `"<min>-<max>"`，空段表示不限（如 `"500-"`、`"-100"`）。 */
  area?: string
}>

/**
 * 拼出跳向房源列表页的 href。
 *
 * 参数顺序刻意固定（q → district → type → areaMin → areaMax），与
 * `buildCanonicalSearchParams` 的前几项同序，便于人眼比对；真正的 canonical 仍由服务端出。
 */
export function buildListingSearchHref(
  citySlug: string | undefined,
  input: ListingSearchInput,
): string {
  const params = new URLSearchParams()

  const q = (input.q ?? '').trim().slice(0, SEARCH_KEYWORD_MAX)
  if (q) params.set('q', q)
  if (input.district) params.set('district', input.district)
  if (input.type) params.set('type', input.type)
  if (input.area) {
    const [min, max] = input.area.split('-')
    if (min) params.set('areaMin', min)
    if (max) params.set('areaMax', max)
  }

  const qs = params.toString()
  const path = listingsPathFor(citySlug)
  return qs ? `${path}?${qs}` : path
}
