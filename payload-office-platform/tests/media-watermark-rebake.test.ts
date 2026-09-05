import { describe, expect, it } from 'vitest'

import type { Payload } from 'payload'

import {
  decideRebakeAction,
  MEDIA_WATERMARK_CHUNK,
  MEDIA_WATERMARK_QUEUE,
  MEDIA_WATERMARK_TASK,
  rebakeChunk,
  type RebakeCandidate,
  rebakeWatermarkTask,
  selectRebakeTargets,
} from '@/domain/media/watermark-rebake'
import { MEDIA_COS_PREFIX } from '@/lib/storage/cos-config'
import { MEDIA_SOURCE_PREFIX, type MediaWriter } from '@/lib/storage/media-writer'

const CURRENT = 'abc123def4567890'

describe('selectRebakeTargets', () => {
  it('只挑 usage=listing-photo 的图片', () => {
    const ids = selectRebakeTargets({
      docs: [
        { id: 1, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: null },
        { id: 2, usage: 'brand', mimeType: 'image/jpeg', watermark: null },
        { id: 3, usage: 'article', mimeType: 'image/jpeg', watermark: null },
      ],
      currentVersion: CURRENT,
    })
    expect(ids).toEqual([1])
  })

  it('跳过已是当前版本的——幂等，重跑安全', () => {
    const ids = selectRebakeTargets({
      docs: [
        { id: 1, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: { version: CURRENT } },
        { id: 2, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: { version: 'stale' } },
        { id: 3, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: null },
      ],
      currentVersion: CURRENT,
    })
    expect(ids).toEqual([2, 3])
  })

  it('预筛选与 decideRebakeAction 同一个裁决——「已是当前版本」既被这里排除、也被它判成 skip；不是 skip 的照选', () => {
    const current = { id: 1, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: { version: CURRENT } }
    expect(selectRebakeTargets({ docs: [current], currentVersion: CURRENT })).toEqual([])
    expect(
      decideRebakeAction({ storedVersion: current.watermark.version, currentVersion: CURRENT, hasBackup: false }),
    ).toBe('skip')

    const stale = { ...current, watermark: { version: 'stale' } }
    expect(selectRebakeTargets({ docs: [stale], currentVersion: CURRENT })).toEqual([1])
    expect(
      decideRebakeAction({ storedVersion: stale.watermark.version, currentVersion: CURRENT, hasBackup: false }),
    ).not.toBe('skip')
  })

  it('跳过非图片（视频没有水印可言）', () => {
    const ids = selectRebakeTargets({
      docs: [
        { id: 1, usage: 'listing-photo', mimeType: 'video/mp4', watermark: null },
        { id: 2, usage: 'listing-photo', mimeType: 'image/png', watermark: null },
      ],
      currentVersion: CURRENT,
    })
    expect(ids).toEqual([2])
  })

  it('gif / svg 也跳过——烘焙拒收它们，重刷若选中就会每轮重选、每轮失败，永远如此', () => {
    const ids = selectRebakeTargets({
      docs: [
        { id: 1, usage: 'listing-photo', mimeType: 'image/gif', watermark: null },
        { id: 2, usage: 'listing-photo', mimeType: 'image/svg+xml', watermark: null },
        { id: 3, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: null },
      ],
      currentVersion: CURRENT,
    })
    expect(ids).toEqual([3])
  })

  it('缺 mimeType 的记录跳过而不是崩', () => {
    expect(
      selectRebakeTargets({
        docs: [{ id: 1, usage: 'listing-photo', mimeType: null, watermark: null }],
        currentVersion: CURRENT,
      }),
    ).toEqual([])
  })
})

