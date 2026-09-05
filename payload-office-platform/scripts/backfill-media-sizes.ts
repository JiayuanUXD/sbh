/**
 * OPT-068 存量媒体派生尺寸回填。
 *
 * ## 为什么需要
 *
 * `Media.imageSizes` 自 OPT-059 起会为**新上传**的图片生成 thumb 320 / card 768 /
 * hero 1600 三档 webp；存量图当时裁定不回填。结果是线上 17,137 条媒体里相当一部分
 * 没有 `sizes.card`，卡片位只能直出原图——抽样最近 300 张，169 张没有派生、203 张
 * 原图超过 500KB，首页热门楼盘两张封面各 1.7MB / 1.8MB，而卡片显示宽度只有 ~360px。
 *
 * 前端已经能吃 srcset（`lib/frontend/media-srcset.ts`），缺的就是这批派生文件。
 *
 * ## 怎么做
 *
 * Payload 的 `update` 带 `file` 时会重新跑一遍上传管线（`generateFileData` →
 * sharp 生成各档 → 存储适配器写盘/写 COS），因此把原图字节读回来、以同名回写，
 * 就等于「补生成派生尺寸」。同名 + `overwriteExistingFiles: true` 保证：
 *   - `media.url` 不变 → 所有引用它的房源 / 楼盘 / 内容页都不用改；
 *   - 不产生 `-1.jpg` 这类重名副本。
 *
 * ## 用法（默认 dry-run，不写任何东西）
 *
 * ```bash
 * pnpm media:backfill-sizes                      # 只统计：多少张缺派生、合计多大
 * pnpm media:backfill-sizes --execute --limit=50 # 真回填前 50 张
 * pnpm media:backfill-sizes --execute --limit=500 --start-after=1200
 * ```
 *
 * 生产上建议分批（`--limit=500`），每批之间看一眼失败列表。脚本对单条失败只记录
 * 不中断——一张坏图不该让整批停下。
 *
 * ## 边界
 *
 *   - 只处理 `mimeType` 以 `image/` 开头、且**缺 `sizes.card.url`** 的记录；
 *     已有派生的一律跳过（幂等，重复跑不会重复生成）。
 *   - **已烘过水印的记录（`watermark.version` 有值）一律跳过**（OPT-069）。本脚本靠
 *     「HTTP 读回当前母版 → 同名 `payload.update({ file })` 回写」补派生，而水印是烘进
 *     像素的：烘过之后那个母版**已经带着水印**，回写等于把带水印的字节当成一次新上传，
 *     `watermarkPlugin` 会把它备份进 `media-source/` 当「干净原件」（干净副本就此永久丢失），
 *     再在上面叠第二层水印。规定的上线顺序（usage 回填 → 本脚本 → 打开水印开关 → 水印回刷）
 *     里本脚本跑在开关打开之前，那时一张都没烘过，所以顺序没问题；这条守卫是为了**顺序被打乱**
 *     ——比如上线后有人补跑一次本脚本——那时它必须自己拒绝，而不是靠运维记得。
 *   - 原图字节从 `media.url` 同源读取（本地存储走磁盘路由、COS 走 Payload 的文件
 *     路由回源），不直接依赖 COS SDK，因此本地与生产同一条代码路径。
 *   - 视频不处理：`imageSizes` 对非图片无意义。
 */

import { resolve } from 'path'
import { fileURLToPath } from 'url'

import { getPayload } from 'payload'
import config from '../src/payload.config'

type MediaDoc = {
  id: number
  filename?: string | null
  mimeType?: string | null
  filesize?: number | null
  url?: string | null
  sizes?: Record<string, { url?: string | null } | null | undefined> | null
  /** OPT-069：有值 = 存储里的母版已带水印，本脚本不能碰它（见头注释「边界」）。 */
  watermark?: { version?: string | null } | null
}

const EXECUTE = process.argv.includes('--execute')
const LIMIT = readNumberFlag('--limit=', EXECUTE ? 50 : Number.POSITIVE_INFINITY)
const START_AFTER = readNumberFlag('--start-after=', 0)
const PAGE_SIZE = 200

function readNumberFlag(prefix: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(prefix))
  if (!raw) return fallback
  const value = Number(raw.slice(prefix.length))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function needsBackfill(doc: MediaDoc): boolean {
  if (!doc.mimeType || !doc.mimeType.startsWith('image/')) return false
  // OPT-069：已烘过水印的母版不是干净原件。把它读回来同名回写，watermarkPlugin 会把这份
  // 带水印的字节当成新上传备份进 media-source/（干净副本永久丢失），并叠上第二层水印。
  // 这类记录要补派生只能走 `pnpm media:backfill-watermark`（它从 media-source/ 的备份重烘）。
  if (isWatermarkBaked(doc)) return false
  return !doc.sizes?.card?.url
}

