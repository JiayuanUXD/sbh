/**
 * OPT-069 水印重刷任务。
 *
 * ## 怎么重刷
 *
 * 不自己重新派生——从 `media-source/` 取回干净原件，用
 * `payload.update({ file, overwriteExistingFiles: true })` **重跑整条上传管线**，
 * 于是 `watermarkPlugin` 的 afterChange 自然会按当前配置重新烘焙。
 * 这条路子是 `scripts/backfill-media-sizes.ts` 验证过的（OPT-068）：
 * 同名回写 → `media.url` 不变 → 所有引用它的房源/楼盘/内容页都不用改。
 *
 * ## 幂等
 *
 * 按 `media.watermark.version`（配置的内容哈希）判定，已是当前版本的跳过。
 * 重跑安全，中断后重投也安全。
 *
 * ## 三种情形：只在 `decideRebakeAction` 里定义一次
 *
 * 一张图该怎么处理只看 `watermark.version`（不变量见 plugins/watermark.ts：有 version ⟺
 * 存储字节带着那个版本的水印）：
 *
 *   - 没有 version → 从没烘过，当前文件就是干净原件：备份（覆盖写）后烘；
 *   - 等于当前哈希 → 跳过；
 *   - 旧哈希 → 当前文件带旧水印，只能从 `media-source/` 的备份重烘；**没有备份就已不可恢复**
 *     ——既不能拿带水印的当前文件当原件备份，也不能再烘（会叠第二层）。记 error、计入 failed，
 *     不是跳过。
 *
 * 本文件的 `selectRebakeTargets`（预筛选，按 `hasBackup: false` 问、只认 `skip`）、`rebakeChunk`
 * 与 `scripts/backfill-watermark.ts` 都调 `decideRebakeAction`，不许各自比 version。两处曾各写一份，
 * 同一轮计划评审里就分叉了（脚本把「旧版本缺备份」记成
 * 数据丢失，本文件记成常规跳过），而这种分叉没有任何报错。
 */

import type { Payload, TaskConfig } from 'payload'

import {
  computeWatermarkVersion,
  isBakeableImage,
  mergeWatermarkConfig,
  type WatermarkConfig,
} from './watermark'
import { MEDIA_COS_PREFIX } from '@/lib/storage/cos-config'
import { createMediaWriter, MEDIA_SOURCE_PREFIX } from '@/lib/storage/media-writer'

export const MEDIA_WATERMARK_TASK = 'rebake-media-watermark'
export const MEDIA_WATERMARK_QUEUE = 'media-watermark'
export const MEDIA_WATERMARK_CHUNK = 20

export type RebakeCandidate = {
  id: number
  usage?: string | null
  mimeType?: string | null
  filename?: string | null
  watermark?: { version?: string | null } | null
}

/** 挑出需要重刷的 id。纯函数，便于单测覆盖三条跳过规则。 */
export function selectRebakeTargets({
  docs,
  currentVersion,
}: {
  docs: RebakeCandidate[]
  currentVersion: string
}): number[] {
  const ids: number[] = []
  for (const doc of docs) {
    if (doc.usage !== 'listing-photo') continue
    // 与 plugins/watermark.ts 的 bakeAfterUpload 同一个谓词。这里若比烘焙认得宽
    // （比如 startsWith('image/')），被烘焙拒掉的 gif / svg 永远写不上 version，
    // 于是每轮重刷都会重新选中它、再失败一次，永远如此。
    if (!isBakeableImage(doc.mimeType)) continue
    // 「已是当前版本」也不许在这里自己比 version：这条规则属于 decideRebakeAction，这里只是
    // 提前问一次。skip 只看 version、不看 hasBackup（单测锁住了这条性质），所以按 hasBackup=false
    // 问即可——预筛选不碰存储，真正的三种情形判定留给 rebakeChunk 查到备份之后再做。
    // 同一条规则写在两处，两份会各自漂移而没有任何报错。
    const verdict = decideRebakeAction({
      storedVersion: doc.watermark?.version,
      currentVersion,
      hasBackup: false,
    })
    if (verdict === 'skip') continue
    ids.push(doc.id)
  }
  return ids
}

export type RebakeAction = 'skip' | 'backup-and-bake' | 'bake-from-backup' | 'unrecoverable'

/**
 * 三种情形的唯一定义。纯函数：`hasBackup` 由调用方查好传进来，本函数不碰存储，
 * 四种结果不用存储就能单测。
 *
 * `skip` 只看 version、不看 `hasBackup`——调用方靠这条性质在碰存储之前排除已完成的图
 * （回刷脚本续跑时上万张已完成的图一次存储都不该碰），单测锁住了它。
 */
export function decideRebakeAction({
  storedVersion,
  currentVersion,
  hasBackup,
}: {
  storedVersion: string | null | undefined
  currentVersion: string
  hasBackup: boolean
}): RebakeAction {
  if (!storedVersion) return 'backup-and-bake'
  if (storedVersion === currentVersion) return 'skip'
  return hasBackup ? 'bake-from-backup' : 'unrecoverable'
}

