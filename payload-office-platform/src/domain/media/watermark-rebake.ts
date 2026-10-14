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

/**
 * 别的段正持锁时，本段推迟多久再试。
 *
 * 短于一分钟是刻意的：cron 每个整分钟一轮，runJobs 只捡 `waitUntil < now` 的段，
 * 而段要在整分钟之后几秒才开跑。推迟 60 秒会落到下一个整分钟之后、再等一轮，实际两分钟。
 */
export const MEDIA_WATERMARK_DEFER_MS = 45_000

/**
 * 陈旧回收的上限：累计尝试（中途死掉被放回、抛错后重试都算）达到这个数之后再死掉，
 * 就标失败、不再放回。段若是自己把进程弄死的（超大图把 sharp 撑爆内存之类），无上限地
 * 放回去就是每 16 分钟弄死一个同时承载网页流量的实例，永远如此。
 */
export const MEDIA_WATERMARK_RECOVERY_MAX_TRIES = 3

/** 段锁的 advisory lock 命名空间（两段式键的第一段，'WMRK'）。第二段：0 = 全局段锁，其余 = job id。 */
export const MEDIA_WATERMARK_LOCK_NAMESPACE = 0x574d524b

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
 * `recoverStaleSourceSyncJobs` 相同，另加尝试上限（见 `MEDIA_WATERMARK_RECOVERY_MAX_TRIES`）。
 *
 * 旧实例缩容时正在跑的段停在 `processing = true`，runJobs 只捡 `processing = false` 的 job，
 * 不放回去这一段就永远没人碰——链条断在这里，而且没有任何报错。
 *
 * `updated_at` 是认领时刻、跑的过程中不刷新，所以只按它判会把**活着的长段**也当成陈旧：放回去后
 * 别的实例认领它只能在 job 锁外待命，待命到头以 duplicate 退出时 Payload 又会把行标完成删掉。
 * 因此 job 锁仍被持有的段一律跳过——锁在持锁进程活着时由心跳维持，进程死了才会放掉。
 *
 * 返回放回队列的段数（到上限被标失败的不算）。
 */
export async function recoverStaleWatermarkRebakeJobs(payload: Payload, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MEDIA_WATERMARK_JOB_LEASE_MS).toISOString()
  const result = await payload.db.pool.query<{ id: number; has_error: boolean }>(
    `
    UPDATE payload_jobs
    SET processing = false,
        total_tried = COALESCE(total_tried, 0) + 1,
        has_error = COALESCE(total_tried, 0) + 1 >= $4,
        error = CASE WHEN COALESCE(total_tried, 0) + 1 >= $4
                     THEN jsonb_build_object('message', $5::text)
                     ELSE error END,
        updated_at = NOW()
    WHERE queue = $1
      AND updated_at <= $2
      AND task_slug = $3
      AND processing = true
      AND completed_at IS NULL
      AND has_error IS NOT TRUE
      -- job 锁还被人持有 = 持锁进程活着、心跳还在（见 runWithSegmentLock），不是陈旧段
      AND NOT EXISTS (
        SELECT 1 FROM pg_locks l
         WHERE l.locktype = 'advisory' AND l.granted AND l.objsubid = 2
           AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND l.classid = $6::oid AND l.objid = payload_jobs.id::oid
      )
    RETURNING id, has_error
  `,
    [
      MEDIA_WATERMARK_QUEUE,
      cutoff,
      MEDIA_WATERMARK_TASK,
      MEDIA_WATERMARK_RECOVERY_MAX_TRIES,
      `重刷段累计 ${MEDIA_WATERMARK_RECOVERY_MAX_TRIES} 次尝试后仍中途死掉，已停止放回`,
      MEDIA_WATERMARK_LOCK_NAMESPACE,
    ],
  )
  const givenUp = result.rows.filter((row) => row.has_error).map((row) => row.id)
  if (givenUp.length > 0) {
    payload.logger.error(
      `[watermark] 重刷段 ${givenUp.join(', ')} 累计 ${MEDIA_WATERMARK_RECOVERY_MAX_TRIES} 次尝试后仍中途死掉，` +
        '已标失败、不再放回。多半是某张图让进程崩溃（内存等），须人工排查；排查后再点「重刷全部房源图」。',
    )
  }
  return result.rows.length - givenUp.length
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

type LockClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>
  release: (error?: Error | boolean) => void
  on?: (event: 'error', listener: (error: Error) => void) => unknown
  removeListener?: (event: 'error', listener: (error: Error) => void) => unknown
}

