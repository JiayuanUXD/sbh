import { beforeEach, describe, expect, it, vi } from 'vitest'

const tx = vi.hoisted(() => ({ calls: [] as string[], failOn: null as string | null }))

vi.mock('payload', () => ({
  initTransaction: async (req: { transactionID?: unknown }) => {
    if (req.transactionID) return false
    req.transactionID = 'tx-1'
    tx.calls.push('begin')
    return true
  },
  commitTransaction: async (req: { transactionID?: unknown }) => {
    tx.calls.push('commit')
    delete req.transactionID
  },
  killTransaction: async (req: { transactionID?: unknown }) => {
    tx.calls.push('rollback')
    delete req.transactionID
  },
}))

import { saveBusinessAreaWithFeatured } from '@/domain/geography/business-area-save'

type Doc = Record<string, unknown>

function makeReq(opts: { type?: string; extension?: Doc | null } = {}) {
  const writes: Array<{ op: string; collection: string; data: Doc; id?: unknown }> = []
  const req = {
    user: { id: 1 },
    payload: {
      findByID: async () => ({ id: 7, type: opts.type ?? 'business_area' }),
      find: async () => ({ docs: opts.extension ? [opts.extension] : [] }),
      update: async (a: { collection: string; id: unknown; data: Doc }) => {
        writes.push({ op: 'update', collection: a.collection, data: a.data, id: a.id })
        if (tx.failOn === a.collection) throw new Error(`${a.collection} 写入失败`)
        return { id: a.id, ...a.data }
      },
      create: async (a: { collection: string; data: Doc }) => {
        writes.push({ op: 'create', collection: a.collection, data: a.data })
        if (tx.failOn === a.collection) throw new Error(`${a.collection} 写入失败`)
        return { id: 99, ...a.data }
      },
    },
  }
  return { req: req as never, writes }
}

beforeEach(() => {
  tx.calls = []
  tx.failOn = null
})

describe('saveBusinessAreaWithFeatured', () => {
  it('基础信息与精选序号在同一事务里提交', async () => {
    const { req, writes } = makeReq({ extension: { id: 5, version: 3 } })
    await saveBusinessAreaWithFeatured(req, {
      id: 7,
      location: { name: '虹桥', version: 2 },
      featured: { order: 4, version: 3 },
    })
    expect(writes.map((w) => `${w.op}:${w.collection}`)).toEqual([
      'update:locations',
      'update:business-area-extensions',
    ])
    expect(writes[1]?.data).toEqual({ featuredOrder: 4, version: 3 })
    expect(tx.calls).toEqual(['begin', 'commit'])
  })

  it('扩展写入失败 → 整笔回滚，不提交', async () => {
    tx.failOn = 'business-area-extensions'
    const { req } = makeReq({ extension: { id: 5, version: 3 } })
    await expect(
      saveBusinessAreaWithFeatured(req, { id: 7, location: { name: '虹桥' }, featured: { order: 4 } }),
    ).rejects.toThrow('business-area-extensions 写入失败')
    expect(tx.calls).toEqual(['begin', 'rollback'])
  })

  it('没有扩展记录且要设序号 → 新建；没有扩展记录且要清空 → 不写扩展', async () => {
    const created = makeReq({ extension: null })
    await saveBusinessAreaWithFeatured(created.req, { id: 7, location: {}, featured: { order: 2 } })
    expect(created.writes[1]).toMatchObject({
      op: 'create',
      collection: 'business-area-extensions',
      data: { businessArea: 7, featuredOrder: 2 },
    })

    const cleared = makeReq({ extension: null })
    await saveBusinessAreaWithFeatured(cleared.req, { id: 7, location: {}, featured: { order: null } })
    expect(cleared.writes.map((w) => w.collection)).toEqual(['locations'])
  })

  it('不带 featured → 只写基础信息', async () => {
    const { req, writes } = makeReq({ extension: { id: 5, version: 3 } })
    await saveBusinessAreaWithFeatured(req, { id: 7, location: { name: '虹桥' } })
    expect(writes.map((w) => w.collection)).toEqual(['locations'])
  })

  it('目标不是商圈 → 拒绝且不写库', async () => {
    const { req, writes } = makeReq({ type: 'district' })
    await expect(saveBusinessAreaWithFeatured(req, { id: 7, location: {} })).rejects.toMatchObject({
      code: 'NOT_BUSINESS_AREA',
    })
    expect(writes).toEqual([])
  })
})
