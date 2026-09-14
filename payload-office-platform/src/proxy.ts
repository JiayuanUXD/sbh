/**
 * OPT-098：主域名归一——www / CloudRun 默认域名 → shangban.cc（301）。
 *
 * 判定逻辑与名单在 src/lib/frontend/canonical-host.ts（纯函数，单测覆盖）；这里只接线。
 * matcher 排除 /api（CI 冒烟打旧域名的 /api/health）与 /_next（静态资源）。
 */
import { NextResponse, type NextRequest } from 'next/server'

import { resolveCanonicalRedirect } from '@/lib/frontend/canonical-host'

export function proxy(request: NextRequest) {
  const target = resolveCanonicalRedirect({
    host: request.headers.get('host'),
    forwardedHost: request.headers.get('x-forwarded-host'),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
  })
  return target ? NextResponse.redirect(target, 301) : NextResponse.next()
}

export const config = {
  matcher: ['/((?!api$|api/|_next/).*)'],
}
