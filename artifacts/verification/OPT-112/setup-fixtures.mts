/**
 * OPT-112 浏览器验收夹具：造 N 张「从没烘过」的实景图（开关关着上传 → 有干净备份、无 version），
 * 然后打开水印开关。之后在后台点「重刷全部房源图」，看链条自己跑完。
 *
 * 用法（须在应用目录内运行）：
 *   cp ../artifacts/verification/OPT-112/setup-fixtures.mts ./.opt112-setup.mts
 *   N=45 node --import tsx ./.opt112-setup.mts
 */
import { getPayload } from 'payload'
import sharp from 'sharp'

import config from './src/payload.config'

const count = Number(process.env.N ?? 45)
const payload = await getPayload({ config })
await payload.updateGlobal({ slug: 'site-settings', data: { watermark: { enabled: false } }, overrideAccess: true })

const stamp = Date.now()
for (let index = 0; index < count; index++) {
  const hue = (index * 37) % 360
  const body = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: `hsl(${hue}, 45%, 60%)` },
  })
    .jpeg()
    .toBuffer()
  await payload.create({
    collection: 'media',
    data: { alt: `OPT-112 重刷夹具 ${index + 1}`, usage: 'listing-photo' },
    file: { data: body, mimetype: 'image/jpeg', name: `opt112-fixture-${stamp}-${index + 1}.jpg`, size: body.length },
    overrideAccess: true,
  })
}

await payload.updateGlobal({ slug: 'site-settings', data: { watermark: { enabled: true } }, overrideAccess: true })
console.log(`SETUP ${count} 张实景图已建（无 version），水印开关已打开`)
process.exit(0)
