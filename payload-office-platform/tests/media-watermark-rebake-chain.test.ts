import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Payload, Where } from 'payload'

import { computeWatermarkVersion, mergeWatermarkConfig } from '@/domain/media/watermark'
import {
  hasActiveRebakeChain,
  MEDIA_WATERMARK_DEFER_MS,
  MEDIA_WATERMARK_JOB_LEASE_MS,
  MEDIA_WATERMARK_QUEUE,
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

afterEach(() => {
  vi.useRealTimers()
})

function chainPayload({
  countFor = () => 0,
  queue = async () => {},
  findDocs = [],
  hasNextPage = false,
}: {
  countFor?: (args: CountArgs) => number
  queue?: (args: QueueArgs) => Promise<void>
  findDocs?: unknown[]
  hasNextPage?: boolean
} = {}) {
  const counts: CountArgs[] = []
  const finds: Array<Record<string, unknown>> = []
  const queued: QueueArgs[] = []
  const warnings: string[] = []
  const payload = {
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
      warn: (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '))
      },
    },
  } as unknown as Payload
  return { payload, counts, finds, queued, warnings }
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
})

describe('T4：发版杀掉的段要被放回队列', () => {
  /**
   * 旧实例缩容时正在跑的段停在 `processing = true`，Payload 的 runJobs 只捡
   * `processing = false` 的 job，这一段就永远没人再碰——链条断在这里，而且没有任何报错。
   */
  it('超过租约仍在 processing 的重刷段被放回队列', async () => {
    const queries: Array<{ text: string; values: unknown[] }> = []
    const payload = {
      db: {
        pool: {
          async query(text: string, values: unknown[]) {
            queries.push({ text, values })
            return { rowCount: 1, rows: [{ id: 9 }] }
          },
        },
      },
    } as unknown as Payload

    await expect(recoverStaleWatermarkRebakeJobs(payload, NOW)).resolves.toBe(1)

    expect(queries).toHaveLength(1)
    expect(queries[0].text).toMatch(
      /UPDATE payload_jobs[\s\S]+SET processing = false[\s\S]+queue = \$1[\s\S]+updated_at <= \$2[\s\S]+task_slug = \$3[\s\S]+processing = true[\s\S]+completed_at IS NULL[\s\S]+has_error IS NOT TRUE/,
    )
    expect(queries[0].values).toEqual([MEDIA_WATERMARK_QUEUE, LEASE_CUTOFF, MEDIA_WATERMARK_TASK])
  })
})

describe('T5：同一时刻只跑一段', () => {
  /**
   * 多条链并行时，两段同时处理同一张「无 version、无备份」的图：A 读备份为空之后、
   * 读当前文件之前，B 恰好烘完并覆盖了母版——A 就会把带水印的字节当干净原件写进
   * `media-source/`。窗口极窄，但后果是原件丢失。
   *
   * 按 id 决胜：只有 id 更小的段在跑才让路，两段同时开跑时恰好一段让、一段跑，
   * 不会互相让到谁都不跑。
   */
  it('有 id 更小、仍在租约内的段在跑 → 不扫不烘，推迟 60 秒原样重投自己', async () => {
    vi.useFakeTimers({ now: NOW })
    const harness = chainPayload({
      countFor: ({ collection }) => (collection === 'payload-jobs' ? 1 : 0),
    })

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

    const where = harness.counts[0].where
    expect(harness.counts[0].collection).toBe('payload-jobs')
    expect(where).toEqual({
      and: [
        { taskSlug: { equals: MEDIA_WATERMARK_TASK } },
        { completedAt: { exists: false } },
        { hasError: { not_equals: true } },
        { processing: { equals: true } },
        { updatedAt: { greater_than: LEASE_CUTOFF } },
        { id: { less_than: 500 } },
      ],
    })
  })

  it('没有更早的段在跑 → 照常处理', async () => {
    vi.useFakeTimers({ now: NOW })
    const harness = chainPayload()

    const result = await runTask(harness.payload, { jobId: 500 })

    expect(harness.finds).toHaveLength(1)
    expect(result.output).not.toHaveProperty('deferred')
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