describe('decideRebakeAction', () => {
  it('没有 storedVersion（null 或 undefined）→ backup-and-bake：从没烘过，当前文件就是干净原件', () => {
    expect(decideRebakeAction({ storedVersion: null, currentVersion: CURRENT, hasBackup: false })).toBe('backup-and-bake')
    expect(decideRebakeAction({ storedVersion: undefined, currentVersion: CURRENT, hasBackup: false })).toBe('backup-and-bake')
  })

  it('没有 storedVersion 时不看 hasBackup——裁决仍是 backup-and-bake，「备份已存在怎么办」由调用方处理', () => {
    // 备份在不在不改变裁决（预筛选按 hasBackup=false 问的性质靠它），但**已存在的备份不许被覆盖**：
    // 那是上一次烘焙中断前写下的干净原件，当前文件反而可能已经是带水印的（见 rebakeChunk 用例）。
    expect(decideRebakeAction({ storedVersion: null, currentVersion: CURRENT, hasBackup: true })).toBe('backup-and-bake')
  })

  it('storedVersion 等于当前哈希 → skip，与有无备份无关（调用方据此在碰存储之前排除它）', () => {
    expect(decideRebakeAction({ storedVersion: CURRENT, currentVersion: CURRENT, hasBackup: true })).toBe('skip')
    expect(decideRebakeAction({ storedVersion: CURRENT, currentVersion: CURRENT, hasBackup: false })).toBe('skip')
  })

  it('旧哈希且有备份 → bake-from-backup', () => {
    expect(decideRebakeAction({ storedVersion: 'stale', currentVersion: CURRENT, hasBackup: true })).toBe('bake-from-backup')
  })

  it('旧哈希且无备份 → unrecoverable：既不能拿带水印的当前文件当原件，也不能再烘', () => {
    expect(decideRebakeAction({ storedVersion: 'stale', currentVersion: CURRENT, hasBackup: false })).toBe('unrecoverable')
  })
})

/**
 * `rebakeChunk` 的存储编排是本任务唯一会**不可逆地改写字节**的地方，也是三种情形里
 * 唯一有数据丢失后果的一段。没有注入点就一行覆盖不到：调换「先备份后覆盖」的顺序、
 * 把 unrecoverable 错记成 skip、拿当前带水印的字节去覆盖备份——全都能在纯函数单测里
 * 全绿通过。Task 4 的评审对 `bakeAfterUpload` 提的正是同一条，这里照它的做法用假写入器。
 */
type StorageEvent =
  | { op: 'get'; key: string }
  | { op: 'put'; key: string; body: string }
  | { op: 'update'; id: number; body: string }

function harness({ docs, storage = {} }: { docs: RebakeCandidate[]; storage?: Record<string, string> }) {
  const store = new Map<string, Buffer>(
    Object.entries(storage).map(([key, value]) => [key, Buffer.from(value)]),
  )
  const events: StorageEvent[] = []
  const errors: string[] = []

  const writer: MediaWriter = {
    async put({ prefix, filename, body }) {
      const key = `${prefix}/${filename}`
      events.push({ op: 'put', key, body: body.toString() })
      store.set(key, body)
    },
    async get({ prefix, filename }) {
      const key = `${prefix}/${filename}`
      events.push({ op: 'get', key })
      return store.get(key) ?? null
    },
  }

  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  const payload = {
    findByID: async ({ id }: { id: number }) => {
      const doc = byId.get(id)
      if (!doc) throw new Error(`no such media ${id}`)
      return doc
    },
    update: async ({ id, file }: { id: number; file: { data: Buffer } }) => {
      events.push({ op: 'update', id, body: file.data.toString() })
      return byId.get(id)
    },
    logger: {
      error: (...args: unknown[]) => {
        errors.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' '))
      },
    },
  } as unknown as Payload

  const writes = (): StorageEvent[] => events.filter((event) => event.op !== 'get')

  return { store, events, writes, errors, payload, createWriter: () => writer }
}

function photo(over: Partial<RebakeCandidate> = {}): RebakeCandidate {
  return { id: 1, usage: 'listing-photo', mimeType: 'image/jpeg', filename: 'a.jpg', watermark: null, ...over }
}

