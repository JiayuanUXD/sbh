// 浏览器验证专用：转发到同一个本地开发服务，仅记录楼盘写入请求和响应。
// 不记录 Cookie / Authorization 等请求头，不启动第二个应用或共享数据库实例。
import http from 'node:http'
import net from 'node:net'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const upstream = 'http://localhost:3717'
const origin = 'http://localhost:3720'
const evidence = fileURLToPath(new URL('./browser-requests.jsonl', import.meta.url))
function headersFor(request) {
  const headers = { ...request.headers, host: 'localhost:3717', 'accept-encoding': 'identity' }
  if (headers.origin === origin) headers.origin = upstream
  if (headers.referer?.startsWith(origin)) headers.referer = headers.referer.replace(origin, upstream)
  return headers
}

const server = http.createServer((request, response) => {
  const capture = ['POST', 'PATCH'].includes(request.method) && /^\/api\/buildings(?:\/\d+)?(?:\?|$)/.test(request.url)
  const requestChunks = []
  const responseChunks = []
  const forward = http.request(new URL(request.url, upstream), {
    method: request.method,
    headers: headersFor(request),
  }, (result) => {
    response.writeHead(result.statusCode, result.headers)
    result.on('data', (chunk) => { if (capture) responseChunks.push(chunk) })
    result.on('end', () => {
      if (!capture) return
      appendFileSync(evidence, JSON.stringify({
        method: request.method,
        path: request.url,
        contentType: request.headers['content-type'],
        requestBody: Buffer.concat(requestChunks).toString('utf8'),
        responseStatus: result.statusCode,
        responseBody: Buffer.concat(responseChunks).toString('utf8'),
      }) + '\n')
    })
    result.pipe(response)
  })
  forward.on('error', (error) => { response.writeHead(502); response.end(error.message) })
  request.on('data', (chunk) => { if (capture) requestChunks.push(chunk) })
  request.pipe(forward)
})

server.on('upgrade', (request, socket, head) => {
  const connection = net.connect(3717, '127.0.0.1', () => {
    const headers = Object.entries(headersFor(request)).map(([key, value]) => `${key}: ${value}`).join('\r\n')
    connection.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`)
    if (head.length) connection.write(head)
    socket.pipe(connection)
    connection.pipe(socket)
  })
  connection.on('error', () => socket.destroy())
  socket.on('error', () => connection.destroy())
})

server.listen(3720, '127.0.0.1', () => console.log(`OPT-121 请求取证代理：${origin} → ${upstream}`))
