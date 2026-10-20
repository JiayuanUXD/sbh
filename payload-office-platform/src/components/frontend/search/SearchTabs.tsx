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
}: Readonly<{
  basePath: string
  q: string
  tab: SearchTab
  counts: Readonly<Record<SearchTab, number>>
}>) {
  const hrefOf = (target: SearchTab) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (target !== 'all') params.set('tab', target)
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
