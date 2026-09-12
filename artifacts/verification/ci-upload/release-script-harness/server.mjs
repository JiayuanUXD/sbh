// 假 COS：按 argv[2] 的逗号序列决定每次 PUT 的行为（序列用完后沿用最后一个）
//   ok   → 收完请求体回 200
//   bad  → 收完请求体回 400 + COS 风格 XML 错误体（UserNetworkTooSlow）
//   slow → 真正的传输层背压：不进入 flowing，每 100ms 只从请求流取 1KB（≈10KB/s）。
//          IncomingMessage 缓冲超过 highWaterMark 时 node 会 readStop 底层 socket，
//          内核收包缓冲满后 curl 的 send 阻塞，curl 量到的均速就是这个 10KB/s，
//          --speed-limit/--speed-time 30 到点自己断开（exit 28、只传了一部分）。
//   hang → 收完整个请求体但永不响应：实测 curl 的 --speed-limit 在「等响应」阶段照样计速
//          （速率为 0），30s 就断（exit 28、已传=全量、http=100），轮不到 --max-time——
//          后者只兜「速率忽高忽低、没有连续 30s 低于阈值、但总时长超了」这种情况。
//          （第一版的 slow 其实就是 hang 的行为——socket.resume()/pause() 每秒一次挡不住回环上的
//          突发读取，3MB 全进了内核缓冲，Codex 审阅指出后拆成两种模式。）
import http from 'node:http'

const modes = (process.argv[2] || 'ok').split(',')
let n = 0

const server = http.createServer((req, res) => {
  if (req.method !== 'PUT') {
    res.writeHead(404)
    return res.end()
  }
  n++
  const id = n
  const mode = modes[Math.min(n, modes.length) - 1]
  let bytes = 0
  console.log(
    `[server] PUT #${id} mode=${mode} url=${req.url} x-test=${JSON.stringify(req.headers['x-test'])} content-length=${req.headers['content-length']}`,
  )
  if (mode === 'slow') {
    const started = Date.now()
    const t = setInterval(() => {
      const chunk = req.read(1024)
      if (chunk) bytes += chunk.length
    }, 100)
    // socket 停读期间看不到对端的 FIN（要等缓冲排空才轮到它），close 事件靠不住；
    // 每 10s 打一次已消费字节数，日志里能直接读出 ~10KB/s 的消费速率。
    const report = setInterval(() => {
      console.log(`[server] #${id} slow: consumed ${bytes} bytes in ${Math.round((Date.now() - started) / 1000)}s`)
    }, 10000)
    req.on('close', () => {
      clearInterval(t)
      clearInterval(report)
      console.log(`[server] #${id} closed by peer after consuming ${bytes} bytes (slow)`)
    })
    return
  }
  if (mode === 'hang') {
    req.on('data', (c) => {
      bytes += c.length
    })
    req.on('end', () => {
      console.log(`[server] #${id} received ${bytes} bytes → hang (never responds)`)
    })
    req.on('close', () => {
      console.log(`[server] #${id} closed by peer (hang)`)
    })
    return
  }
  req.on('data', (c) => {
    bytes += c.length
  })
  req.on('end', () => {
    console.log(`[server] #${id} received ${bytes} bytes → ${mode}`)
    if (mode === 'bad') {
      res.writeHead(400, { 'content-type': 'application/xml' })
      res.end(
        '<?xml version="1.0" encoding="utf-8"?>\n<Error><Code>UserNetworkTooSlow</Code><Message>harness fake: upload too slow</Message><RequestId>harness-req-' +
          id +
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
