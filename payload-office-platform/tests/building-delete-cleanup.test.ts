import { describe, expect, it, vi } from 'vitest'

import { guardBuildingDelete } from '@/domain/supply/building-delete-cleanup'
import { Buildings } from '@/collections/Buildings'

/**
 * 楼盘删除守护（OPT-050）。
 *
 * 守的不变量：
 *   1. **有房源就拦**，且文案含楼盘名与套数——这是本工作项的核心。
 *      不拦的后果不是「删掉了不该删的」，而是 PG 撞 `SET NULL + NOT NULL` 死结、
 *      运营只看到一个无法理解的 500。
 *   2. **拦下时不产生任何副作用**——尤其不能已经把关系行删了才拦。
 *   3. 无房源时清掉纯关系行，否则同样撞死结。
 *   4. 取楼盘名失败不得放行——文案可以退化，拦截不能。
 *   5. 统计口径**不排除**已下架 / 软删房源：它们照样引用着楼盘，外键照样炸。
 *      判定必须跟数据库的实际约束一致，不是跟「业务上还算不算数」一致。
 */

type Ctx = {
  count: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
  findByID: ReturnType<typeof vi.fn>
}

function makeReq(totalDocs: number, name: string | null = '环球金融中心'): { req: any } & Ctx {
  const count = vi.fn(async () => ({ totalDocs }))
  const del = vi.fn(async () => ({ docs: [], errors: [] }))
  const findByID = vi.fn(async () => (name === null ? {} : { id: 1, name }))
  return { req: { payload: { count, del: undefined, delete: del, findByID } }, count, del, findByID }
}

async function run(totalDocs: number, name?: string | null) {
  const ctx = makeReq(totalDocs, name)
  const call = () =>
    guardBuildingDelete({ id: 1, req: ctx.req, collection: {} as never, context: {} as never } as never)
  return { ...ctx, call }
}

describe('guardBuildingDelete', () => {
  it('楼盘下还有房源 → 抛错，文案含楼盘名与套数', async () => {
    const { call } = await run(12)
    await expect(call()).rejects.toThrow(/环球金融中心/)
    await expect(run(12).then((r) => r.call())).rejects.toThrow(/12 套/)
  })

  it('错误文案要给出可操作的出路，并提示「只是想下架的话不用删」', async () => {
    const { call } = await run(3)
    await expect(call()).rejects.toThrow(/删除或转移/)
    await expect(run(3).then((r) => r.call())).rejects.toThrow(/下架/)
  })

  it('拦下时不产生任何副作用——绝不能已经删了关系行才拦', async () => {
    const { call, del } = await run(1)
    await expect(call()).rejects.toThrow()
    expect(del).not.toHaveBeenCalled()
  })

  it('没有房源 → 放行，并清掉该楼盘的 building-merchant-relations', async () => {
    const { call, del } = await run(0)
    await expect(call()).resolves.toBeUndefined()
    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'building-merchant-relations',
        where: { building: { equals: 1 } },
        overrideAccess: true,
      }),
    )
  })

  it('取楼盘名失败时文案退化成编号，但**仍然拦截**', async () => {
    const ctx = makeReq(5)
    ctx.req.payload.findByID = vi.fn(async () => {
      throw new Error('boom')
    })
    await expect(
      guardBuildingDelete({ id: 77, req: ctx.req, collection: {} as never, context: {} as never } as never),
    ).rejects.toThrow(/编号 77/)
  })

  it('楼盘名为空白时同样退化成编号', async () => {
    const ctx = makeReq(2, '   ')
    await expect(
      guardBuildingDelete({ id: 9, req: ctx.req, collection: {} as never, context: {} as never } as never),
    ).rejects.toThrow(/编号 9/)
  })

  it('统计房源时不加任何状态过滤——已下架 / 软删的房源照样挡住删除', async () => {
    const { call, count } = await run(0)
    await call()
    const args = count.mock.calls[0][0]
    expect(args.where).toEqual({ building: { equals: 1 } })
    // 出现 publicationStatus / deletedAt 之类的过滤就说明口径跑偏了：
    // 那些房源仍然引用着楼盘，外键照样炸。
    expect(JSON.stringify(args.where)).not.toMatch(/publicationStatus|deletedAt|status/)
  })

  it('只取计数、不拉文档体（热门楼盘可能挂着上百套房源）', async () => {
    const { call, count } = await run(0)
    await call()
    expect(count).toHaveBeenCalledTimes(1)
  })
})

describe('Buildings collection 接线', () => {
  it('beforeDelete 挂上了 guardBuildingDelete', () => {
    expect(Buildings.hooks?.beforeDelete).toContain(guardBuildingDelete)
  })
})
