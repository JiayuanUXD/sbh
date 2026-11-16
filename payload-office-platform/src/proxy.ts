/**
 * OPT-098：主域名归一——www / CloudRun 默认域名 → shangban.cc（301）。
 *
 * 判定逻辑与名单在 src/lib/frontend/canonical-host.ts（纯函数，单测覆盖）；这里只接线。
 * matcher 排除 /api（CI 冒烟打旧域名的 /api/health）与 /_next（静态资源）。
 *
 * OPT-128：主域名 301 之后接爬虫守卫（src/lib/bot-guard）。matcher 额外显式放入
 * /api/mini/v1 与 /api/media/file（守卫要管的两类 API）；绝不放宽到整个 /api，
 * 否则 /api/health 冒烟也会进守卫。
 */
import { NextResponse, type NextRequest } from 'next/server'

import { runBotGuard } from '@/lib/bot-guard/runtime'
import { resolveCanonicalRedirect } from '@/lib/frontend/canonical-host'

export async function proxy(request: NextRequest) {
  const target = resolveCanonicalRedirect({
    host: request.headers.get('host'),
    forwardedHost: request.headers.get('x-forwarded-host'),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  })
  if (target) return NextResponse.redirect(target, 301)

  // OPT-128：只有落在主域名上的请求才进爬虫守卫，避免对同一请求双重计数。
  // 守卫内部 fail-open，这里不需要 try/catch。
  const blocked = await runBotGuard(request)
  return blocked ?? NextResponse.next()
}

export const config = {
  matcher: ['/((?!api$|api/|_next/).*)', '/api/mini/v1/:path*', '/api/media/file/:path*'],
}
