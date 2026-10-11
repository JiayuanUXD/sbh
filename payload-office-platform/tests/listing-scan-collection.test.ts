import { describe, expect, it } from 'vitest'
import { collectListingScanPages } from '@/domain/public-catalog/listing-scan'

describe('统一房源分页扫描', () => {
  it('首页与缓存扫描共用有界并发，按页序返回完整结果', async () => {
    let active = 0
    let maxActive = 0
    const metadata: (number | undefined)[] = []
    const rows = await collectListingScanPages(async (page, totalPages) => {
      metadata.push(totalPages)
      active++
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active--
      return { rows: [page], totalPages: 11, nextPage: page < 11 ? page + 1 : null }
    })
    expect(rows).toEqual(Array.from({ length: 11 }, (_, i) => i + 1))
    expect(maxActive).toBe(4)
    expect(metadata).toEqual([undefined, ...Array.from({ length: 10 }, () => 11)])
  })

  it('旧适配器没有总页数时仍完整推进，包括精筛空页', async () => {
    const rows = await collectListingScanPages(async (page) => ({
      rows: page === 1 ? [] : [page], nextPage: page < 3 ? page + 1 : null,
    }))
    expect(rows).toEqual([2, 3])
  })

  it('分页边界漂移时拒绝返回部分结果', async () => {
    await expect(collectListingScanPages(async (page) => ({
      rows: [page], totalPages: page === 3 ? 10 : 11,
      nextPage: page < 11 ? page + 1 : null,
    }))).rejects.toThrow('房源扫描分页未按顺序推进')
  })
})