export type SegmentLockResult<T> = { status: 'ran'; value: T } | { status: 'busy' } | { status: 'duplicate' }

/** 同一 job 的副本待命时，多久试一次 job 锁。 */
export const MEDIA_WATERMARK_STANDBY_POLL_MS = 5_000
/** 持锁期间心跳间隔：远小于租约，保证活着的持锁会话不会因「事务内空闲」被 PG 结束。 */
export const MEDIA_WATERMARK_HEARTBEAT_MS = 60_000

/**
 * 同一时刻只跑一段，且同一 job 被重复认领时不弄断链条（OPT-112 E6）。
 *
 * ## 为什么要
 *
 * 两段同时处理同一张「无 version、无备份」的图存在竞态：A 读备份为空之后、读当前文件之前，
 * B 恰好烘完并覆盖了母版，A 就会把带水印的字节当干净原件写进 `media-source/`。
 *
 * Payload 3.86 的 drizzle `updateJobs` 认领 job 是「先查待跑的、再按 id 逐条更新」，不复核
 * `processing = false`：**同一个 job** 会被两个实例同时捡起（两实例本地实测 3 分钟 2 次）。
 * 初版按「有没有 id 更小的段在跑」计数让路，挡不住这一条，也挡不住先查后跑（独立评审）。
 *
 * ## 怎么做
 *
 * 借一条专用连接开事务，事务上 `SET LOCAL idle_in_transaction_session_timeout` = 租约：
 *
 *   1. **job 锁** `(命名空间, job id)`。拿不到 = 这个 job 的另一份副本正持锁 → **待命**：
 *      每隔一会儿再试，直到拿到或待命满一个租约。不能立刻返回——副本一旦正常返回，Payload 就把
 *      **共享的** job 标完成并删除，持锁者随后若被杀，陈旧回收找不到行，链条永久断掉（Codex P1）。
 *   2. 拿到 job 锁后看这一行：已完成或已删除 = 持锁者跑完了 → `duplicate`，调用方什么都不做、
 *      不续投；还没完成 = 持锁者死在半路（或这是第一份）→ 往下走，由本副本把这一段跑完。
 *   3. **全局段锁** `(命名空间, 0)`。拿不到 = 别的段在跑 → `busy`，调用方推迟重投自己。
 *   4. 干活期间每隔 `heartbeatMs` 在持锁连接上发一次 `SELECT 1`：锁在持锁进程活着时一直有效，
 *      段跑得比租约长也不会中途丢锁（Codex P1）。进程被杀时连接断开，锁随会话立即释放；主机整个
 *      消失、TCP 不回 RST 时心跳也停了，PG 最迟一个租约后结束会话放掉锁。
 *   5. 活干完，在**同一个事务里**把这一行标完成再提交：完成标记与释放锁一起生效，待命的副本
 *      拿到锁时一定看得见，不会把刚跑完的段再跑一遍。Payload 随后照常写自己的完成记录并删除这一行。
 *
 * 代价：段运行期间多占一条池连接；同一 job 的副本待命期间也占一条。
 *
 * 没处理的：持锁进程活着却卡死（比如一次 COS 请求永不返回）时，心跳照常、锁一直在，整个重刷会停住
 * 直到进程重启——宁可停住，也不在它可能还在写字节时放别的段进来。
 *
 * `leaseMs` / `pollMs` / `heartbeatMs` 只为测试注入。
 */
