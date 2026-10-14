import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import {
  MEDIA_WATERMARK_LOCK_NAMESPACE,
  MEDIA_WATERMARK_QUEUE,
  MEDIA_WATERMARK_TASK,
  recoverStaleWatermarkRebakeJobs,
  runWithSegmentLock,
} from '@/domain/media/watermark-rebake'

/**
 * OPT-112：「同一时刻只跑一段」与「重复认领不弄断链条」必须在真库上成立。
 *
 * Payload 3.86 的 drizzle `updateJobs` 认领 job 是「先查待跑的、再按 id 逐条更新」，
 * 不复核 `processing = false`——两个实例在同一个整分钟 cron 点上可能认领**同一个** job。
 *
 *   - 独立评审：计数式让路挡不住它 → 改为事务级 advisory lock；
 *   - Codex P1：副本若立刻正常返回，Payload 会把**共享的** job 标完成并删除，持锁者随后被杀
 *     就没有行可回收 → 副本改为待命，持锁者跑完才退出、死了就接手；
 *   - Codex P1：段超过租约时「事务内空闲上限」会结束持锁会话、锁在活还没干完时就丢了
 *     → 干活期间心跳，锁在持锁进程活着时一直有效。
 */

const databaseAvailable = typeof process.env.DATABASE_URL === 'string' &&
  process.env.DATABASE_URL.startsWith('postgres')

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 测试用的快节奏：待命每 100ms 试一次锁。 */
const FAST = { pollMs: 100 }

