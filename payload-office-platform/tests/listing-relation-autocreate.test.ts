import { describe, expect, it, vi } from 'vitest'

import { Listings } from '@/collections/Listings'
import {
  autoCreateListingRelation,
  toRelationId,
} from '@/domain/supply/listing-relation-autocreate'

/**
 * 新建房源自动建供给关系。
 *
 * 每条用例对应一个会让幽灵房源复现、或造成更大破坏的走法：
 *   1. update 也建关系 → 每次保存都插一条，撞上「同房源有效期不重叠」约束；
 *   2. 无商户时兜底选一个 → 造出运营没预期的供给关系；
 *   3. 失败时抛错 → 非上海城市（默认商户不服务）将无法新建房源；
 *   4. 失败时静默 → 扩城后「前台看不到」毫无线索。
 */

function makeReq() {
  const created: Array<Record<string, unknown>> = []
  const warns: unknown[] = []
  const req = {
    payload: {
      create: vi.fn(async (args: Record<string, unknown>) => {
        created.push(args)
        return { id: 999 }
      }),
      logger: { warn: vi.fn((...a: unknown[]) => warns.push(a)) },
    },
  }
  return { req, created, warns }
}

const run = async (
  req: unknown,
  doc: Record<string, unknown>,
  operation: 'create' | 'update' = 'create',
) =>
  await (autoCreateListingRelation as unknown as (a: unknown) => Promise<unknown>)({
    doc, operation, req, collection: {} as never, context: {} as never, previousDoc: {} as never,
  })

describe('toRelationId', () => {
  it('接受 number / string / populate 对象', () => {
    expect(toRelationId(7)).toBe(7)
    expect(toRelationId('7')).toBe('7')
    expect(toRelationId({ id: 7 })).toBe(7)
  })

  it('空值与非法形态返回 null', () => {
    expect(toRelationId(null)).toBeNull()
    expect(toRelationId(undefined)).toBeNull()
    expect(toRelationId({})).toBeNull()
  })
})

describe('autoCreateListingRelation', () => {
  it('create 且有商户 → 建一条以 now 起始、无终止的关系', async () => {
    const { req, created } = makeReq()
    await run(req, { id: 42, merchant: 1 })
    expect(created).toHaveLength(1)
    expect(created[0].collection).toBe('listing-merchant-relations')
    const data = created[0].data as Record<string, unknown>
    expect(data.listing).toBe(42)
    expect(data.merchant).toBe(1)
    expect(typeof data.effectiveFrom).toBe('string')
    expect(data.effectiveTo).toBeUndefined()
    expect(created[0].overrideAccess).toBe(true)
    expect(created[0].req).toBe(req)
  })

  it('商户是 populate 对象时也能取到 id', async () => {
    const { req, created } = makeReq()
    await run(req, { id: 42, merchant: { id: 31, name: '渠道' } })
    expect((created[0].data as Record<string, unknown>).merchant).toBe(31)
  })

  it('update 不建关系——换商户是显式的供给关系变更，不能靠改字段悄悄发生', async () => {
    const { req, created } = makeReq()
    await run(req, { id: 42, merchant: 1 }, 'update')
    expect(created).toHaveLength(0)
  })

  it('无商户时跳过，不兜底选一个', async () => {
    const { req, created } = makeReq()
    await run(req, { id: 42, merchant: null })
    expect(created).toHaveLength(0)
  })

  it('建关系失败不抛错——否则默认商户不服务的城市将无法新建房源', async () => {
    const req = {
      payload: {
        create: vi.fn(async () => { throw new Error('准入门禁：服务城市不覆盖') }),
        logger: { warn: vi.fn() },
      },
    }
    await expect(run(req, { id: 42, merchant: 1 })).resolves.toBeDefined()
  })

  it('失败时必须记 warn——静默会让扩城后的「前台看不到」毫无线索', async () => {
    const warn = vi.fn()
    const req = {
      payload: {
        create: vi.fn(async () => { throw new Error('boom') }),
        logger: { warn },
      },
    }
    await run(req, { id: 42, merchant: 1 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls[0])).toContain('42')
  })
})

describe('autoCreateListingRelation/接线', () => {
  it('挂在 Listings 的 afterChange 上', () => {
    expect(Listings.hooks?.afterChange ?? []).toContain(autoCreateListingRelation)
  })

  it('不在 beforeChange 上——create 时那里还没有 listing id', () => {
    expect(Listings.hooks?.beforeChange ?? []).not.toContain(autoCreateListingRelation)
  })
})
