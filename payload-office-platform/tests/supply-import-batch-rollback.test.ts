import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

import { rollbackImportBatch } from '@/domain/supply-import/batch-rollback'

/**
 * 按批次回滚——try/catch 容错专项单测（评审第 2 轮补充）。
 *
 * 背景：真库测试（supply-import-rollback-postgres.test.ts）里"软删 + 不存在 id"混合
 * 的那条用例，三条 id 走的全是"正常返回、不抛异常"的分支——`disableErrors:true` /
 * `trash:true` 组合本身就是设计成不抛错的（找不到返回 null，软删返回带 deletedAt
 * 的文档）。评审做了杀伤力验证：把 rollbackImportBatch 循环体里的 try/catch 整个
 * 删掉，那条真库用例依然通过。也就是说它验证的是"trash + disableErrors 组合的
 * 分支路由对不对"，完全没有验证 try/catch 本身——try/catch 真正防的是 update
 * 阶段的意外异常（hook 拒绝、并发写冲突、字段校验失败等），这条路径此前从未被
 * 执行到，写错了（比如 catch 里漏 continue、忘了给 failed 计数）也不会有测试报警。
 *
 * 这里用一个可控抛错的假 payload（不连真库，纯单测）补齐这条路径：三个 id 依次是
 * 正常 → 抛错 → 正常，抛错那条特意不放在最后一位——如果 catch 没有正确 continue
 * 到下一次循环、或者外层真的把异常冒泡出去，第三条就不会被处理，这条用例就会失败，
 * 这才是"循环没有在半途中断"这个论断的真正证据。
 *
 * 杀伤力验证记录见 task-9-report.md 第 3 轮修复报告：临时删掉 try/catch 后
 * 重跑过这条用例，确认真的会失败，然后改回来。
 */

interface FakeListing {
  id: number
  publicationStatus: string
  deletedAt: string | null
}

function makeFakePayload(params: {
  batch: { type: 'buildings' | 'listings'; affectedIds: Array<number | string> }
  listings: Map<number, FakeListing>
  throwOnUpdateId: number
}): { payload: Payload; updatedIds: number[] } {
  const { batch, listings, throwOnUpdateId } = params
  const updatedIds: number[] = []

  const findByID = vi.fn(async (opts: { collection: string; id: number | string }) => {
    if (opts.collection === 'supply-import-batches') {
      return batch
    }
    if (opts.collection === 'listings') {
      return listings.get(Number(opts.id)) ?? null
    }
    throw new Error(`unexpected findByID collection ${opts.collection}`)
  })

  const update = vi.fn(
    async (opts: { collection: string; id: number | string; data: Record<string, unknown> }) => {
      if (opts.collection !== 'listings') {
        throw new Error(`unexpected update collection ${opts.collection}`)
      }
      const id = Number(opts.id)
      if (id === throwOnUpdateId) {
        // 模拟 update 阶段的意外异常——hook 拒绝 / 并发写冲突 / 字段校验失败等，
        // 这才是 try/catch 真正要防的路径，不是 findByID 那两个设计上不抛错的分支。
        throw new Error(`模拟的 update 异常（比如 hook 拒绝）：id=${id}`)
      }
      updatedIds.push(id)
      const existing = listings.get(id)
      if (existing) {
        listings.set(id, { ...existing, publicationStatus: 'unpublished' })
      }
      return { id, ...opts.data }
    },
  )

  const fakePayload = { findByID, update } as unknown as Payload
  return { payload: fakePayload, updatedIds }
}

describe('rollbackImportBatch：单条 id 的 update 异常不中断循环（try/catch 专项）', () => {
  it('正常 → 抛错 → 正常：异常不冒泡、抛错那条计入 failed，第三条仍被正常下架', async () => {
    const listings = new Map<number, FakeListing>([
      [1, { id: 1, publicationStatus: 'published', deletedAt: null }],
      [2, { id: 2, publicationStatus: 'published', deletedAt: null }],
      [3, { id: 3, publicationStatus: 'published', deletedAt: null }],
    ])
    const { payload, updatedIds } = makeFakePayload({
      batch: { type: 'listings', affectedIds: [1, 2, 3] },
      listings,
      throwOnUpdateId: 2,
    })

    // 核心断言 1：异常没有冒泡出 rollbackImportBatch——不用 expect(...).rejects，
    // 直接 await 拿返回值，如果真的冒泡了这一行本身就会让用例失败。
    const result = await rollbackImportBatch({ payload, batchId: 1 })

    // 核心断言 2：抛错那条计入 failed，不是被悄悄吞掉、也不是错误地算进 unpublished。
    expect(result).toEqual({ unpublished: 2, skipped: 0, failed: 1 })

    // 核心断言 3（本用例的核心）：抛错条目不在最后一位时，它后面的条目仍然被
    // 正常处理——第三条确实发生了 update 且状态真的变成了 unpublished。
    expect(updatedIds).toEqual([1, 3])
    expect(listings.get(3)?.publicationStatus).toBe('unpublished')
    expect(listings.get(1)?.publicationStatus).toBe('unpublished')
    // 抛错那条的 update 本身失败，数据不应该被污染成 unpublished。
    expect(listings.get(2)?.publicationStatus).toBe('published')
  })
})