describe('rebakeChunk 的存储编排', () => {
  it('从没烘过 → 先把当前字节备份进 media-source/，再拿同一份字节重跑上传管线', async () => {
    const h = harness({ docs: [photo()], storage: { [`${MEDIA_COS_PREFIX}/a.jpg`]: 'clean' } })

    const result = await rebakeChunk({
      payload: h.payload,
      ids: [1],
      currentVersion: CURRENT,
      createWriter: h.createWriter,
    })

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0, unrecoverable: 0 })
    // 顺序铁律：备份必须先于覆盖写。反过来的话，烘焙一旦失败干净原件就永久没了。
    expect(h.writes()).toEqual([
      { op: 'put', key: `${MEDIA_SOURCE_PREFIX}/a.jpg`, body: 'clean' },
      { op: 'update', id: 1, body: 'clean' },
    ])
  })

  /**
   * 「没有 version」**不等于**「当前文件一定干净」。烘焙不是原子的：
   * `bakeAfterUpload` 先备份、再覆盖写母版与派生，最后才写 version。容器在覆盖写之后、
   * 写 version 之前被换掉（CloudRun 部署、或 `retries` 重投），事务回滚让这一行退回
   * version=null，而存储里已经躺着一张带水印的母版。此时若还按「当前文件就是干净原件」
   * 覆盖备份，那次中断前刚写下的干净原件就被带水印的字节永久盖掉，并且叠上第二层水印。
   *
   * 所以备份存在就以备份为准：它由「唯一知道字节是新的」那条路径（bakeAfterUpload，
   * 新字节落地时无论开关开关都会写）维护，永远是这张图最新的干净原件。
   */
  it('从没烘过但已有备份 → 拿备份当烘焙源，绝不用当前字节覆盖它（中断重跑会把干净原件永久盖掉）', async () => {
    const h = harness({
      docs: [photo()],
      storage: {
        // 上一次烘焙覆盖写了母版却没来得及写 version（容器被换掉 / 事务回滚）
        [`${MEDIA_COS_PREFIX}/a.jpg`]: 'watermarked-by-interrupted-bake',
        [`${MEDIA_SOURCE_PREFIX}/a.jpg`]: 'clean',
      },
    })

    await rebakeChunk({ payload: h.payload, ids: [1], currentVersion: CURRENT, createWriter: h.createWriter })

    expect(h.store.get(`${MEDIA_SOURCE_PREFIX}/a.jpg`)?.toString()).toBe('clean')
    // 一次 put 都不该有：备份已经在了，写它只会把干净原件换成带水印的字节。
    expect(h.writes()).toEqual([{ op: 'update', id: 1, body: 'clean' }])
  })

  it('从没烘过且没有备份 → 才拿当前字节写备份', async () => {
    const h = harness({
      docs: [photo()],
      storage: { [`${MEDIA_COS_PREFIX}/a.jpg`]: 'clean' },
    })

    await rebakeChunk({ payload: h.payload, ids: [1], currentVersion: CURRENT, createWriter: h.createWriter })

    expect(h.store.get(`${MEDIA_SOURCE_PREFIX}/a.jpg`)?.toString()).toBe('clean')
    expect(h.writes()).toEqual([
      { op: 'put', key: `${MEDIA_SOURCE_PREFIX}/a.jpg`, body: 'clean' },
      { op: 'update', id: 1, body: 'clean' },
    ])
  })

  it('旧哈希且有备份 → 从备份重烘，且不碰备份本身（当前字节带旧水印，写回去就把它固化成原件了）', async () => {
    const h = harness({
      docs: [photo({ watermark: { version: 'stale' } })],
      storage: {
        [`${MEDIA_COS_PREFIX}/a.jpg`]: 'watermarked',
        [`${MEDIA_SOURCE_PREFIX}/a.jpg`]: 'clean',
      },
    })

    const result = await rebakeChunk({
      payload: h.payload,
      ids: [1],
      currentVersion: CURRENT,
      createWriter: h.createWriter,
    })

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0, unrecoverable: 0 })
    expect(h.writes()).toEqual([{ op: 'update', id: 1, body: 'clean' }])
  })

  it('旧哈希且无备份 → unrecoverable：不备份、不重烘，计入 failed 并单独点名', async () => {
    const h = harness({
      docs: [photo({ watermark: { version: 'stale' } })],
      storage: { [`${MEDIA_COS_PREFIX}/a.jpg`]: 'watermarked' },
    })

    const result = await rebakeChunk({
      payload: h.payload,
      ids: [1],
      currentVersion: CURRENT,
      createWriter: h.createWriter,
    })

    expect(result).toEqual({ processed: 0, skipped: 0, failed: 1, unrecoverable: 1 })
    expect(h.writes()).toEqual([])
    expect(h.errors.join('\n')).toContain('a.jpg')
    expect(h.errors.join('\n')).toContain('不可恢复')
  })

  it('已是当前版本 → skip：不写库、不写存储（预筛选之后被别的路径烘到当前版本的竞态）', async () => {
    const h = harness({
      docs: [photo({ watermark: { version: CURRENT } })],
      storage: { [`${MEDIA_COS_PREFIX}/a.jpg`]: 'done' },
    })

    const result = await rebakeChunk({
      payload: h.payload,
      ids: [1],
      currentVersion: CURRENT,
      createWriter: h.createWriter,
    })

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0, unrecoverable: 0 })
    expect(h.writes()).toEqual([])
  })

  it('单张失败不阻断后续', async () => {
    const h = harness({
      // a.jpg 的当前文件在存储里不存在 → 第一张抛错；b.jpg 正常。
      docs: [photo({ id: 1 }), photo({ id: 2, filename: 'b.jpg' })],
      storage: { [`${MEDIA_COS_PREFIX}/b.jpg`]: 'clean-b' },
    })

    const result = await rebakeChunk({
      payload: h.payload,
      ids: [1, 2],
      currentVersion: CURRENT,
      createWriter: h.createWriter,
    })

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 1, unrecoverable: 0 })
    expect(h.writes()).toContainEqual({ op: 'update', id: 2, body: 'clean-b' })
  })
})