describe.skipIf(!databaseAvailable)('runWithSegmentLock（真库）', () => {
  let payload: Payload
  const jobIds: number[] = []

  async function queueJob(): Promise<number> {
    const job = await payload.jobs.queue({
      task: MEDIA_WATERMARK_TASK,
      queue: MEDIA_WATERMARK_QUEUE,
      input: { startAfterId: 0 },
      // 远期 waitUntil：本测试只要这一行存在，不希望被任何 cron 真的捡去跑。
      waitUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    jobIds.push(Number(job.id))
    return Number(job.id)
  }

  async function jobRow(id: number): Promise<{ processing: boolean; completed: boolean } | null> {
    const { rows } = await payload.db.pool.query<{ processing: boolean; completed: boolean }>(
      'SELECT processing, completed_at IS NOT NULL AS completed FROM payload_jobs WHERE id = $1',
      [id],
    )
    return rows[0] ?? null
  }

  /** 结束持有 (命名空间, key) advisory lock 的那个会话，模拟持锁进程被杀。 */
  async function killLockHolder(key: number): Promise<void> {
    await payload.db.pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND objsubid = 2
          AND classid = $1::oid AND objid = $2::oid`,
      [MEDIA_WATERMARK_LOCK_NAMESPACE, key],
    )
  }

  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  afterAll(async () => {
    if (jobIds.length > 0) {
      await payload.db.pool.query('DELETE FROM payload_jobs WHERE id = ANY($1::int[])', [jobIds])
    }
  })

  it('别的段在跑 → busy；持锁者跑完后别的段能拿到锁；跑完的段在锁内被标完成', async () => {
    const jobA = await queueJob()
    const jobB = await queueJob()
    const hold = deferred()
    const entered = deferred()

    const first = runWithSegmentLock(payload, jobA, async () => {
      entered.resolve()
      await hold.promise
      return 'first'
    })
    await entered.promise

    await expect(runWithSegmentLock(payload, jobB, async () => 'other', FAST)).resolves.toEqual({ status: 'busy' })

    hold.resolve()
    await expect(first).resolves.toEqual({ status: 'ran', value: 'first' })
    // 完成标记与释放锁在同一个事务里：别人拿到锁时一定看得见
    expect(await jobRow(jobA)).toMatchObject({ completed: true })
    await expect(runWithSegmentLock(payload, jobB, async () => 'after')).resolves.toEqual({
      status: 'ran',
      value: 'after',
    })
  })

  /**
   * Codex P1 #1：副本立刻正常返回，Payload 会把共享的 job 标完成并删除——持锁者随后被杀，
   * 回收找不到行，链条永久断掉。副本必须等持锁者有个结果。
   */
  it('同一个 job 的副本：持锁者在跑时一直待命，持锁者跑完后才以 duplicate 退出', async () => {
    const job = await queueJob()
    const hold = deferred()
    const entered = deferred()

    const owner = runWithSegmentLock(payload, job, async () => {
      entered.resolve()
      await hold.promise
      return 'owner'
    })
    await entered.promise

    let copySettled = false
    const copy = runWithSegmentLock(payload, job, async () => 'copy', FAST).finally(() => {
      copySettled = true
    })
    await sleep(600)
    expect(copySettled).toBe(false)

    hold.resolve()
    await expect(owner).resolves.toEqual({ status: 'ran', value: 'owner' })
    await expect(copy).resolves.toEqual({ status: 'duplicate' })
  })

  it('同一个 job 的副本：持锁者被杀（会话断开）→ 副本接手把这一段跑完', async () => {
    const job = await queueJob()
    const entered = deferred()
    const hang = deferred()

    // 持锁者在干活中途「被杀」：这里结束它的会话；它的活在测试末尾才放行，只为让心跳计时器收掉
    const owner = runWithSegmentLock(payload, job, async () => {
      entered.resolve()
      await hang.promise
    })
    await entered.promise

    const copy = runWithSegmentLock(payload, job, async () => 'took-over', FAST)
    await sleep(300)
    await killLockHolder(job)

    await expect(copy).resolves.toEqual({ status: 'ran', value: 'took-over' })
    expect(await jobRow(job)).toMatchObject({ completed: true })
    hang.resolve()
    await owner.catch(() => {})
  })

  /**
   * 两份副本未必同时开跑：第二份若在第一份跑完、Payload 把 job 标完成（随即删除）之后
   * 才进来，job 锁已经释放，只能靠「这一行还在、且没完成」识别出它是迟到的副本。
   */
  it('job 已完成（行已删除）→ duplicate，不再跑一遍', async () => {
    const job = await queueJob()
    await payload.db.pool.query('DELETE FROM payload_jobs WHERE id = $1', [job])

    let ran = false
    await expect(
      runWithSegmentLock(payload, job, async () => {
        ran = true
      }),
    ).resolves.toEqual({ status: 'duplicate' })
    expect(ran).toBe(false)
  })

  it('段内抛错 → 原样抛出，锁照样释放，job 不标完成（留给重试或接手）', async () => {
    const jobA = await queueJob()
    const jobB = await queueJob()

    await expect(
      runWithSegmentLock(payload, jobA, async () => {
        throw new Error('bake failed')
      }),
    ).rejects.toThrow('bake failed')
    expect(await jobRow(jobA)).toMatchObject({ completed: false })
    await expect(runWithSegmentLock(payload, jobB, async () => 'next')).resolves.toEqual({
      status: 'ran',
      value: 'next',
    })
  })

  /**
   * Codex P1 #2：段超过租约时，若持锁会话按「事务内空闲上限」被结束，锁在活还没干完时就丢了，
   * 别的段会进来与它并发。干活期间心跳，锁在持锁进程活着时一直有效。
   *
   * 租约注入成 1 秒、心跳 300ms，段内睡 2.5 秒：睡到 1.8 秒时别的段仍应拿不到锁。
   */
  it('段跑得比租约长：心跳让锁一直有效，别的段进不来', async () => {
    const jobA = await queueJob()
    const jobB = await queueJob()

    const slow = runWithSegmentLock(
      payload,
      jobA,
      async () => {
        await sleep(2500)
        return 'slow'
      },
      { leaseMs: 1000, heartbeatMs: 300 },
    )
    await sleep(1800)
    await expect(runWithSegmentLock(payload, jobB, async () => 'intruder', FAST)).resolves.toEqual({
      status: 'busy',
    })
    await expect(slow).resolves.toEqual({ status: 'ran', value: 'slow' })
  })

  /**
   * 进程活着但心跳停了（主机整个消失、TCP 不回 RST 时就是这样）：PG 按「事务内空闲上限 = 租约」
   * 结束持锁会话、放掉锁。这里把心跳间隔设得比租约还长来模拟「心跳停了」。
   */
  it('心跳停了：锁最迟一个租约后由 PG 放掉', async () => {
    const jobA = await queueJob()
    const jobB = await queueJob()

    const silent = runWithSegmentLock(
      payload,
      jobA,
      async () => {
        await sleep(2500)
        return 'silent'
      },
      { leaseMs: 1000, heartbeatMs: 60_000 },
    )
    await sleep(1800)
    await expect(runWithSegmentLock(payload, jobB, async () => 'took-over', FAST)).resolves.toEqual({
      status: 'ran',
      value: 'took-over',
    })
    // 持锁会话已被 PG 结束：收尾失败不许抛给调用方
    await expect(silent).resolves.toEqual({ status: 'ran', value: 'silent' })
  })

  /**
   * 陈旧回收只按 `updated_at` 判租约，不知道持锁者还活着。活着的长段被放回队列后，
   * 别的实例认领它只能在 job 锁外待命；待命到头以 duplicate 退出时 Payload 又会把行标完成删掉。
   * 所以 job 锁还被人持有的段不算陈旧。
   */
  it('陈旧回收跳过 job 锁仍被持有的段，锁放掉之后才回收', async () => {
    const job = await queueJob()
    await payload.db.pool.query(
      `UPDATE payload_jobs SET processing = true, updated_at = NOW() - interval '1 hour' WHERE id = $1`,
      [job],
    )
    const hold = deferred()
    const entered = deferred()
    const owner = runWithSegmentLock(payload, job, async () => {
      entered.resolve()
      await hold.promise
    })
    await entered.promise

    await recoverStaleWatermarkRebakeJobs(payload)
    expect(await jobRow(job)).toMatchObject({ processing: true })

    // 模拟持锁者被杀：会话断开、锁随之释放，此时它才是真正的陈旧段
    await killLockHolder(job)
    await sleep(200)
    await recoverStaleWatermarkRebakeJobs(payload)
    expect(await jobRow(job)).toMatchObject({ processing: false })
    hold.resolve()
    await owner.catch(() => {})
  })
})
