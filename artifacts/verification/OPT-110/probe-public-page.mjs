import { writeFileSync } from 'node:fs'

const url = new URL(process.argv[2] ?? 'https://shangban.cc/')
if (url.origin !== 'https://shangban.cc') throw new Error('仅允许检查生产公开页面')
const start = Date.now()
const result = { url: url.href, at: new Date().toISOString(), status: null, headersMs: null,
  firstChunkMs: null, bytes: 0, chunks: 0, elapsedMs: null, error: null }
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  result.status = response.status
  result.headersMs = Date.now() - start
  console.log(JSON.stringify({ phase: 'headers', status: result.status, elapsedMs: result.headersMs,
    encoding: response.headers.get('content-encoding'), transfer: response.headers.get('transfer-encoding') }))
  for await (const chunk of response.body) {
    result.bytes += chunk.byteLength
    result.chunks++
    if (result.firstChunkMs === null) {
      result.firstChunkMs = Date.now() - start
      console.log(JSON.stringify({ phase: 'first-chunk', elapsedMs: result.firstChunkMs, bytes: chunk.byteLength }))
    }
  }
  if (result.status !== 200) throw new Error(`页面返回 ${result.status}`)
} catch (error) {
  result.error = String(error)
} finally {
  result.elapsedMs = Date.now() - start
  writeFileSync(new URL('./public-page-stream-profile.json', import.meta.url), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
if (result.error) process.exitCode = 1
