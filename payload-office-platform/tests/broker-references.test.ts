import { describe, expect, it, vi } from 'vitest'

import { LEAD_TERMINAL_STATUSES, countBrokerOpenLeads } from '@/domain/auth/broker-references'

/**
 * M2.5 经纪人未完成线索计数单测（R6）
 * mock payload.count，锁定 where 条件（owner=brokerId AND status not_in 终态）
 * 与 overrideAccess 透传行为。
 */

describe('broker-references/countBrokerOpenLeads', () => {
  it('终态集合为 won/lost', () => {
    expect(LEAD_TERMINAL_STATUSES).toEqual(['won', 'lost'])
  })

  it('where 条件：owner 命中 + status 非终态', async () => {
    const count = vi.fn(async (_args: unknown) => ({ totalDocs: 3 }))
    const report = await countBrokerOpenLeads({ count } as never, 7)
    expect(count).toHaveBeenCalledOnce()
    const arg = count.mock.calls[0][0] as {
      collection: string
      where: { and: unknown[] }
      overrideAccess: boolean
    }
    expect(arg.collection).toBe('leads')
    expect(arg.where.and).toEqual([
      { owner: { equals: 7 } },
      { status: { not_in: ['won', 'lost'] } },
    ])
    expect(report).toEqual({ brokerId: 7, openLeads: 3, hasOpenLeads: true })
  })

  it('无未完成线索 → hasOpenLeads false', async () => {
    const count = vi.fn(async (_args: unknown) => ({ totalDocs: 0 }))
    const report = await countBrokerOpenLeads({ count } as never, 'b1')
    expect(report.openLeads).toBe(0)
    expect(report.hasOpenLeads).toBe(false)
  })

  it('overrideAccess 默认 false', async () => {
    const count = vi.fn(async (_args: unknown) => ({ totalDocs: 0 }))
    await countBrokerOpenLeads({ count } as never, 1)
    expect((count.mock.calls[0][0] as { overrideAccess: boolean }).overrideAccess).toBe(false)
  })

  it('overrideAccess 透传 true 与 req', async () => {
    const count = vi.fn(async (_args: unknown) => ({ totalDocs: 0 }))
    const req = { user: { id: 1 } } as never
    await countBrokerOpenLeads({ count } as never, 1, req, { overrideAccess: true })
    const arg = count.mock.calls[0][0] as { overrideAccess: boolean; req: unknown }
    expect(arg.overrideAccess).toBe(true)
    expect(arg.req).toBe(req)
  })
})