/**
 * 游标语义：**判定过的都推进过，处理过的都不再回头。**
 *
 * 游标取「本轮实际做出判定的最后一行的 id」，不是「本页扫到的最后一行的 id」。
 * 后者会在「本页候选数 > 分块上限」时把第 CHUNK+1 个及其之后的候选连同游标一起跨过去，
 * 一趟链条走完全表却只处理了其中一部分，运营得反复点好几次。
 *
 * 反过来取「最后一个**成功**处理的 id」则会在 unrecoverable（永远写不上 version）
 * 这类图上原地打转。取「最后一个判定过的 id」两头都避开：判定与结果无关，
 * 所以失败/跳过的行同样被跨过，游标严格递增，链条必然终止。
 */
describe('rebakeWatermarkTask 的游标推进', () => {
  type QueuedJob = { task: string; queue: string; input: { startAfterId: number } }

  function taskHarness({
    docs,
    hasNextPage,
    enabled = true,
  }: {
    docs: RebakeCandidate[]
    hasNextPage: boolean
    enabled?: boolean
  }) {
    const findByIdCalls: number[] = []
    const queued: QueuedJob[] = []
    const warnings: string[] = []
    const byId = new Map(docs.map((doc) => [doc.id, doc]))

    const payload = {
      // 开关必须显式打开：缺省是关的（功能 opt-in），而关着时任务直接早退，
      // 游标算术一行都跑不到。currentVersion 是个确定的哈希，本组候选全是
      // watermark: null，与具体哈希无关。
      findGlobal: async () => ({ watermark: { enabled } }),
      find: async () => ({ docs, hasNextPage }),
      findByID: async ({ id }: { id: number }) => {
        findByIdCalls.push(id)
        return byId.get(id)
      },
      update: async () => {
        throw new Error('本组用例不该走到 update')
      },
      jobs: {
        queue: async (args: QueuedJob) => {
          queued.push(args)
        },
      },
      logger: {
        error: () => {},
        warn: (...args: unknown[]) => {
          warnings.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' '))
        },
      },
    } as unknown as Payload

    return { payload, findByIdCalls, queued, warnings }
  }

  /**
   * 刻意不给 filename。`selectRebakeTargets` 只看 usage / mimeType / watermark 就会选中它，
   * 而 `rebakeChunk` 拿到无 filename 的记录会在碰存储之前 `skipped++` 走掉——于是本组用例
   * 一次存储都不碰（既不读本地磁盘也不连 COS），锁的纯粹是游标算术。
   *
   * 附带好处：这些行「判定了但没成功重刷」，游标照样跨过它们，正是不会死循环的那条性质。
   */
  const candidate = (id: number): RebakeCandidate => ({
    id,
    usage: 'listing-photo',
    mimeType: 'image/jpeg',
    watermark: null,
  })
  const nonCandidate = (id: number): RebakeCandidate => ({
    id,
    usage: 'brand',
    mimeType: 'image/jpeg',
    watermark: null,
  })

  async function run(payload: Payload, startAfterId?: number) {
    const { handler } = rebakeWatermarkTask
    if (typeof handler !== 'function') throw new Error('handler 必须是函数')
    const result = (await handler({ input: { startAfterId }, req: { payload } } as never)) as {
      output: { lastScannedId: number; hasNextPage: boolean; skipped: number; processed: number }
    }
    return result.output
  }

  it('候选数超过分块上限 → 游标停在第 CHUNK 个候选上，而不是页尾；第 CHUNK+1 个候选本轮不碰', async () => {
    // 一页 30 条全是候选，分块上限 20。页尾 id 是 129。
    const docs = Array.from({ length: 30 }, (_, index) => candidate(100 + index))
    const harness = taskHarness({ docs, hasNextPage: false })

    const output = await run(harness.payload)

    // 第 20 个候选是 119；取页尾 129 就会把 120–129 这 10 个候选连同游标一起跨过去
    expect(output.lastScannedId).toBe(119)
    expect(harness.findByIdCalls).toHaveLength(MEDIA_WATERMARK_CHUNK)
    expect(harness.findByIdCalls.at(-1)).toBe(119)
    expect(harness.findByIdCalls).not.toContain(120)
  })

  it('本页被截断时即使 hasNextPage=false 也必须续投——否则整张表最后一页的余量永久没人处理', async () => {
    const docs = Array.from({ length: 30 }, (_, index) => candidate(100 + index))
    const harness = taskHarness({ docs, hasNextPage: false })

    const output = await run(harness.payload)

    expect(output.hasNextPage).toBe(true)
    expect(harness.queued).toEqual([
      { task: MEDIA_WATERMARK_TASK, queue: MEDIA_WATERMARK_QUEUE, input: { startAfterId: 119 } },
    ])
  })

  it('候选数没超上限 → 游标推进到页尾，页尾那些非候选行下一轮不用再看', async () => {
    // 5 个候选夹在 10 行里，页尾 209 是非候选：候选没被截断，整页都判定过了。
    const docs = [
      candidate(200),
      nonCandidate(201),
      candidate(202),
      nonCandidate(203),
      candidate(204),
      candidate(205),
      nonCandidate(206),
      candidate(207),
      nonCandidate(208),
      nonCandidate(209),
    ]
    const harness = taskHarness({ docs, hasNextPage: true })

    const output = await run(harness.payload)

    expect(output.lastScannedId).toBe(209)
    expect(harness.findByIdCalls).toEqual([200, 202, 204, 205, 207])
    expect(harness.queued).toEqual([
      { task: MEDIA_WATERMARK_TASK, queue: MEDIA_WATERMARK_QUEUE, input: { startAfterId: 209 } },
    ])
  })

  /**
   * 回刷脚本在开关关着时拒跑（`--execute` 会直接退出并写明理由）；本任务这里加的
   * 早退就是同一理由在任务侧的对应守卫——开关关着时点「重刷全部房源图」，任务会走完整张
   * media 表，对每张实景图做一次备份 put、一次 get、外加整条上传管线（母版 + 三档派生）
   * ——**看不到任何变化，而且永不收敛**：开关关着 `bakeAfterUpload` 不烘、`clearIfStale()`
   * 让 version 保持为空，下一次点击又把这一切重做一遍。
   *
   * 本用例只钉任务自身的早退（不查行、不续投）。「前端谎报已加入队列」是路由/按钮层面的
   * 问题，由 `tests/watermark-admin-route-guards.test.ts`「水印开关状态」那组用例钉住——
   * 路由现在会提前查一次同一份配置，开关关着就不排队、返回 `queued:false`。
   */
  it('开关关闭 → 立刻早退：不查任何一行、不续投，与回刷脚本拒跑同一个态度', async () => {
    const harness = taskHarness({
      docs: Array.from({ length: 30 }, (_, index) => candidate(100 + index)),
      hasNextPage: true,
      enabled: false,
    })

    const output = await run(harness.payload)

    expect(harness.findByIdCalls).toEqual([])
    expect(harness.queued).toEqual([])
    expect(output.hasNextPage).toBe(false)
    expect(output.processed).toBe(0)
    // 静默早退等于骗人：前端弹的是「已加入队列」，日志里必须留下真实原因。
    expect(harness.warnings.join('\n')).toContain('水印开关')
  })

  it('扫到空页 → 游标不动、不续投，链条终止', async () => {
    const harness = taskHarness({ docs: [], hasNextPage: false })

    const output = await run(harness.payload, 999)

    expect(output.lastScannedId).toBe(999)
    expect(output.hasNextPage).toBe(false)
    expect(harness.queued).toEqual([])
  })

  it('游标严格递增：连着两轮，第二轮从第一轮的游标之后接着走', async () => {
    const first = taskHarness({
      docs: Array.from({ length: 30 }, (_, index) => candidate(100 + index)),
      hasNextPage: false,
    })
    const firstOutput = await run(first.payload)

    // 第二轮拿到的是「游标之后」的那一页（120–129），由 find 的 where 保证，这里直接喂。
    const second = taskHarness({
      docs: Array.from({ length: 10 }, (_, index) => candidate(120 + index)),
      hasNextPage: false,
    })
    const secondOutput = await run(second.payload, firstOutput.lastScannedId)

    expect(secondOutput.lastScannedId).toBeGreaterThan(firstOutput.lastScannedId)
    expect(secondOutput.lastScannedId).toBe(129)
    // 这一页候选没超上限，全部判定完 → 链条终止
    expect(secondOutput.hasNextPage).toBe(false)
    expect(second.queued).toEqual([])
  })
})

describe('队列常量', () => {
  it('分块大小与批量导入同口径', () => {
    expect(MEDIA_WATERMARK_CHUNK).toBe(20)
  })

  it('队列名稳定——改名会让在途 job 找不到 handler', () => {
    expect(MEDIA_WATERMARK_QUEUE).toBe('media-watermark')
  })
})