export async function runWithSegmentLock<T>(
  payload: Payload,
  jobId: number,
  work: () => Promise<T>,
  {
    leaseMs = MEDIA_WATERMARK_JOB_LEASE_MS,
    pollMs = MEDIA_WATERMARK_STANDBY_POLL_MS,
    heartbeatMs = MEDIA_WATERMARK_HEARTBEAT_MS,
  }: { leaseMs?: number; pollMs?: number; heartbeatMs?: number } = {},
): Promise<SegmentLockResult<T>> {
  const client = (await payload.db.pool.connect()) as unknown as LockClient
  // 持锁会话可能被 PG 结束（心跳停了、或测试里主动结束）：此时 error 事件发在借出的 Client 上。
  // pool-error-handler 已挂监听（并会把连接归还销毁），这里再挂一个空监听，保证脱离它
  // （测试、脚本）时也不会因为未处理的 'error' 事件让进程退出。
  const onError = () => {}
  client.on?.('error', onError)
  let broken = false
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${Math.trunc(leaseMs)}`)
    const tryLock = async (key: number): Promise<boolean> => {
      const { rows } = await client.query('SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS locked', [
        MEDIA_WATERMARK_LOCK_NAMESPACE,
        key,
      ])
      return rows[0]?.locked === true
    }

    const standbyUntil = Date.now() + leaseMs
    let ownJob = await tryLock(jobId)
    while (!ownJob && Date.now() < standbyUntil) {
      await sleepFor(pollMs)
      ownJob = await tryLock(jobId)
    }
    // 待命满一个租约，持锁者还活着在干：交给它，本副本退出。
    if (!ownJob) return { status: 'duplicate' }

    const alive = await client.query('SELECT 1 AS alive FROM payload_jobs WHERE id = $1 AND completed_at IS NULL', [
      jobId,
    ])
    if ((alive.rowCount ?? alive.rows.length) === 0) return { status: 'duplicate' }
    if (!(await tryLock(0))) return { status: 'busy' }

    let beating = Promise.resolve()
    const heartbeat = setInterval(() => {
      beating = beating.then(() => client.query('SELECT 1')).then(
        () => undefined,
        () => undefined,
      )
    }, heartbeatMs)
    let value: T
    try {
      value = await work()
    } finally {
      clearInterval(heartbeat)
      await beating
    }
    try {
      await client.query('UPDATE payload_jobs SET completed_at = NOW() WHERE id = $1 AND completed_at IS NULL', [jobId])
    } catch {
      // 活已经干完、只是写完成标记时会话没了（心跳停了被 PG 结束）：锁随会话一起没了，
      // 不许把这个错误盖到本段的结果上。
      broken = true
    }
    return { status: 'ran', value }
  } finally {
    // 收尾失败（会话已被 PG 结束、连接已被 pool-error-handler 归还）不许盖掉本段的结果。
    try {
      await client.query('COMMIT')
    } catch {
      broken = true
    }
    client.removeListener?.('error', onError)
    try {
      client.release(broken ? true : undefined)
    } catch {
      // 已被 pool-error-handler 归还过：pg-pool 的重复归还会抛错，安全忽略。
    }
  }
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

    const currentVersion = computeWatermarkVersion(config)

    // 同一时刻只跑一段（见 `runWithSegmentLock`）。续投也在锁里做：下一段反正要等下一个整分钟
    // 才可能开跑，放在锁里不耽误它，却能把「本段已续投、job 还没标完成」这个窗口收在锁内——
    // 窗口里同一 job 的迟到副本拿不到锁，不会再跑一遍、多续投一条链。
    const locked = await runWithSegmentLock(payload, Number(job.id), async () => {
      const segment = await rebakeSegment(payload, startAfterId, currentVersion)
      if (segment.hasMore) {
        await queueRebakeSegment(payload, { startAfterId: segment.lastScannedId })
      }
      return segment
    })
    const idle = { processed: 0, skipped: 0, failed: 0, unrecoverable: 0, lastScannedId: startAfterId }
    if (locked.status === 'duplicate') {
      // 这个 job 的另一份副本在跑（或已跑完），续投由它负责；这里再投就是多一条链。
      payload.logger.info(`[watermark] 重刷段 job ${job.id} 已由另一份副本处理，本副本不做事`)
      return { output: { ...idle, hasNextPage: false, duplicate: true } }
    }
    if (locked.status === 'busy') {
      // 让路不是丢段：原样推迟重投自己。
      payload.logger.info(`[watermark] 重刷段 job ${job.id} 让路：另一段正在跑，${MEDIA_WATERMARK_DEFER_MS / 1000} 秒后再试`)
      await queueRebakeSegment(payload, {
        startAfterId,
        waitUntil: new Date(Date.now() + MEDIA_WATERMARK_DEFER_MS),
      })
      return { output: { ...idle, hasNextPage: true, deferred: true } }
    }
    const { result, lastScannedId, hasMore } = locked.value

    // hasNextPage 报的是「游标之后还有活要干、已续投」，不是那次 find 的原始分页标志——
    // truncated 时两者不同，而调用方关心的是链条有没有继续。
    return { output: { ...result, lastScannedId, hasNextPage: hasMore } }
  },
}

/** 一段的实际工作：取候选、重刷、算游标。只在持有段锁时调用。 */
async function rebakeSegment(
  payload: Payload,
  startAfterId: number,
  currentVersion: string,
): Promise<{ result: RebakeResult; lastScannedId: number; hasMore: boolean }> {
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
  return { result, lastScannedId, hasMore }
}
