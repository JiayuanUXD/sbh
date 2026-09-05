/**
 * OPT-069 水印烘焙管线。
 *
 * ## 时机（读 Payload 3.86 源码核实过，改动前务必重读 spec §3.3）
 *
 * ```
 * beforeOperation（本文件）        ← req.file 已就位，取干净母版存进 req.context
 *   ↓
 * generateFileData                 ← Payload 用干净母版做尺寸探测 + 三档派生
 *   ↓
 * uploadFiles / 云存储插件 afterChange  ← 干净文件落到本地 fs 或 COS
 *   ↓
 * watermarkPlugin 的 afterChange（本文件）  ← 覆盖成带水印的
 * ```
 *
 * `create.js:37` 的 `buildBeforeOperation` 早于 `:79` 的 `generateFileData`；
 * update 路径同理（`update.js:34` vs `:128`，`updateByID.js:23` vs `:97`）。
 * 本地存储模式下文件由核心的 `uploadFiles` 落地（`create.js:170` /
 * `operations/utilities/update.js:120`），都在集合 afterChange（`:289` / `:328`）之前。
 * 云存储插件把自己的 hook **追加**在集合已有 hook 之后
 * （`plugin-cloud-storage/dist/plugin.js:122`），所以本插件只要在
 * `payload.config.ts` 的 `plugins` 数组里**排在 `s3Storage(...)` 之后**，
 * 其 afterChange 就跑在上传之后。
 *
 * ## 为什么是覆盖写而不是在上传前换 buffer
 *
 * 换 buffer 只能改 `req.payloadUploadSizes`（Payload 私有内部），而本地磁盘路径
 * 持有的是 `imageSizeFiles` 里的**另一个 buffer 引用**——改前者只影响 COS，
 * 结果是「本地看不到水印、只有生产有」，正踩 CLAUDE.md「本地验之前先确认环境等价」。
 * 覆盖写对两种存储模式是同一条代码路径。
 */

import type {
  CollectionAfterChangeHook,
  CollectionBeforeOperationHook,
  PayloadRequest,
  Plugin,
} from 'payload'
import sharp from 'sharp'

import {
  buildBadgeOverlay,
  buildTiledOverlay,
  computeWatermarkVersion,
  isBakeableImage,
  mergeWatermarkConfig,
  type WatermarkConfig,
} from '@/domain/media/watermark'
import { MEDIA_COS_PREFIX } from '@/lib/storage/cos-config'
import { createMediaWriter, MEDIA_SOURCE_PREFIX, type MediaWriter } from '@/lib/storage/media-writer'

export const WATERMARK_CONTEXT_KEY = '__opt069CleanMaster'
export const WATERMARK_SKIP_KEY = '__opt069Skip'

/** 不打水印的派生档。320px 图无盗用价值，见 spec §4.5。 */
const SKIPPED_SIZE_NAMES = new Set(['thumb'])

export type BakeSizeInput = { name: string; filename: string; width: number; height: number }

export type BakeInput = {
  cleanMaster: Buffer
  masterFilename: string
  masterMimeType: string
  sizes: BakeSizeInput[]
  config: WatermarkConfig
}

export type BakeOutput = {
  master: { filename: string; body: Buffer; mimeType: string }
  derivatives: Array<{ filename: string; body: Buffer; mimeType: string }>
}

/**
 * 纯计算：干净母版 → 满铺母版 + 角标派生图。不碰存储，便于单测做像素断言。
 *
 * 母版不指定输出格式，sharp 默认沿用输入格式，故 jpeg 进 jpeg 出。**这个前提只对
 * `isBakeableImage` 放行的 jpeg / png / webp 成立**：SVG 进来 sharp 写不出 SVG，吐的是
 * PNG 字节——所以 MIME 准入在调用方 `bakeAfterUpload` 就拦掉，本函数不再重复判。
 * 派生图一律 webp，与 `Media.imageSizes` 的 `formatOptions` 对齐。
 *
 * 动图（gif / 动态 webp）在这里按 `metadata().pages > 1` 原样返回：`composite()` 不带
 * `{ animated: true }` 只读第一帧，烘下去会把动图静默改写成静止图。静态与动态 WebP
 * 共用 `image/webp`，MIME 层拦不住，`pages` 是唯一可靠的信号；静态图 sharp 根本不回
 * 这个字段，故判 `(pages ?? 1) > 1`。调用方 `bakeAfterUpload` 拿到原样返回后照常写
 * `watermark.version`——这张图对当前配置「已处理、无事可做」，重刷不会每轮再选它。
 */
