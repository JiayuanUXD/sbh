import { describe, expect, it, vi } from 'vitest'

import { countMerchantReferences } from '@/domain/supply/merchant-references'
import { protectMerchantStop } from '@/domain/supply/merchant-stop-guard'

/**
 * M2.4 商户停用保护 hook 单测（R2 §56）
 *
 * M3.3 起 REFERENCE_SPECS 登记了 building-merchant-relations,停用时会统计
 * 商户名下当前有效的楼盘供给关系;有则拦截,无则放行。
 * 本测试锁定「仅 active→disabled 触发」的转换逻辑,以及有/无关系两条分支。
 */

function reqWithCount(total = 0) {
  const count = vi.fn(async () => ({ totalDocs: total }))
  return { req: { payload: { count } } as never, count }
}

const run = (args: Record<string, unknown>, req: unknown) =>
  protectMerchantStop({ ...args, req } as never) as Promise<Record<string, unknown>>

describe('merchant-stop-guard/转换触发条件', () => {
  it('create 不触发（直接返回 data）', async () => {
    const { req, count } = reqWithCount()
    const data = { status: 'disabled' }
    const out = await run({ operation: 'create', originalDoc: undefined, data }, req)
    expect(out).toBe(data)
    expect(count).not.toHaveBeenCalled()
  })

  it('状态未变为 disabled 不触发', async () => {
    const { req, count } = reqWithCount()
    const out = await run(
      { operation: 'update', originalDoc: { id: 1, status: 'active' }, data: { status: 'active' } },
      req,
    )
    expect(count).not.toHaveBeenCalled()
    expect(out).toEqual({ status: 'active' })
  })

  it('原本已停用不重复触发', async () => {
    const { req, count } = reqWithCount()
    await run(
      { operation: 'update', originalDoc: { id: 1, status: 'disabled' }, data: { status: 'disabled' } },
      req,
    )
    expect(count).not.toHaveBeenCalled()
  })

  it('active→disabled 且无有效关系 → 放行（MVP 空 specs）', async () => {
    const { req } = reqWithCount()
    const out = await run(
      { operation: 'update', originalDoc: { id: 1, status: 'active' }, data: { status: 'disabled' } },
      req,
    )
    expect(out).toEqual({ status: 'disabled' })
  })
})

describe('merchant-references/countMerchantReferences', () => {
  it('无有效关系 → total 0、referenced false', async () => {
    const count = vi.fn(async () => ({ totalDocs: 0 }))
    const report = await countMerchantReferences(
      { count } as never,
      1,
      undefined,
      { overrideAccess: true },
    )
    expect(report.total).toBe(0)
    expect(report.referenced).toBe(false)
    expect(report.sources).toEqual([])
    // M3.3 起登记了楼盘供给关系 spec,会实际发起统计
    expect(count).toHaveBeenCalledTimes(1)
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'building-merchant-relations', overrideAccess: true }),
    )
  })

  it('有楼盘供给关系 → total>0、referenced true、sources 含标签', async () => {
    const count = vi.fn(async () => ({ totalDocs: 3 }))
    const report = await countMerchantReferences(
      { count } as never,
      1,
      undefined,
      { overrideAccess: true },
    )
    expect(report.total).toBe(3)
    expect(report.referenced).toBe(true)
    expect(report.sources).toEqual([
      { collection: 'building-merchant-relations', label: '楼盘供给关系', count: 3 },
    ])
  })
})
