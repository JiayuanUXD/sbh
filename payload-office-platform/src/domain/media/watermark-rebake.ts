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
 * ## 开关关着时不做事
 *
 * 与 `scripts/backfill-watermark.ts` 拒跑 `--execute` 同一个理由：开关关着时烘焙不发生，
 * 这个任务却会把整张表走一遍并重跑上传管线，既看不到变化也永不收敛（version 一直是空的，
 * 下次点击原样重做）。所以 handler 一开头就查 `config.enabled`，关着就记一条 warn 早退。
 *
 * ## 三种情形：只在 `decideRebakeAction` 里定义一次
 *
 * 一张图该怎么处理只看 `watermark.version`（不变量见 plugins/watermark.ts：有 version ⟺
 * 存储字节带着那个版本的水印）：
 *
 *   - 没有 version → 没烘成过。`media-source/` 里有备份就以备份为准（**不覆盖**），没有才
 *     把当前文件当干净原件存进去，然后烘。「没有 version」不等于「当前文件一定干净」：
 *     烘焙不是原子的，覆盖写母版之后、写 version 之前被打断，行会回滚成 version=null，
 *     而存储里已经是带水印的母版了；那一刻的干净原件只剩备份里那一份；
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

import type { Payload, TaskConfig, Where } from 'payload'

import { BAKEABLE_MIME_TYPES, computeWatermarkVersion, isBakeableImage } from './watermark'
import { resolveWatermarkConfig } from './watermark-settings'
import { MEDIA_COS_PREFIX } from '@/lib/storage/cos-config'
import { createMediaWriter, MEDIA_SOURCE_PREFIX, type MediaWriter } from '@/lib/storage/media-writer'

export const MEDIA_WATERMARK_TASK = 'rebake-media-watermark'
export const MEDIA_WATERMARK_QUEUE = 'media-watermark'
export const MEDIA_WATERMARK_CHUNK = 20

/**
 * 处理中段的租约（OPT-112 E4）。超过它仍是 `processing = true` 的段视为已死（发版时旧实例
 * 缩容会杀掉正在跑的段），由 `recoverStaleWatermarkRebakeJobs` 放回队列。与同步 / 导入同口径；
 * 一段 20 张图正常一两分钟跑完，15 分钟留足了余量。
 */
export const MEDIA_WATERMARK_JOB_LEASE_MS = 15 * 60 * 1000

/** 有更早的段在跑时，本段推迟多久再试（与 cron 的 60 秒一轮对齐）。 */
export const MEDIA_WATERMARK_DEFER_MS = 60_000

/**
 * 续投下一段失败后的退避（OPT-112 E3）。失败几乎都是池子拿连接超时（10s），
 * 风暴通常持续十几秒到几十秒；三次退避合计 22 秒，再失败就交给任务级重试。
 */
export const MEDIA_WATERMARK_REQUEUE_DELAYS_MS = [2_000, 5_000, 15_000] as const

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
 *
 * `backup-and-bake` 同样不看 `hasBackup`：备份在不在不改变「该烘」这个裁决，只改变
 * **烘焙源从哪来**（有备份就用备份、且不覆盖它）。那一步属于调用方的存储编排，本函数不碰存储。
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

/** `unrecoverable` 是 `failed` 的子集：计入失败总数，同时单独点名，不许淹没在失败计数里。 */
export type RebakeResult = { processed: number; skipped: number; failed: number; unrecoverable: number }

/**
 * 重刷一批。单张失败不阻断后续（同 import-task.ts 语义 4）。
 *
 * `createWriter` 只为测试注入假写入器而存在（与 `plugins/watermark.ts` 的
 * `createBakeAfterUpload` 同一手法）。这段是本任务唯一**不可逆改写字节**的代码，
 * 没有注入点就一行都覆盖不到：调换「先备份后覆盖」的顺序、把 unrecoverable 错记成
 * skip、拿当前带水印的字节去覆盖备份，全都能在纯函数单测下全绿通过。生产不传。
 */
