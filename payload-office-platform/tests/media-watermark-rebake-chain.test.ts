import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Payload, Where } from 'payload'

import { computeWatermarkVersion, mergeWatermarkConfig } from '@/domain/media/watermark'
import {
  hasActiveRebakeChain,
  MEDIA_WATERMARK_DEFER_MS,
  MEDIA_WATERMARK_JOB_LEASE_MS,
  MEDIA_WATERMARK_LOCK_NAMESPACE,
  MEDIA_WATERMARK_QUEUE,
  MEDIA_WATERMARK_RECOVERY_MAX_TRIES,
  MEDIA_WATERMARK_REQUEUE_DELAYS_MS,
  MEDIA_WATERMARK_TASK,
  queueRebakeSegment,
  readRebakeProgress,
  rebakeWatermarkTask,
  recoverStaleWatermarkRebakeJobs,
} from '@/domain/media/watermark-rebake'

/**
 * OPT-112：重刷链条的可靠性。
 *
 * 生产上「点了多次都没刷成功」不是某一处坏了，是链条在四个地方各断一次：
 * 续投没有重试（E3）、发版杀掉的段永远停在 processing（E4）、断了再点要从 id 0
 * 一页页扫过已完成的图（E5）、重复点开出多条并行的链（E6）。本文件逐条钉住。
 */

const NOW = new Date('2026-10-14T08:00:00.000Z')
const LEASE_CUTOFF = new Date(NOW.getTime() - MEDIA_WATERMARK_JOB_LEASE_MS).toISOString()
const ENABLED = { watermark: { enabled: true } }
const CURRENT_VERSION = computeWatermarkVersion(mergeWatermarkConfig(ENABLED.watermark, undefined))

type CountArgs = { collection: string; where: Where }
type QueueArgs = { task: string; queue: string; input: { startAfterId: number }; waitUntil?: Date }

/**
 * 段锁（`runWithSegmentLock`）在单测里的替身：按 SQL 文本回答三问——本 job 的锁拿到没有、
 * 这一行还在不在、全局段锁拿到没有。真库上的语义由 `media-watermark-rebake-lock-postgres.test.ts` 钉住。
 */
type LockScript = { ownJob?: boolean; jobAlive?: boolean; segment?: boolean }

afterEach(() => {
  vi.useRealTimers()
})

