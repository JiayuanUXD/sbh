import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { siteConfig } from '@/lib/frontend/site-config'

/**
 * 无城市前缀的搜索入口（兼容路由）。
 *
 * 搜索页是城市作用域的：`/[city]/search`。旧 `/search?q=` 不做第二套页面，
 * 直接 307 到默认城市，保留 q / tab / page；与 `/listings` 的兼容策略一致。
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '搜索',
  robots: { index: false, follow: true },
}

type SearchParams = Record<string, string | string[] | undefined>

export default async function LegacySearchPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const raw = await searchParams
  const params = new URLSearchParams()

  for (const key of ['q', 'tab', 'page'] as const) {
    const value = raw[key]
    if (typeof value === 'string') params.set(key, value)
    else if (Array.isArray(value) && typeof value[0] === 'string') params.set(key, value[0])
  }

  const query = params.toString()
  redirect(`/${siteConfig.defaultCity}/search${query ? `?${query}` : ''}`)
}
