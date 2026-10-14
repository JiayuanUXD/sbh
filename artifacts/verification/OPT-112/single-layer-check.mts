/**
 * OPT-112 验证：被「模拟发版」打断的那一段里的图，重刷后只有一层水印。
 *
 * 判据：拿 media-source/ 里的干净备份按当前配置自己烘一次，与 media/ 里的母版逐字节比较。
 * 相同 = 存储里的母版正是「干净原件 + 一层当前水印」；叠了两层的话字节必然不同。
 *
 * 用法（须在应用目录内运行）：
 *   cp ../artifacts/verification/OPT-112/single-layer-check.mts ./.opt112-single.mts
 *   node --import tsx ./.opt112-single.mts <filename> [<filename> ...]
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { getPayload } from 'payload'

import config from './src/payload.config'
import { resolveWatermarkRenderContext } from './src/domain/media/watermark-settings'
import { createLocalMediaWriter } from './src/lib/storage/media-writer'
import { bakeWatermark } from './src/plugins/watermark'

const payload = await getPayload({ config })
const root = process.cwd()
const writer = createLocalMediaWriter(root)
const { config: watermarkConfig, assets } = await resolveWatermarkRenderContext(payload, writer)

for (const filename of process.argv.slice(2)) {
  const clean = await readFile(path.join(root, 'media-source', filename))
  const stored = await readFile(path.join(root, 'media', filename))
  const baked = await bakeWatermark({
    cleanMaster: clean,
    masterFilename: filename,
    masterMimeType: 'image/jpeg',
    sizes: [],
    config: watermarkConfig,
    assets,
  })
  const doubled = await bakeWatermark({
    cleanMaster: stored,
    masterFilename: filename,
    masterMimeType: 'image/jpeg',
    sizes: [],
    config: watermarkConfig,
    assets,
  })
  console.log(
    'CHECK ' +
      JSON.stringify({
        filename,
        storedEqualsOneLayerFromBackup: stored.equals(baked.master.body),
        // 对照：在已烘的母版上再烘一层，确认「两层」与「一层」的字节确实不同，判据有区分力
        storedEqualsTwoLayers: stored.equals(doubled.master.body),
      }),
  )
}
process.exit(0)