export async function rebakeChunk({
  payload,
  ids,
  currentVersion,
  createWriter = createMediaWriter,
}: {
  payload: Payload
  ids: number[]
  currentVersion: string
  createWriter?: () => MediaWriter
}): Promise<RebakeResult> {
  const writer = createWriter()
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
          // 「没有 version」**不等于**「当前文件一定干净」：烘焙不是原子的（先备份、再覆盖写
          // 母版与派生、最后才写 version），中途容器被换掉 / 事务回滚，这一行会退回
          // version=null，而存储里已经是带水印的母版。所以：
          //
          //   - 备份已存在 → 以备份为准，**一个字节都不许往 media-source/ 写**。备份由
          //     bakeAfterUpload 维护（新字节落地时无论开关开关都写），它就是这张图最新的
          //     干净原件；拿当前文件盖过去等于把上一次中断前刚存下的原件永久换成带水印的字节，
          //     并在重烘时叠上第二层。
          //   - 备份不存在 → 才把当前文件当干净原件存进去（首次回刷的常态）。
          const current = backup ?? (await writer.get({ prefix: MEDIA_COS_PREFIX, filename: doc.filename }))
          if (!current) throw new Error(`读不到当前文件 ${MEDIA_COS_PREFIX}/${doc.filename}`)
          if (!backup) {
            await writer.put({
              prefix: MEDIA_SOURCE_PREFIX,
              filename: doc.filename,
              body: current,
              mimeType: doc.mimeType,
            })
          }
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

/**
 * 任务从库里取的候选：游标之后、实景图、**不是当前版本**（OPT-112 E5）。
 *
 * 旧写法只按 `id > 游标` 取页、在内存里挑候选，链条断了运营再点就从 id 0 开链，
 * 每分钟扫 100 行，已完成的几千张也要一页页扫过去。把「不是当前版本」放进库里过滤，
 * 重新开链的代价就只剩真正没做完的图。
 *
 * `not_equals` 对非 null 值由 drizzle 译成 `IS NULL OR <> 值`，从没烘过的图也在内。
 * 格式（gif / svg）不在这里过滤：`isBakeableImage` 会规范化大小写与参数，库里比不出同样的结果，
 * 留给 `selectRebakeTargets` 在内存里判——它们为数极少，游标照样跨过去。
 */
export function rebakeCandidateWhere(startAfterId: number, currentVersion: string): Where {
  return {
    and: [
      { id: { greater_than: startAfterId } },
      { usage: { equals: 'listing-photo' } },
      { 'watermark.version': { not_equals: currentVersion } },
    ],
  }
}

const sleepFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 投下一段（或推迟重投本段），失败按 `MEDIA_WATERMARK_REQUEUE_DELAYS_MS` 退避重试（OPT-112 E3）。
 *
 * 用尽仍失败就**抛出**最后一个错误，不许吞：吞了链条就静默断在这里。抛出去由 Payload 按
 * 任务级 `retries` 重跑本段，重跑是幂等的（已烘成当前版本的图被 `rebakeCandidateWhere` 排除）。
 *
 * `sleep` 只为测试注入。
 */
export async function queueRebakeSegment(
  payload: Payload,
  { startAfterId, waitUntil }: { startAfterId: number; waitUntil?: Date },
  { sleep = sleepFor }: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const args = {
    task: MEDIA_WATERMARK_TASK,
    queue: MEDIA_WATERMARK_QUEUE,
    input: { startAfterId },
    ...(waitUntil ? { waitUntil } : {}),
  } as const
  for (let attempt = 0; ; attempt++) {
    try {
      await payload.jobs.queue(args)
      return
    } catch (error) {
      const delay = MEDIA_WATERMARK_REQUEUE_DELAYS_MS[attempt]
      payload.logger.warn(
        { err: error },
        `[watermark] 投递重刷段失败（startAfterId=${startAfterId}，第 ${attempt + 1} 次）` +
          (delay === undefined ? '，交给任务级重试' : `，${delay}ms 后重试`),
      )
      if (delay === undefined) throw error
      await sleep(delay)
    }
  }
}

/**
 * 发版杀掉的段放回队列（OPT-112 E4）。由 `shouldAutoRun` 每轮调用，写法与
 * `recoverStaleSourceSyncJobs` 相同。
 *
 * 旧实例缩容时正在跑的段停在 `processing = true`，runJobs 只捡 `processing = false` 的 job，
 * 不放回去这一段就永远没人碰——链条断在这里，而且没有任何报错。
 */
export async function recoverStaleWatermarkRebakeJobs(payload: Payload, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MEDIA_WATERMARK_JOB_LEASE_MS).toISOString()
  const result = await payload.db.pool.query<{ id: number }>(
    `
    UPDATE payload_jobs
    SET processing = false, updated_at = NOW()
    WHERE queue = $1
      AND updated_at <= $2
      AND task_slug = $3
      AND processing = true
      AND completed_at IS NULL
      AND has_error IS NOT TRUE
    RETURNING id
  `,
    [MEDIA_WATERMARK_QUEUE, cutoff, MEDIA_WATERMARK_TASK],
  )
  return result.rowCount ?? result.rows.length
}

