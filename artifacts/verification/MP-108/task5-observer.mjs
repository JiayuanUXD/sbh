import http from 'node:http'
export function safePath(value) {
  const pathname = new URL(value, 'http://127.0.0.1:3717').pathname
  return pathname === '/api/health' || pathname.startsWith('/api/mini/v1/') ? pathname : null
}
const emit = http.Server.prototype.emit
http.Server.prototype.emit = function (event, ...args) {
  if (event === 'request') {
    const [req, res] = args, pathname = safePath(req.url)
    if (pathname) res.once('finish', () => console.log('[MP108_ACCESS]', JSON.stringify({ at: new Date().toISOString(), method: req.method, path: pathname, status: res.statusCode, requestId: res.getHeader('x-request-id') ?? null })))
  }
  return emit.call(this, event, ...args)
}
