import { describe, expect, it, vi } from 'vitest'

import { protectBrokerStop } from '@/domain/auth/broker-stop-guard'

/**
 * M2.5 经纪人停用守卫单测（R6 §140-144）
 * 仅 active→disabled 触发；有未完成线索则拦截，否则放行。
 */

function reqWithCount(total = 0) {
  const count = vi.fn(async (_args: unknown) => ({ totalDocs: total }))
  return { req: { payload: { count } } as never, count }
}

const run = (args: Record<string, unknown>, req: unknown) =>
  protectBrokerStop({ ...args, req } as never) as Promise<Record<string, unknown>>

describe('broker-stop-guard/转换触发条件', () => {
  it('create 不触发', async () => {
    const { req, count } = reqWithCount()
    const data = { employmentStatus: 'disabled' }
    const out = await run({ operation: 'create', originalDoc: undefined, data }, req)
    expect(out).toBe(data)
    expect(count).not.toHaveBeenCalled()
  })

  it('状态未变为 disabled 不触发', async () => {
    const { req, count } = reqWithCount()
    await run(
      {
        operation: 'update',
        originalDoc: { id: 1, employmentStatus: 'active' },
        data: { employmentStatus: 'active' },
      },
      req,
    )
    expect(count).not.toHaveBeenCalled()
  })

  it('原本已停用不重复触发', async () => {
    const { req, count } = reqWithCount()
    await run(
      {
        operation: 'update',
        originalDoc: { id: 1, employmentStatus: 'disabled' },
        data: { employmentStatus: 'disabled' },
      },
      req,
    )
    expect(count).not.toHaveBeenCalled()
  })
})

describe('broker-stop-guard/未完成线索拦截', () => {
  it('active→disabled 有未完成线索 → BROKER_HAS_OPEN_LEADS', async () => {
    const { req } = reqWithCount(2)
    await expect(
      run(
        {
          operation: 'update',
          originalDoc: { id: 5, employmentStatus: 'active' },
          data: { employmentStatus: 'disabled' },
        },
        req,
      ),
    ).rejects.toMatchObject({ code: 'BROKER_HAS_OPEN_LEADS', domain: 'auth' })
  })

  it('拦截错误 details 带 openLeads 数量', async () => {
    const { req } = reqWithCount(3)
    try {
      await run(
        {
          operation: 'update',
          originalDoc: { id: 5, employmentStatus: 'active' },
          data: { employmentStatus: 'disabled' },
        },
        req,
      )
      expect.unreachable('应抛 BROKER_HAS_OPEN_LEADS')
    } catch (err) {
      expect((err as { details: { openLeads: number } }).details.openLeads).toBe(3)
    }
  })

  it('active→disabled 无未完成线索 → 放行', async () => {
    const { req } = reqWithCount(0)
    const out = await run(
      {
        operation: 'update',
        originalDoc: { id: 5, employmentStatus: 'active' },
        data: { employmentStatus: 'disabled' },
      },
      req,
    )
    expect(out).toEqual({ employmentStatus: 'disabled' })
  })

  it('停用检查用 overrideAccess:true（完整性不变量）', async () => {
    const { req, count } = reqWithCount(0)
    await run(
      {
        operation: 'update',
        originalDoc: { id: 5, employmentStatus: 'active' },
        data: { employmentStatus: 'disabled' },
      },
      req,
    )
    expect((count.mock.calls[0][0] as { overrideAccess: boolean }).overrideAccess).toBe(true)
  })
})