export async function bakeWatermark(input: BakeInput): Promise<BakeOutput> {
  const untouched = (): BakeOutput => ({
    master: {
      filename: input.masterFilename,
      body: input.cleanMaster,
      mimeType: input.masterMimeType,
    },
    derivatives: [],
  })

  if (!input.config.enabled) return untouched()

  const metadata = await sharp(input.cleanMaster).metadata()
  // 动图：与 enabled=false 同一形状原样返回，母版不动、不出派生图。
  if ((metadata.pages ?? 1) > 1) return untouched()

  const width = metadata.width
  const height = metadata.height
  if (!width || !height) {
    throw new Error(`[watermark] 读不出母版尺寸：${input.masterFilename}`)
  }

  const master = await sharp(input.cleanMaster)
    .composite([{ input: buildTiledOverlay({ width, height, config: input.config.tiled }), blend: 'over' }])
    .toBuffer()

  const derivatives: BakeOutput['derivatives'] = []
  for (const size of input.sizes) {
    if (SKIPPED_SIZE_NAMES.has(size.name)) continue
    const body = await sharp(input.cleanMaster)
      .resize({ width: size.width, height: size.height, fit: 'fill' })
      .composite([
        {
          input: buildBadgeOverlay({ width: size.width, height: size.height, config: input.config.badge }),
          blend: 'over',
        },
      ])
      .webp()
      .toBuffer()
    derivatives.push({ filename: size.filename, body, mimeType: 'image/webp' })
  }

  return {
    master: { filename: input.masterFilename, body: master, mimeType: input.masterMimeType },
    derivatives,
  }
}

type MediaDocShape = {
  id: number | string
  filename?: string | null
  mimeType?: string | null
  usage?: string | null
  watermark?: { version?: string | null; appliedAt?: string | null } | null
  sizes?: Record<string, { filename?: string | null; width?: number | null; height?: number | null } | null> | null
}

function collectSizes(doc: MediaDocShape): BakeSizeInput[] {
  const sizes: BakeSizeInput[] = []
  for (const [name, value] of Object.entries(doc.sizes ?? {})) {
    if (!value?.filename || !value.width || !value.height) continue
    sizes.push({ name, filename: value.filename, width: value.width, height: value.height })
  }
  return sizes
}

/**
 * 从 SiteSettings 读配置。合并逻辑走 `mergeWatermarkConfig`（Task 1 的纯函数），
 * **不要在这里手写展开**：Payload 对从没保存过的 group 返回的是
 * `{ density: null, text: null }` 这类全 null 对象，`...stored.tiled` 会让 null
 * 覆盖掉默认值，`width / null` 得到 Infinity，水印静默失效——librsvg 拿到非法数值
 * 不报错，sharp 照常返回一张没有水印的图。
 *
 * 本函数与 `domain/media/watermark-rebake.ts` 的读取路径必须调用同一个
 * `mergeWatermarkConfig`，否则两条路会在「配置缺省」这件事上给出不同答案，
 * 表现为「新上传带水印、重刷后不带」这种极难查的错位。
 */
async function resolveConfig(payload: PayloadRequest['payload']): Promise<WatermarkConfig> {
  const global = (await payload.findGlobal({
    slug: 'site-settings',
    depth: 0,
    overrideAccess: true,
  })) as { watermark?: unknown; siteName?: string | null }
  return mergeWatermarkConfig(global?.watermark, global?.siteName)
}

const captureCleanMaster: CollectionBeforeOperationHook = async ({ args, operation }) => {
  if (operation !== 'create' && operation !== 'update') return args
  const req = args.req
  const data = req?.file?.data
  // Buffer.from 复制一份：后续 Payload 会把 req.file 换成缩放后的对象，
  // 直接持引用会拿到被改过的字节。
  if (req && Buffer.isBuffer(data)) {
    req.context = req.context ?? {}
    ;(req.context as Record<string, unknown>)[WATERMARK_CONTEXT_KEY] = Buffer.from(data)
  }
  return args
}

type WatermarkState = { version: string; appliedAt: string } | { version: null; appliedAt: null }

/**
 * `req.context` 的读写**必须每次重新解引用，不能缓存成局部变量**。
 *
 * Payload 的 Local API 每次嵌套调用都会把 `req.context` 换成**新对象**：
 * `utilities/createLocalReq.js:86` 的 `req.context = getRequestContext(req, context)`，
 * 而 `getRequestContext`（同文件 4-20 行）三个分支分别返回 `context`、
 * `{...req.context, ...context}`、`context`——没有一个复用原引用；且 `createLocalReq`
 * 解构出 `req` 后是**在调用方传进来的那个 req 上原地赋值**。
 *
 * 云存储插件之所以没踩这个坑，正是因为它从不缓存：
 * `plugin-cloud-storage/dist/hooks/afterChange.js` 每次都写
 * `req.context.skipCloudStorage = true` / `delete req.context.skipCloudStorage`。
 */
