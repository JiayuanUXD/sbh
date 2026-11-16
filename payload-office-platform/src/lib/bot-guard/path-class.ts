/**
 * 请求归类（纯函数）。判定顺序固定：
 * 方法 → 站点地图 → 媒体 → mini 读 → 其余 /api、/_next、/admin、
 * /robots.txt、/favicon.ico、带文件扩展名的末段 → 剩余为 page。
 */
/**
 * 预取头（next-router-prefetch / Purpose / Sec-Purpose）可被客户端伪造，
 * 若直接豁免，任何爬虫加一个头就能绕过 page 限速。因此预取页面请求
 * 归入独立的 page-prefetch 类别：额度比 page 宽，但同样受限。
 */
export type GuardClass = 'page' | 'page-prefetch' | 'sitemap' | 'media' | 'mini-read' | 'exempt'

const MINI_READ_PATTERN = /^\/api\/mini\/v1\/(?:home|listings|buildings)(?:\/|$)/

export function classifyPath(
  input: Readonly<{ method: string; pathname: string; isPrefetch: boolean }>,
): GuardClass {
  const method = input.method.toUpperCase()
  // Server Action 的 POST、OPTIONS 等不计配额
  if (method !== 'GET' && method !== 'HEAD') return 'exempt'

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

  return input.isPrefetch ? 'page-prefetch' : 'page'
}

/** 是否预取请求：Next 路由预取、浏览器 purpose / sec-purpose 任一声明即算。 */
export function readIsPrefetch(get: (name: string) => string | null): boolean {
  if (get('next-router-prefetch') === '1') return true
  const purpose = get('purpose')
  if (purpose !== null && purpose.toLowerCase().includes('prefetch')) return true
  const secPurpose = get('sec-purpose')
  return secPurpose !== null && secPurpose.toLowerCase().includes('prefetch')
}