/** 已烘过水印 = 存储里的母版被改写过，不能再当原件读回写回。 */
export function isWatermarkBaked(doc: MediaDoc): boolean {
  return typeof doc.watermark?.version === 'string' && doc.watermark.version.length > 0
}

/** 站点自身的文件路由基址：本地 dev 与生产各自读自己的库，不跨环境取字节。 */
function baseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  const port = process.env.PORT?.trim() || '3717'
  return `http://localhost:${port}`
}

async function readOriginalBytes(doc: MediaDoc): Promise<Buffer> {
  if (!doc.url) throw new Error(`media ${doc.id} 没有 url`)
  const url = doc.url.startsWith('http') ? doc.url : `${baseUrl()}${doc.url}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function main(): Promise<void> {
  const payload = await getPayload({ config })
  const candidates: MediaDoc[] = []
  let page = 1
  let scanned = 0
  // 缺派生、但已经烘过水印，因此本脚本不能处理的记录。单独报出来，别让它们悄悄消失在
  // 「缺派生 N 张」与实际回填数的差值里。
  let watermarkedSkipped = 0

  for (;;) {
    const result = await payload.find({
      collection: 'media',
      depth: 0,
      limit: PAGE_SIZE,
      page,
      sort: 'id',
      overrideAccess: true,
    })
    const docs = result.docs as unknown as MediaDoc[]
    scanned += docs.length
    for (const doc of docs) {
      if (doc.id <= START_AFTER) continue
      if (isWatermarkBaked(doc) && !doc.sizes?.card?.url) watermarkedSkipped++
      if (needsBackfill(doc)) candidates.push(doc)
    }
    if (!result.hasNextPage || result.nextPage == null) break
    page = result.nextPage
  }

  const totalBytes = candidates.reduce((sum, doc) => sum + (doc.filesize ?? 0), 0)
  console.log(`扫描 ${scanned} 条媒体，其中缺派生尺寸的图片 ${candidates.length} 张，原图合计 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)
  if (watermarkedSkipped > 0) {
    console.log(
      `另有 ${watermarkedSkipped} 张缺派生但已烘过水印，本脚本一律跳过：它们的母版已带水印，` +
        '读回同名回写会被当成新上传，干净原件被覆盖、水印叠第二层。要补派生请用 pnpm media:backfill-watermark（从 media-source/ 备份重烘）。',
    )
  }

  if (!EXECUTE) {
    console.log('dry-run：未写入任何数据。加 --execute 真正回填，建议配 --limit 分批。')
    for (const doc of candidates.slice(0, 10)) {
      console.log(`  #${doc.id} ${doc.filename ?? '(无文件名)'} ${(doc.filesize ?? 0) / 1024 | 0} KB`)
    }
    if (candidates.length > 10) console.log(`  ...（其余 ${candidates.length - 10} 张略）`)
    return
  }

  const targets = candidates.slice(0, Number.isFinite(LIMIT) ? LIMIT : candidates.length)
  console.log(`开始回填 ${targets.length} 张（--limit=${LIMIT}）...`)

  let done = 0
  const failures: Array<{ id: number; reason: string }> = []
  for (const doc of targets) {
    try {
      const bytes = await readOriginalBytes(doc)
      await payload.update({
        collection: 'media',
        id: doc.id,
        data: {},
        overrideAccess: true,
        overwriteExistingFiles: true,
        file: {
          data: bytes,
          mimetype: doc.mimeType ?? 'image/jpeg',
          name: doc.filename ?? `media-${doc.id}`,
          size: bytes.length,
        },
      })
      const after = (await payload.findByID({
        collection: 'media',
        id: doc.id,
        depth: 0,
        overrideAccess: true,
      })) as unknown as MediaDoc
      if (!after.sizes?.card?.url) throw new Error('回写后仍无 sizes.card.url')
      done += 1
      if (done % 25 === 0) console.log(`  已完成 ${done}/${targets.length}`)
    } catch (error) {
      failures.push({ id: doc.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  console.log(`回填完成：成功 ${done}，失败 ${failures.length}`)
  for (const failure of failures.slice(0, 20)) {
    console.log(`  ✗ #${failure.id} ${failure.reason}`)
  }
  if (candidates.length > targets.length) {
    const nextStart = targets[targets.length - 1]?.id ?? START_AFTER
    console.log(`还剩 ${candidates.length - targets.length} 张，续跑：--execute --limit=${LIMIT} --start-after=${nextStart}`)
  }
}

// 仅在作为脚本直接运行时执行；被测试 import 时不触发全库扫描
// （与 scripts/migrate-dry-run.ts、scripts/preflight.ts 同一写法）。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
