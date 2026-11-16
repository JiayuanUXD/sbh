/**
 * 公开列表页码封顶（OPT-128 §5.7）。
 *
 * 深翻页是爬虫枚举全量数据的主要路径，也会触发大 OFFSET 扫描。
 * 封顶只作用于**分页元数据与 SQL 偏移**：`parsePage` 仍放宽到 10000，
 * 这样越界页码（如 ?page=51）能被视图层判定为「越界空态」，而不是静默改成别的页。
 */
export const MAX_PUBLIC_PAGE = 50 as const

/** 真实总页数 → 对外可翻页数。 */
export function capTotalPages(realTotalPages: number): number {
  return Math.min(realTotalPages, MAX_PUBLIC_PAGE)
}

/** 真实总页数是否超过上限（即有页被隐藏）。 */
export function isCapped(realTotalPages: number): boolean {
  return realTotalPages > MAX_PUBLIC_PAGE
}
