/**
 * OPT-112 T1 复现：上传 hook 读水印设置时是否另借连接。
 *
 * 用法（须在应用目录内运行，才能解析 @/ 别名与 payload.config）：
 *   cp ../artifacts/verification/OPT-112/pool-probe.mts ./.opt112-pool-probe.mts
 *   DB_POOL_MAX=2 node --import tsx ./.opt112-pool-probe.mts
 *
 * DB_POOL_MAX=2：适配器启动时常驻借走 1 条，只剩 1 条。payload.create 的上传事务占住它，
 * hook 里不带 req 的 findGlobal 就只能等第二条 → 10s 后「timeout exceeded when trying to connect」。
 * 带 req 则复用事务那条，照常完成并写上 watermark.version。
 */
import { getPayload } from 'payload'
import sharp from 'sharp'

import config from './src/payload.config'

const payload = await getPayload({ config })
await payload.updateGlobal({ slug: 'site-settings', data: { watermark: { enabled: true } }, overrideAccess: true })

const body = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#88aacc' } }).jpeg().toBuffer()
const startedAt = Date.now()
let result: Record<string, unknown>
try {
  const doc = await payload.create({
    collection: 'media',
    data: { alt: 'OPT-112 连接池探针', usage: 'listing-photo' },
    file: { data: body, mimetype: 'image/jpeg', name: `opt112-probe-${startedAt}.jpg`, size: body.length },
    overrideAccess: true,
  })
  const fresh = (await payload.findByID({ collection: 'media', id: doc.id, depth: 0 })) as {
    watermark?: { version?: string | null }
  }
  result = { ok: true, ms: Date.now() - startedAt, id: doc.id, watermarkVersion: fresh.watermark?.version ?? null }
} catch (error) {
  // drizzle 把底层错误包成「Failed query: <整条 SQL>」，真正的原因在 cause 里；SQL 只留表名。
  const message = error instanceof Error ? error.message : String(error)
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null
  result = { ok: false, ms: Date.now() - startedAt, query: message.match(/from "(\w+)"/)?.[1] ?? null, cause }
}
console.log('RESULT ' + JSON.stringify({ poolMax: process.env.DB_POOL_MAX ?? '(default)', ...result }))
process.exit(0)