/** 未结束（未完成、未报错）的重刷段。 */
const UNFINISHED_SEGMENT: Where[] = [
  { taskSlug: { equals: MEDIA_WATERMARK_TASK } },
  { completedAt: { exists: false } },
  { hasError: { not_equals: true } },
]

const leaseCutoff = (now: Date): string => new Date(now.getTime() - MEDIA_WATERMARK_JOB_LEASE_MS).toISOString()

/**
 * 链条是否在跑：有未结束的段，且它是待跑的、或在租约内处理中（OPT-112 E6）。
 *
 * 超过租约的 processing 是被发版杀掉的段，`recoverStaleWatermarkRebakeJobs` 会把它放回队列，
 * 但在那之前不算在跑——否则按钮会被一条死链永久锁住。
 */
export async function hasActiveRebakeChain(payload: Payload, now = new Date()): Promise<boolean> {
  const { totalDocs } = await payload.count({
    collection: 'payload-jobs',
    overrideAccess: true,
    where: {
      and: [
        ...UNFINISHED_SEGMENT,
        { or: [{ processing: { equals: false } }, { updatedAt: { greater_than: leaseCutoff(now) } }] },
      ],
    },
  })
  return totalDocs > 0
}

/**
 * 有没有 id 比自己小、仍在租约内处理中的段（OPT-112 E6）。
 *
 * 多条链并行时，两段同时处理同一张「无 version、无备份」的图存在竞态：A 读备份为空之后、
 * 读当前文件之前，B 恰好烘完并覆盖了母版，A 就会把带水印的字节当干净原件写进 `media-source/`。
 * 只让 id 最小的那段跑：两段同时开跑时恰好一段让、一段跑，不会互相让到谁都不跑。
 *
 * 管不到的：同一个 job 被两个实例同时捡起（切流退场窗口里的旧实例，见 OPT-112 旁支），
 * 两边 id 相同，这里看不出来。
 */
async function hasEarlierRunningSegment(payload: Payload, selfId: number | string, now: Date): Promise<boolean> {
  const { totalDocs } = await payload.count({
    collection: 'payload-jobs',
    overrideAccess: true,
    where: {
      and: [
        ...UNFINISHED_SEGMENT,
        { processing: { equals: true } },
        { updatedAt: { greater_than: leaseCutoff(now) } },
        { id: { less_than: selfId } },
      ],
    },
  })
  return totalDocs > 0
}

export type RebakeProgress = { total: number; done: number; running: boolean }

/**
 * 「站点设置 → 图片水印」上显示的进度（OPT-112 E7）。
 *
 * 总数 = 可烘的实景图，已完成 = 其中 version 等于当前哈希的。格式按 `BAKEABLE_MIME_TYPES`
 * 在库里精确比较，大小写或带参数的异常写法两边都不计入，因此 `done ≤ total` 恒成立。
 * 失败（缺备份等）的图永远到不了 done：链条跑完后 `total - done` 就是要人看日志的那些。
 *
 * 三次计数顺序执行而不是 `Promise.all`：按钮在跑时每 15 秒轮询一次，别为它一次借三条连接。
 */
export async function readRebakeProgress(
  payload: Payload,
  currentVersion: string,
  now = new Date(),
): Promise<RebakeProgress> {
  const bakeable: Where[] = [
    { usage: { equals: 'listing-photo' } },
    { mimeType: { in: [...BAKEABLE_MIME_TYPES] } },
  ]
  const total = await payload.count({ collection: 'media', overrideAccess: true, where: { and: bakeable } })
  const done = await payload.count({
    collection: 'media',
    overrideAccess: true,
    where: { and: [...bakeable, { 'watermark.version': { equals: currentVersion } }] },
  })
  const running = await hasActiveRebakeChain(payload, now)
  return { total: total.totalDocs, done: done.totalDocs, running }
}

