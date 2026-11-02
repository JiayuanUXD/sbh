import Link from 'next/link'

import type { SearchTab } from '@/domain/search/tabs'

const TAB_LABEL: Readonly<Record<SearchTab, string>> = {
  all: '全部',
  listings: '房源',
  buildings: '楼盘',
  news: '资讯',
}

const TAB_ORDER: readonly SearchTab[] = ['all', 'listings', 'buildings', 'news']

/**
 * 搜索类型 tab。
 *
 * 用链接而不是 ARIA tablist：每个 tab 是独立 URL，可分享、可后退、可被搜索引擎
 * 当作不同状态；用 tablist 就得补方向键与 roving tabindex，收益为零。
 */
export default function SearchTabs({
  basePath,
  q,
  tab,
  counts,
  intentEnabled = true,
}: Readonly<{
  basePath: string
  q: string
  tab: SearchTab
  counts: Readonly<Record<SearchTab, number>>
  /** 用户关闭了条件识别（`ni=1`）时，切 tab 要带着，否则一点 tab 就悄悄恢复识别。 */
  intentEnabled?: boolean
}>) {
  const hrefOf = (target: SearchTab) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (target !== 'all') params.set('tab', target)
    if (!intentEnabled) params.set('ni', '1')
    const query = params.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  return (
    <nav className="sw-tabs" aria-label="搜索结果类型">
      {TAB_ORDER.map((key) => (
        <Link
          key={key}
          href={hrefOf(key)}
          aria-current={tab === key ? 'page' : undefined}
          className={tab === key ? 'sw-tab sw-tab--active' : 'sw-tab'}
        >
          {TAB_LABEL[key]}
          <span className="sw-tab__count">{counts[key]}</span>
        </Link>
      ))}
    </nav>
  )
}
