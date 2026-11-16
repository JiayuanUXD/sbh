/**
 * 请求归类（纯函数）。判定顺序固定：
 * 方法 → 预取 → 站点地图 → 媒体 → mini 读 → 其余 /api、/_next、/admin、
 * /robots.txt、/favicon.ico、带文件扩展名的末段 → 剩余为 page。
 */
export type GuardClass = 'page' | 'sitemap' | 'media' | 'mini-read' | 'exempt'

const MINI_READ_PATTERN = /^\/api\/mini\/v1\/(?:home|listings|buildings)(?:\/|$)/

export function classifyPath(
  input: Readonly<{ method: string; pathname: string; isPrefetch: boolean }>,
): GuardClass {
  const method = input.method.toUpperCase()
  // Server Action 的 POST、OPTIONS 等不计配额
  if (method !== 'GET' && method !== 'HEAD') return 'exempt'
  // Next 预取是浏览器自发行为，不代表人在翻页
  if (input.isPrefetch) return 'exempt'

  const { pathname } = input
  if (pathname === '/sitemap.xml' || pathname.startsWith('/sitemaps/')) return 'sitemap'
  if (pathname.startsWith('/api/media/file/')) return 'media'
  if (MINI_READ_PATTERN.test(pathname)) return 'mini-read'

  if (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/_next' ||
    pathname.startsWith('/_next/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/robots.txt' ||
    pathname === '/favicon.ico'
  ) {
    return 'exempt'
  }

  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1)
  if (lastSegment.includes('.')) return 'exempt'

  return 'page'
}

/** 是否预取请求：Next 路由预取、浏览器 purpose / sec-purpose 任一声明即算。 */
export function readIsPrefetch(get: (name: string) => string | null): boolean {
  if (get('next-router-prefetch') === '1') return true
  const purpose = get('purpose')
  if (purpose !== null && purpose.toLowerCase().includes('prefetch')) return true
  const secPurpose = get('sec-purpose')
  return secPurpose !== null && secPurpose.toLowerCase().includes('prefetch')
}
