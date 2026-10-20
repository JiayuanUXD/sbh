/**
 * 站内搜索输入联想（OPT-122 Phase 3）。
 *
 * GET `/[city]/search/suggestions?q=…` → `{ suggestions: [{ kind, name, parentName?, href }] }`
 *
 * 设计约束：
 *   - 只读 GET，无副作用；词表走 `getCachedSearchVocabulary`（按城市 300s 缓存），
 *     本路由只做内存过滤，不碰库；
 *   - 响应 `no-store`：内容派生自用户实时输入，不进共享缓存；
 *   - 未知城市返回空列表（200）而不是 404：联想是增强，不该把错误暴露成请求失败；
 *   - 只回公开字段（kind/name/parentName/href），不回 id/slug/拼音等内部结构。
 */

import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { buildSearchSuggestions } from '@/domain/search/suggestions'
import { getCachedSearchVocabulary } from '@/lib/frontend/cached-queries'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 与搜索页 `q` 的上限保持一致（normalize.ts 的 100 字）。 */
const MAX_QUERY_LENGTH = 100

export async function GET(
  request: Request,
  { params }: { params: Promise<{ city: string }> },
): Promise<Response> {
  const { city: slug } = await params
  const q = new URL(request.url).searchParams.get('q') ?? ''
  if (q.trim().length === 0) {
    return Response.json({ suggestions: [] })
  }

  const city = await resolveCityContext(slug)
  if (!city) return Response.json({ suggestions: [] })

  const vocabulary = await getCachedSearchVocabulary(slug)
  const suggestions = buildSearchSuggestions(vocabulary, q.slice(0, MAX_QUERY_LENGTH)).map(
    (suggestion) => ({
      kind: suggestion.kind,
      name: suggestion.name,
      ...(suggestion.parentName != null ? { parentName: suggestion.parentName } : {}),
      href: suggestion.href,
    }),
  )

  return Response.json(
    { suggestions },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
