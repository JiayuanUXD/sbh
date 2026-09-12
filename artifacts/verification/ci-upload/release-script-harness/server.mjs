// 假 COS：按 argv[2] 的逗号序列决定每次 PUT 的行为
//   ok   → 收完请求体回 200
//   bad  → 收完请求体回 400 + COS 风格 XML 错误体（UserNetworkTooSlow）
//   slow → 每秒只放行一小片，模拟远低于 need_bps 的链路，等 curl 自己按 --speed-limit 断开
import http from 'node:http'

const modes = (process.argv[2] || 'ok').split(',')
let n = 0

const server = http.createServer((req, res) => {
  if (req.method !== 'PUT') {
    res.writeHead(404)
    return res.end()
  }
  n++
  const mode = modes[Math.min(n, modes.length) - 1]
  let bytes = 0
  console.log(
    `[server] PUT #${n} mode=${mode} url=${req.url} x-test=${JSON.stringify(req.headers['x-test'])} content-length=${req.headers['content-length']}`,
  )
  if (mode === 'slow') {
    req.socket.pause()
    const t = setInterval(() => {
      req.socket.resume()
      setImmediate(() => req.socket.pause())
    }, 1000)
    req.on('data', (c) => {
      bytes += c.length
    })
    req.on('close', () => {
      clearInterval(t)
      console.log(`[server] #${n} closed by peer after ${bytes} bytes`)
    })
    return
  }
  req.on('data', (c) => {
    bytes += c.length
  })
  req.on('end', () => {
    console.log(`[server] #${n} received ${bytes} bytes → ${mode}`)
    if (mode === 'bad') {
      res.writeHead(400, { 'content-type': 'application/xml' })
      res.end(
        '<?xml version="1.0" encoding="utf-8"?>\n<Error><Code>UserNetworkTooSlow</Code><Message>harness fake: upload too slow</Message><RequestId>harness-req-' +
          n +
          '</RequestId></Error>',
      )
    } else {
      res.writeHead(200)
      res.end()
    }
  })
})

server.listen(0, '127.0.0.1', () => {
  console.log(`PORT=${server.address().port}`)
})
