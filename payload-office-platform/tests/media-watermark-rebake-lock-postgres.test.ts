import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import {
  MEDIA_WATERMARK_QUEUE,
  MEDIA_WATERMARK_TASK,
  runWithSegmentLock,
} from '@/domain/media/watermark-rebake'

/**
 * OPT-112 评审 Important #1：「同一时刻只跑一段」必须在真库上成立。
 *
 * Payload 3.86 的 drizzle `updateJobs` 认领 job 是「先查待跑的、再按 id 逐条更新」，
 * 不带 `processing = false` 的复核——两个实例在同一个整分钟 cron 点上可能认领**同一个**
 * job。只看「有没有 id 更小的段在跑」的计数判定挡不住它，也挡不住「先查后跑」的竞态。
 * 改用事务级 advisory lock 之后，这里用真连接钉住三种结果。
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

  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  afterAll(async () => {
    if (jobIds.length > 0) {
      await payload.db.pool.query('DELETE FROM payload_jobs WHERE id = ANY($1::int[])', [jobIds])
    }
  })

  it('同一个 job 第二份副本 → duplicate；别的段 → busy；持锁者跑完后别的段能拿到锁', async () => {
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

    // 同一个 job 被另一个实例重复认领：不跑、也不该续投
    await expect(runWithSegmentLock(payload, jobA, async () => 'copy')).resolves.toEqual({ status: 'duplicate' })
    // 另一条链的段：让路（调用方推迟重投自己）
    await expect(runWithSegmentLock(payload, jobB, async () => 'other')).resolves.toEqual({ status: 'busy' })

    hold.resolve()
    await expect(first).resolves.toEqual({ status: 'ran', value: 'first' })
    await expect(runWithSegmentLock(payload, jobB, async () => 'after')).resolves.toEqual({
      status: 'ran',
      value: 'after',
    })
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

  it('段内抛错 → 原样抛出，锁照样释放', async () => {
    const jobA = await queueJob()
    const jobB = await queueJob()

    await expect(
      runWithSegmentLock(payload, jobA, async () => {
        throw new Error('bake failed')
      }),
    ).rejects.toThrow('bake failed')
    await expect(runWithSegmentLock(payload, jobB, async () => 'next')).resolves.toEqual({
      status: 'ran',
      value: 'next',
    })
  })

  /**
   * 进程被杀时连接断开，事务级锁随会话结束释放。主机整个消失、TCP 不回 RST 的情形靠
   * 持锁事务上的 `idle_in_transaction_session_timeout`（= 租约）兜底：最迟一个租约后由 PG
   * 结束那个会话、释放锁，与 `recoverStaleWatermarkRebakeJobs` 放回队列的时点一致。
   *
   * 这里把租约注入成 1 秒，段内睡 2.5 秒：睡到一半时别的段应当已经能拿到锁；
   * 持锁会话被 PG 结束后，本段的收尾（COMMIT / 归还连接）不许把错误抛给调用方。
   */
  it('持锁事务带着「事务内空闲上限 = 租约」：会话死了锁最迟一个租约后释放', async () => {
    const jobA = await queueJob()
    const jobB = await queueJob()

    const first = runWithSegmentLock(
      payload,
      jobA,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        return 'slow'
      },
      { leaseMs: 1000 },
    )
    await new Promise((resolve) => setTimeout(resolve, 1800))
    await expect(runWithSegmentLock(payload, jobB, async () => 'took-over')).resolves.toEqual({
      status: 'ran',
      value: 'took-over',
    })
    await expect(first).resolves.toEqual({ status: 'ran', value: 'slow' })
  })
})
