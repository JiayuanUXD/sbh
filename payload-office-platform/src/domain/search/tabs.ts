/**
 * 站内搜索的 URL 参数解析。
 *
 * `q` 只做 trim + 100 字截断；真正的归一化（NFKC / 分词 / 转义）在
 * `normalizeSearchQuery`。`tab` 白名单外的值一律回到 `all`，不抛错——
 * 手改 URL 不应该 500。`page` 上限 10000，与列表页同口径。
 */

export const SEARCH_TABS = ['all', 'listings', 'buildings', 'news'] as const

export type SearchTab = (typeof SEARCH_TABS)[number]

export type SiteSearchParams = Readonly<{
  q: string
  tab: SearchTab
  page: number
}>

function firstString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

export function parseSearchTab(value: string | string[] | undefined): SearchTab {
  const raw = firstString(value)
  return raw && (SEARCH_TABS as readonly string[]).includes(raw) ? (raw as SearchTab) : 'all'
}

export function parseSearchPage(value: string | string[] | undefined): number {
  const raw = firstString(value)
  if (!raw) return 1
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(parsed, 10000)
}

export function parseSiteSearchParams(
  raw: Readonly<Record<string, string | string[] | undefined>>,
): SiteSearchParams {
  const q = Array.from((firstString(raw.q) ?? '').trim()).slice(0, 100).join('')
  return {
    q,
    tab: parseSearchTab(raw.tab),
    page: parseSearchPage(raw.page),
  }
}