export const rebakeWatermarkTask: TaskConfig<typeof MEDIA_WATERMARK_TASK> = {
  slug: MEDIA_WATERMARK_TASK,
  inputSchema: [{ name: 'startAfterId', type: 'number', required: false }],
  // OPT-112 E3：旧配置 `attempts: 2` 不带退避，池风暴里两次失败就 hasError、链条永久结束。
  // 重跑本段是幂等的（见 `queueRebakeSegment`），30s → 8min 的指数退避足够熬过一次风暴。
  retries: { attempts: 5, backoff: { type: 'exponential', delay: 30_000 } },
  handler: async ({ input, job, req }) => {
    const payload = req.payload
    const config = await resolveWatermarkConfig(payload)
    const startAfterId = Number(input?.startAfterId ?? 0)

    // 开关关着时早退，与 `scripts/backfill-watermark.ts` 拒跑 `--execute` 同一个理由：
    // 关着时 `bakeAfterUpload` 不烘，这个任务却会走完整张 media 表，对每张实景图做一次
    // 备份 put、一次 get、外加整条上传管线（母版 + 三档派生），**看不到任何变化，而且
    // 永不收敛**——`clearIfStale()` 让 version 保持为空，下次点击把这一切重做一遍。
    // 前端弹的是「已加入队列」，所以日志里必须留下真实原因，否则运营只会觉得「点了没反应」。
    if (!config.enabled) {
      payload.logger.warn(
        '[watermark] 水印开关当前关闭，重刷任务不做任何处理。' +
          '先去「站点设置 → 图片水印」勾上「启用水印」并保存，再点「重刷全部房源图」。',
      )
      return {
        output: {
          processed: 0,
          skipped: 0,
          failed: 0,
          unrecoverable: 0,
          lastScannedId: startAfterId,
          hasNextPage: false,
        },
      }
    }

    // 同一时刻只跑一段（见 `hasEarlierRunningSegment`）。让路不是丢段：原样推迟重投自己。
    const now = new Date()
    if (await hasEarlierRunningSegment(payload, job.id, now)) {
      await queueRebakeSegment(payload, {
        startAfterId,
        waitUntil: new Date(now.getTime() + MEDIA_WATERMARK_DEFER_MS),
      })
      return {
        output: {
          processed: 0,
          skipped: 0,
          failed: 0,
          unrecoverable: 0,
          lastScannedId: startAfterId,
          hasNextPage: true,
          deferred: true,
        },
      }
    }

    const currentVersion = computeWatermarkVersion(config)

    const page = await payload.find({
      collection: 'media',
      depth: 0,
      limit: MEDIA_WATERMARK_CHUNK * 5,
      sort: 'id',
      overrideAccess: true,
      where: rebakeCandidateWhere(startAfterId, currentVersion),
    })
    const docs = page.docs as unknown as RebakeCandidate[]
    const candidates = selectRebakeTargets({ docs, currentVersion })
    const ids = candidates.slice(0, MEDIA_WATERMARK_CHUNK)
    const result = await rebakeChunk({ payload, ids, currentVersion })

    // 本页候选比分块上限多，说明第 CHUNK+1 个及其之后的行本轮根本没检查。
    const truncated = candidates.length > ids.length

    // 游标 = 本轮**实际做出判定**的最后一行，不是本页扫到的最后一行。
    //
    // 取页尾会在 truncated 时把没检查过的候选连同游标一起跨过去：一趟链条走完全表却
    // 只处理了其中一部分（一页扫 100 只做 20，1.7 万张要人点五次）。
    // 反过来取「最后一个**成功**的 id」又会在 unrecoverable（永远写不上 version）这类图上
    // 原地打转。取「最后一个判定过的 id」两头都避开——判定与结果无关，失败/跳过的行同样
    // 被跨过，游标严格递增（docs 按 id 升序，ids 保序，故它恒 > startAfterId），链条必然终止。
    const lastScannedId = truncated
      ? ids[ids.length - 1]
      : docs.length > 0
        ? docs[docs.length - 1].id
        : startAfterId

    // truncated 时即使 hasNextPage=false 也必须续投：页内还有候选没处理。
    // 只按 page.hasNextPage 判，会把整张表**最后一页**的余量永久丢掉。
    const hasMore = truncated || page.hasNextPage
    if (hasMore) {
      await queueRebakeSegment(payload, { startAfterId: lastScannedId })
    }

    // hasNextPage 报的是「游标之后还有活要干、已续投」，不是那次 find 的原始分页标志——
    // truncated 时两者不同，而调用方关心的是链条有没有继续。
    return { output: { ...result, lastScannedId, hasNextPage: hasMore } }
  },
}