function fakeLockPool(lock: LockScript, sql: Array<{ text: string; values?: unknown[] }>) {
  return {
    connect: async () => ({
      on: () => {},
      removeListener: () => {},
      release: () => {},
      query: async (text: string, values?: unknown[]) => {
        sql.push({ text, values })
        if (text.includes('pg_try_advisory_xact_lock')) {
          const segment = values?.[1] === 0
          return { rows: [{ locked: segment ? (lock.segment ?? true) : (lock.ownJob ?? true) }] }
        }
        if (text.includes('FROM payload_jobs')) {
          return lock.jobAlive === false ? { rows: [], rowCount: 0 } : { rows: [{ alive: 1 }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      },
    }),
  }
}

function chainPayload({
  countFor = () => 0,
  queue = async () => {},
  findDocs = [],
  hasNextPage = false,
  lock = {},
}: {
  countFor?: (args: CountArgs) => number
  queue?: (args: QueueArgs) => Promise<void>
  findDocs?: unknown[]
  hasNextPage?: boolean
  lock?: LockScript
} = {}) {
  const counts: CountArgs[] = []
  const finds: Array<Record<string, unknown>> = []
  const queued: QueueArgs[] = []
  const warnings: string[] = []
  const infos: string[] = []
  const lockSql: Array<{ text: string; values?: unknown[] }> = []
  const payload = {
    db: { pool: fakeLockPool(lock, lockSql) },
    findGlobal: async () => ENABLED,
    count: async (args: CountArgs) => {
      counts.push(args)
      return { totalDocs: countFor(args) }
    },
    find: async (args: Record<string, unknown>) => {
      finds.push(args)
      return { docs: findDocs, hasNextPage }
    },
    findByID: async () => null,
    jobs: {
      queue: async (args: QueueArgs) => {
        await queue(args)
        queued.push(args)
      },
    },
    logger: {
      error: () => {},
      info: (...args: unknown[]) => {
        infos.push(args.map(String).join(' '))
      },
      warn: (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '))
      },
    },
  } as unknown as Payload
  return { payload, counts, finds, queued, warnings, infos, lockSql }
}

async function runTask(payload: Payload, { jobId = 500, startAfterId = 0 } = {}) {
  const { handler } = rebakeWatermarkTask
  if (typeof handler !== 'function') throw new Error('handler 必须是函数')
  return (await handler({ input: { startAfterId }, job: { id: jobId }, req: { payload } } as never)) as {
    output: Record<string, unknown>
  }
}

describe('T2：候选在库里过滤，不再逐页扫已完成的图', () => {
  /**
   * 断链后再点会从 id 0 重新开链。旧写法只按 `id > 游标` 取页、在内存里挑候选：
   * 每段扫 100 行、每分钟一段，已完成的几千张也要一页页扫过去才能走到没做完的地方。
   * 在库里按「实景图 且 version ≠ 当前哈希（含 null）」过滤，重新开链的代价就只剩真正没做完的图。
   */
  it('find 的 where 带上游标、用途与「不是当前版本」三个条件', async () => {
    vi.useFakeTimers({ now: NOW })
    const harness = chainPayload()

    await runTask(harness.payload, { startAfterId: 2153 })

    expect(harness.finds).toHaveLength(1)
    expect(harness.finds[0]).toMatchObject({
      collection: 'media',
      sort: 'id',
      where: {
        and: [
          { id: { greater_than: 2153 } },
          { usage: { equals: 'listing-photo' } },
          // drizzle 把非 null 值的 not_equals 译成 `IS NULL OR <> 值`，从没烘过的图（null）也在内。
          { 'watermark.version': { not_equals: CURRENT_VERSION } },
        ],
      },
    })
  })
})

describe('T3：续投失败要重试，重试完仍失败就交给任务级重试', () => {
  it('前两次投递抛错、第三次成功 → 只投进去一次，中间按退避等', async () => {
    const sleeps: number[] = []
    let attempts = 0
    const harness = chainPayload({
      queue: async () => {
        attempts++
        if (attempts < 3) throw new Error('timeout exceeded when trying to connect')
      },
    })

    await queueRebakeSegment(harness.payload, { startAfterId: 42 }, { sleep: async (ms) => void sleeps.push(ms) })

    expect(attempts).toBe(3)
    expect(sleeps).toEqual(MEDIA_WATERMARK_REQUEUE_DELAYS_MS.slice(0, 2))
    expect(harness.queued).toEqual([
      { task: MEDIA_WATERMARK_TASK, queue: MEDIA_WATERMARK_QUEUE, input: { startAfterId: 42 } },
    ])
  })

  it('每次都失败 → 用尽退避后把最后一个错误抛出去（不吞：吞了链条就静默断掉）', async () => {
    let attempts = 0
    const harness = chainPayload({
      queue: async () => {
        attempts++
        throw new Error('timeout exceeded when trying to connect')
      },
    })

    await expect(
      queueRebakeSegment(harness.payload, { startAfterId: 42 }, { sleep: async () => {} }),
    ).rejects.toThrow('timeout exceeded')
    // 首投 + 每档退避各一次；每次失败都留一条 warn，最后一条写明交给任务级重试。
    expect(attempts).toBe(MEDIA_WATERMARK_REQUEUE_DELAYS_MS.length + 1)
    expect(harness.warnings).toHaveLength(attempts)
    expect(harness.warnings.at(-1)).toContain('交给任务级重试')
  })

  /**
   * 抛出去之后由 Payload 按任务级 `retries` 重跑本段。旧配置 `attempts: 2` 不带退避，
   * 池风暴里两次失败就 `hasError`、链条永久结束。重跑是幂等的：已烘成当前版本的图
   * 被 T2 的过滤直接排除。
   */
  it('任务级重试：5 次、指数退避 30 秒起', () => {
    expect(rebakeWatermarkTask.retries).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
    })
  })

  /** 评审 Minor 4：handler 续投下一段若退回裸 `payload.jobs.queue`，上面几条全都照绿。 */
  it('handler 续投下一段走的是带重试的投递：首投失败、退避后成功，链条不断', async () => {
    vi.useFakeTimers({ now: NOW })
    let attempts = 0
    const harness = chainPayload({
      hasNextPage: true,
      queue: async () => {
        attempts++
        if (attempts === 1) throw new Error('timeout exceeded when trying to connect')
      },
    })

    const pending = runTask(harness.payload, { startAfterId: 300 })
    await vi.advanceTimersByTimeAsync(MEDIA_WATERMARK_REQUEUE_DELAYS_MS[0])
    const result = await pending

    expect(attempts).toBe(2)
    expect(harness.queued).toEqual([
      { task: MEDIA_WATERMARK_TASK, queue: MEDIA_WATERMARK_QUEUE, input: { startAfterId: 300 } },
    ])
    expect(result.output).toMatchObject({ hasNextPage: true })
  })
})

describe('T4：发版杀掉的段要被放回队列', () => {
  function recoveryPayload(rows: Array<{ id: number; has_error: boolean }>) {
    const queries: Array<{ text: string; values: unknown[] }> = []
    const errors: string[] = []
    const payload = {
      db: {
        pool: {
          async query(text: string, values: unknown[]) {
            queries.push({ text, values })
            return { rowCount: rows.length, rows }
          },
        },
      },
      logger: { error: (...args: unknown[]) => errors.push(args.map(String).join(' ')) },
    } as unknown as Payload
    return { payload, queries, errors }
  }

  /**
   * 旧实例缩容时正在跑的段停在 `processing = true`，Payload 的 runJobs 只捡
   * `processing = false` 的 job，这一段就永远没人再碰——链条断在这里，而且没有任何报错。
   */
  it('超过租约仍在 processing 的重刷段被放回队列', async () => {
    const harness = recoveryPayload([{ id: 9, has_error: false }])

    await expect(recoverStaleWatermarkRebakeJobs(harness.payload, NOW)).resolves.toBe(1)

    expect(harness.queries).toHaveLength(1)
    expect(harness.queries[0].text).toMatch(
      /UPDATE payload_jobs[\s\S]+SET processing = false[\s\S]+queue = \$1[\s\S]+updated_at <= \$2[\s\S]+task_slug = \$3[\s\S]+processing = true[\s\S]+completed_at IS NULL[\s\S]+has_error IS NOT TRUE/,
    )
    expect(harness.queries[0].values.slice(0, 4)).toEqual([
      MEDIA_WATERMARK_QUEUE,
      LEASE_CUTOFF,
      MEDIA_WATERMARK_TASK,
      MEDIA_WATERMARK_RECOVERY_MAX_TRIES,
    ])
    expect(harness.errors).toEqual([])
  })

  /**
   * 评审 Minor 3：段若是自己把进程弄死的（比如超大图把 sharp 撑爆内存），无上限地放回去
   * 就是每 16 分钟弄死一个同时承载网页流量的实例，永远如此。每放回一次记一次尝试，
   * 累计到上限就标失败、不再放回，并留一条 error。
   */
  it('每放回一次累计一次尝试，到上限就标失败、不再放回，并留 error 日志', async () => {
    const harness = recoveryPayload([{ id: 9, has_error: true }])

    await expect(recoverStaleWatermarkRebakeJobs(harness.payload, NOW)).resolves.toBe(0)

    expect(harness.queries[0].text).toMatch(/total_tried = COALESCE\(total_tried, 0\) \+ 1/)
    expect(harness.queries[0].text).toMatch(/has_error = COALESCE\(total_tried, 0\) \+ 1 >= \$4/)
    expect(harness.errors.join('\n')).toContain('9')
  })
})

describe('T5：同一时刻只跑一段（事务级 advisory lock）', () => {
  /**
   * 多条链并行时，两段同时处理同一张「无 version、无备份」的图：A 读备份为空之后、
   * 读当前文件之前，B 恰好烘完并覆盖了母版——A 就会把带水印的字节当干净原件写进
   * `media-source/`。窗口极窄，但后果是原件丢失。另外 Payload 认领 job 不是原子的，
   * 同一个 job 可能被两个实例同时捡起，每份副本各续投一段，链条就此翻倍。
   */
  it('拿到锁 → 照常处理；锁在事务里拿，事务带「空闲上限 = 租约」，处理完提交释放', async () => {
    vi.useFakeTimers({ now: NOW })
    const harness = chainPayload()

    const result = await runTask(harness.payload, { jobId: 500 })

    expect(harness.finds).toHaveLength(1)
    expect(result.output).not.toHaveProperty('deferred')
    const texts = harness.lockSql.map((entry) => entry.text.trim())
    expect(texts[0]).toBe('BEGIN')
    expect(texts[1]).toBe(`SET LOCAL idle_in_transaction_session_timeout = ${MEDIA_WATERMARK_JOB_LEASE_MS}`)
    expect(harness.lockSql[2].values).toEqual([MEDIA_WATERMARK_LOCK_NAMESPACE, 500])
    expect(harness.lockSql.at(-1)?.text.trim()).toBe('COMMIT')
  })

  it('别的段正持锁 → 不扫不烘，推迟 45 秒原样重投自己', async () => {
    vi.useFakeTimers({ now: NOW })
    const harness = chainPayload({ lock: { segment: false } })

    const result = await runTask(harness.payload, { jobId: 500, startAfterId: 77 })

    expect(harness.finds).toEqual([])
    expect(harness.queued).toEqual([
      {
        task: MEDIA_WATERMARK_TASK,
        queue: MEDIA_WATERMARK_QUEUE,
        input: { startAfterId: 77 },
        waitUntil: new Date(NOW.getTime() + MEDIA_WATERMARK_DEFER_MS),
      },
    ])
    expect(result.output).toMatchObject({ deferred: true, lastScannedId: 77, hasNextPage: true })
  })

  /**
   * 评审 Minor 2：cron 每个整分钟一轮，runJobs 只捡 `waitUntil < now` 的段。推迟 60 秒时，
   * 段在整分钟后几秒才开跑，推迟到的时刻落在下一个整分钟之后，要再等一轮——实际是两分钟。
   */
  it('推迟时长短于一分钟，赶得上下一个整分钟的 cron', () => {
    expect(MEDIA_WATERMARK_DEFER_MS).toBeLessThan(55_000)
  })

  it('同一个 job 的另一份副本正在跑 → 什么都不做，也不续投（续投就是多一条链）', async () => {
    vi.useFakeTimers({ now: NOW })
    const harness = chainPayload({ lock: { ownJob: false } })

    const result = await runTask(harness.payload, { jobId: 500, startAfterId: 77 })

    expect(harness.finds).toEqual([])
    expect(harness.queued).toEqual([])
    expect(result.output).toMatchObject({ duplicate: true, hasNextPage: false })
    // 生产上靠这一行看出「同一个 job 被两个实例捡起」确实发生过
    expect(harness.infos.join('\n')).toContain('job 500 已由另一份副本处理')
  })

  it('这个 job 已经被另一份副本跑完（行已删除）→ 同样什么都不做', async () => {
    vi.useFakeTimers({ now: NOW })
    const harness = chainPayload({ lock: { jobAlive: false } })

    const result = await runTask(harness.payload, { jobId: 500, startAfterId: 77 })

    expect(harness.finds).toEqual([])
    expect(harness.queued).toEqual([])
    expect(result.output).toMatchObject({ duplicate: true })
  })
})

describe('T6：路由用的「链条是否在跑」与进度', () => {
  it('在跑 = 未完成、未报错，且（待跑 或 在租约内处理中）', async () => {
    const harness = chainPayload({ countFor: () => 1 })

    await expect(hasActiveRebakeChain(harness.payload, NOW)).resolves.toBe(true)

    expect(harness.counts[0]).toMatchObject({
      collection: 'payload-jobs',
      where: {
        and: [
          { taskSlug: { equals: MEDIA_WATERMARK_TASK } },
          { completedAt: { exists: false } },
          { hasError: { not_equals: true } },
          // 超过租约的 processing 是被发版杀掉的段：T4 会把它放回队列，但在那之前不算在跑，
          // 否则按钮会被一条死链永久锁住。
          { or: [{ processing: { equals: false } }, { updatedAt: { greater_than: LEASE_CUTOFF } }] },
        ],
      },
    })
  })

  it('没有未结束的段 → 不在跑', async () => {
    const harness = chainPayload({ countFor: () => 0 })
    await expect(hasActiveRebakeChain(harness.payload, NOW)).resolves.toBe(false)
  })

  it('进度：总数 = 可烘的实景图，已完成 = 其中 version 等于当前哈希的', async () => {
    const harness = chainPayload({
      countFor: ({ collection, where }) => {
        if (collection === 'payload-jobs') return 0
        return JSON.stringify(where).includes('"equals":"' + CURRENT_VERSION + '"') ? 1234 : 17000
      },
    })

    await expect(readRebakeProgress(harness.payload, CURRENT_VERSION, NOW)).resolves.toEqual({
      total: 17000,
      done: 1234,
      running: false,
    })

    const mediaCounts = harness.counts.filter((call) => call.collection === 'media')
    expect(mediaCounts.map((call) => call.where)).toEqual([
      {
        and: [
          { usage: { equals: 'listing-photo' } },
          { mimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] } },
        ],
      },
      {
        and: [
          { usage: { equals: 'listing-photo' } },
          { mimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] } },
          { 'watermark.version': { equals: CURRENT_VERSION } },
        ],
      },
    ])
  })
})