function requestContext(req: PayloadRequest): Record<string, unknown> {
  if (!req.context) req.context = {}
  return req.context as unknown as Record<string, unknown>
}

/**
 * 写 / 清 `media.watermark`。设 skip 标记防递归。写与清必须走同一个出口，
 * 免得哪一边忘了设标记、递归进 bakeAfterUpload。
 */
async function writeWatermarkState({
  req,
  id,
  state,
}: {
  req: PayloadRequest
  id: MediaDocShape['id']
  state: WatermarkState
}): Promise<void> {
  requestContext(req)[WATERMARK_SKIP_KEY] = true
  try {
    await req.payload.update({
      collection: 'media',
      id,
      data: { watermark: state },
      depth: 0,
      overrideAccess: true,
      req,
    })
  } finally {
    // 重新解引用：上面那次 update 已经把 req.context 换成新对象了，
    // 删缓存下来的旧对象等于没删，守卫会永久置位——之后同一个 req 里的
    // 媒体一张都不会被烘，而且不报错。
    delete requestContext(req)[WATERMARK_SKIP_KEY]
  }
}

/** 烘焙准入：usage 是实景图、且格式是 sharp 能原地改写的。返回收窄后的 filename / mimeType。 */
function pickBakeTarget(media: MediaDocShape): { filename: string; mimeType: string } | null {
  if (media.usage !== 'listing-photo') return null
  // 准入谓词与 selectRebakeTargets / backfill-watermark.ts 共用，三处必须同一个：
  // 这里拒掉的图永远写不上 watermark.version，重刷若认得比这里宽，会每轮重选、每轮失败。
  // `!media.mimeType` 一项只为 TS 收窄（谓词返回 boolean，不是 type guard），下面
  // writer.put 的 mimeType 参数要 string。
  if (!media.filename || !media.mimeType || !isBakeableImage(media.mimeType)) return null
  return { filename: media.filename, mimeType: media.mimeType }
}

/**
 * ## 不变量：`watermark.version` 有值 ⟺ 存储里的字节带着那个版本的水印
 *
 * 重刷任务（watermark-rebake.ts）与回刷脚本（backfill-watermark.ts）的三种情形判定
 * （`decideRebakeAction`）全部建立在它上面：有 version 就意味着当前文件不再是干净原件、
 * 只能从 `media-source/` 的备份重烘。**每一条改写存储字节的代码路径都必须维持它。**
 *
 * 本 hook 是唯一一条「新字节落地」的路径（Payload 把 req.file 写进存储之后才到这里），
 * 于是它有两种义务：
 *
 * - 烘了 → 写上当前配置哈希；
 * - 有新字节但**没烘**（开关关闭 / usage 不是实景图 / 格式不可烘）→ **清掉** version 与
 *   appliedAt。存储里现在是干净的新字节，旧 version 若留着就是谎言：下一次重刷会把它
 *   判成「旧版本」、从上一次上传的备份重烘，把新上传的图静默换回旧图。清掉之后它读作
 *   「从没烘过」，重刷走情形 1——备份当前干净字节再烘——正确且自愈。
 *
 * 没有新字节（只改 alt / usage 等）时什么都不碰：存储字节没变，记录的 version 与它仍一致。
 *
 * ## 第二条义务：`media-source/` 里永远是这张图最新的干净原件
 *
 * 只要新字节属于「可烘的实景图」，就把它备份进 `media-source/`——**烘不烘、开关开没开都备份**。
 * 本 hook 是唯一知道手里字节是新上传、确知无水印的地方；重刷任务与回刷脚本只能从
 * `watermark.version` 反推，而中断过的烘焙会让那个推断出错（见 watermark-rebake.ts）。
 * 备份归口在这里之后，那两条路就能一律「有备份就用备份、绝不覆盖」。
 */