/** 与 `plugins/watermark.ts` 的 resolveConfig 共用 `mergeWatermarkConfig`——两条路
 *  必须对「配置缺省」给出同一个答案，否则会出现「新上传带水印、重刷后不带」的错位。 */
async function resolveConfig(payload: Payload): Promise<WatermarkConfig> {
  const global = (await payload.findGlobal({
    slug: 'site-settings',
    depth: 0,
    overrideAccess: true,
  })) as { watermark?: unknown; siteName?: string | null }
  return mergeWatermarkConfig(global?.watermark, global?.siteName)
}

/** `unrecoverable` 是 `failed` 的子集：计入失败总数，同时单独点名，不许淹没在失败计数里。 */
export type RebakeResult = { processed: number; skipped: number; failed: number; unrecoverable: number }

/** 重刷一批。单张失败不阻断后续（同 import-task.ts 语义 4）。 */
export async function rebakeChunk({
  payload,
  ids,
  currentVersion,
}: {
  payload: Payload
  ids: number[]
  currentVersion: string
}): Promise<RebakeResult> {
  const writer = createMediaWriter()
  const result: RebakeResult = { processed: 0, skipped: 0, failed: 0, unrecoverable: 0 }

  for (const id of ids) {
    try {
      const doc = (await payload.findByID({
        collection: 'media',
        id,
        depth: 0,
        overrideAccess: true,
      })) as unknown as RebakeCandidate
      if (!doc.filename || !doc.mimeType) {
        result.skipped++
        continue
      }
      const backup = await writer.get({ prefix: MEDIA_SOURCE_PREFIX, filename: doc.filename })
      const action = decideRebakeAction({
        storedVersion: doc.watermark?.version,
        currentVersion,
        hasBackup: backup !== null,
      })

      let clean: Buffer
      switch (action) {
        case 'skip':
          // selectRebakeTargets 选中之后、findByID 之前被别的路径烘到了当前版本。
          result.skipped++
          continue
        case 'unrecoverable':
          // 仅存的字节带着旧水印：不能当原件备份，也不能再烘。数据丢失，不是跳过。
          payload.logger.error(
            `[watermark] media ${id} ${doc.filename}：已烘过（version=${doc.watermark?.version}）` +
              `但缺 ${MEDIA_SOURCE_PREFIX}/${doc.filename} 备份，干净原件已不可恢复，须人工排查`,
          )
          result.unrecoverable++
          result.failed++
          continue
        case 'backup-and-bake': {
          // 从没烘过：当前文件就是干净原件。备份**覆盖写**——media-source/ 里若有旧副本，
          // 那是上一次上传的原件（此图后来被重新上传、插件清掉了 version），拿它重烘会把
          // 新上传的图换回旧图。
          const current = await writer.get({ prefix: MEDIA_COS_PREFIX, filename: doc.filename })
          if (!current) throw new Error(`读不到当前文件 ${MEDIA_COS_PREFIX}/${doc.filename}`)
          await writer.put({
            prefix: MEDIA_SOURCE_PREFIX,
            filename: doc.filename,
            body: current,
            mimeType: doc.mimeType,
          })
          clean = current
          break
        }
        case 'bake-from-backup':
          if (!backup) throw new Error('decideRebakeAction 返回 bake-from-backup 但备份为空')
          clean = backup
          break
      }

      await payload.update({
        collection: 'media',
        id,
        data: {},
        depth: 0,
        overrideAccess: true,
        overwriteExistingFiles: true,
        file: { data: clean, mimetype: doc.mimeType, name: doc.filename, size: clean.length },
      })
      result.processed++
    } catch (error) {
      payload.logger.error({ err: error }, `[watermark] media ${id} 重刷失败`)
      result.failed++
    }
  }

  return result
}

export const rebakeWatermarkTask: TaskConfig<typeof MEDIA_WATERMARK_TASK> = {
  slug: MEDIA_WATERMARK_TASK,
  inputSchema: [{ name: 'startAfterId', type: 'number', required: false }],
  retries: { attempts: 2 },
  handler: async ({ input, req }) => {
    const payload = req.payload
    const config = await resolveConfig(payload)
    const currentVersion = computeWatermarkVersion(config)
    const startAfterId = Number(input?.startAfterId ?? 0)

    const page = await payload.find({
      collection: 'media',
      depth: 0,
      limit: MEDIA_WATERMARK_CHUNK * 5,
      sort: 'id',
      overrideAccess: true,
      where: { id: { greater_than: startAfterId } },
    })
    const docs = page.docs as unknown as RebakeCandidate[]
    const ids = selectRebakeTargets({ docs, currentVersion }).slice(0, MEDIA_WATERMARK_CHUNK)
    const result = await rebakeChunk({ payload, ids, currentVersion })

    const lastScannedId = docs.length > 0 ? docs[docs.length - 1].id : startAfterId
    // 还有下一页就把游标投回队列，直到扫完全表。
    if (page.hasNextPage) {
      await payload.jobs.queue({
        task: MEDIA_WATERMARK_TASK,
        queue: MEDIA_WATERMARK_QUEUE,
        input: { startAfterId: lastScannedId },
      })
    }

    return { output: { ...result, lastScannedId, hasNextPage: page.hasNextPage } }
  },
}