export function createBakeAfterUpload(
  createWriter: () => MediaWriter = createMediaWriter,
): CollectionAfterChangeHook {
  return async ({ doc, req }) => {
    if (requestContext(req)[WATERMARK_SKIP_KEY]) return doc

    const cleanMaster = requestContext(req)[WATERMARK_CONTEXT_KEY]
    // 没有新字节 = 本次不是文件上传（改 alt、改 usage 等）。存储字节没变，不烘也不清。
    if (!Buffer.isBuffer(cleanMaster)) return doc

    try {
      const media = doc as unknown as MediaDocShape
      const clearIfStale = async (): Promise<void> => {
        // 新字节落地了但没烘。本来就没有 version 时无事可清，不多写一次库
        // （品牌素材每次上传都走到这里）。
        if (!media.watermark?.version && !media.watermark?.appliedAt) return
        await writeWatermarkState({ req, id: media.id, state: { version: null, appliedAt: null } })
      }

      const target = pickBakeTarget(media)
      if (!target) {
        await clearIfStale()
        return doc
      }

      const writer = createWriter()

      // 顺序铁律：先备份、再烘焙。备份失败必须中止，否则干净原件永久丢失。
      // 这里刻意不 try/catch —— Payload 的 killTransaction 会回滚整个 req 事务，
      // 吞掉异常等于「返回成功但没落库」。（下面那个 try 只带 finally、不带 catch，
      // 异常照常冒泡。）
      //
      // 备份是**覆盖写**，且**在读开关之前**——本 hook 是全仓库唯一知道「手里这份字节是
      // 刚上传的、确知没有水印」的地方，别处（重刷任务、回刷脚本）只能从 version 去推断，
      // 而推断在「烘到一半被打断」时会推错。所以：
      //
      //   - 开关关着照样备份。功能默认关闭、要等存量回填跑完运营才打开，这段窗口期上传的图
      //     若不备份，日后第一次烘焙一旦中断在「覆盖写母版」与「写 version」之间，就再也
      //     拿不回干净原件——重刷只会去 media-source/ 找，那里空着。
      //   - 覆盖写是对的：这份字节就是这张图当前的干净原件，media-source/ 里的旧副本属于
      //     上一次上传，留着只会让重刷把图换回旧版。
      //
      // 反过来，重刷/回刷那两条路**不许**覆盖备份（见 watermark-rebake.ts 的
      // backup-and-bake 分支）：它们手里的字节来路不明，只有这里知道字节是新的。
      await writer.put({
        prefix: MEDIA_SOURCE_PREFIX,
        filename: target.filename,
        body: cleanMaster,
        mimeType: target.mimeType,
      })

      const config = await resolveConfig(req.payload)
      if (!config.enabled) {
        await clearIfStale()
        return doc
      }

      const baked = await bakeWatermark({
        cleanMaster,
        masterFilename: target.filename,
        masterMimeType: target.mimeType,
        sizes: collectSizes(media),
        config,
      })

      await writer.put({
        prefix: MEDIA_COS_PREFIX,
        filename: baked.master.filename,
        body: baked.master.body,
        mimeType: baked.master.mimeType,
      })
      for (const derivative of baked.derivatives) {
        await writer.put({
          prefix: MEDIA_COS_PREFIX,
          filename: derivative.filename,
          body: derivative.body,
          mimeType: derivative.mimeType,
        })
      }

      // 记录烘焙状态：从这一刻起存储里的字节带着这个版本的水印。
      await writeWatermarkState({
        req,
        id: media.id,
        state: { version: computeWatermarkVersion(config), appliedAt: new Date().toISOString() },
      })

      return doc
    } finally {
      // 这份干净母版只属于本条 media。同一个 req 若再处理第二条（Task 7 的批量重刷
      // 就是一个 req 跑几十行），留着会让第二条拿第一条的字节去烘，静默串图。
      // 必须清在所有嵌套 update **之后**：那些调用会重跑 beforeOperation。
      delete requestContext(req)[WATERMARK_CONTEXT_KEY]
    }
  }
}

/** 默认实例（走真实存储）。集合 hook 与既有测试都用它。 */
export const bakeAfterUpload: CollectionAfterChangeHook = createBakeAfterUpload()

/**
 * 必须放在 `s3Storage(...)` **之后**——插件按数组顺序追加 hook，
 * 排在前面会让本插件的 afterChange 跑在文件落地之前，覆盖写打空。
 *
 * `createWriter` 只为测试注入假写入器而存在（备份/覆盖写那段否则没有任何自动化证据，
 * 而「备份先于覆盖」是本功能可逆性的唯一保障）。生产不传，走真实 `createMediaWriter`。
 */
export function watermarkPlugin(options: { createWriter?: () => MediaWriter } = {}): Plugin {
  // 不传注入时复用默认实例，保持 hook 的函数身份稳定（挂载用例按引用断言）。
  const hook = options.createWriter ? createBakeAfterUpload(options.createWriter) : bakeAfterUpload
  return (config) => ({
    ...config,
    collections: (config.collections ?? []).map((collection) => {
      if (collection.slug !== 'media') return collection
      return {
        ...collection,
        hooks: {
          ...(collection.hooks ?? {}),
          beforeOperation: [...(collection.hooks?.beforeOperation ?? []), captureCleanMaster],
          afterChange: [...(collection.hooks?.afterChange ?? []), hook],
        },
      }
    }),
  })
}
