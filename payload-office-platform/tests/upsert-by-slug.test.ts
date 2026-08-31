import { describe, expect, it } from 'vitest'

import { type SeedPayloadLike, upsertBySlug, withRestore } from '@/lib/runtime/upsert-by-slug'

type Call = { op: 'find' | 'update' | 'create'; args: Record<string, unknown> }

/**
 * 极简假 payload：docs 是「库里的行」，其中 deletedAt 非空表示软删。
 * find 只实现 seed 用到的那一种查询（slug equals + limit 1），并**按 trash 参数
 * 过滤软删行**——真库的行为就是这样，这正是本测试要守住的点。
 */
function fakePayload(rows: Array<{ id: number; slug: string; deletedAt?: string | null }>) {
  const calls: Call[] = []
  const payload: SeedPayloadLike = {
    async find(args) {
      calls.push({ op: 'find', args: args as Record<string, unknown> })
      const slug = (args.where as any)?.slug?.equals
      const docs = rows
        .filter((r) => r.slug === slug)
        .filter((r) => (args.trash ? true : !r.deletedAt))
        .slice(0, args.limit ?? rows.length)
      return { docs }
    },
    async update(args) {
      calls.push({ op: 'update', args: args as Record<string, unknown> })
      return { id: args.id, ...args.data }
    },
    async create(args) {
      calls.push({ op: 'create', args: args as Record<string, unknown> })
      // 真库里 slug 有 unique 约束，软删的行照样占着这个 slug。
      const slug = args.data.slug
      if (rows.some((r) => r.slug === slug)) {
        throw new Error('ValidationError: 下面的字段是无效的： slug')
      }
      return { id: 999, ...args.data }
    },
  }
  return { payload, calls }
}

describe('upsertBySlug', () => {
  it('查询带 trash: true，命中回收站里的同 slug 行时走 update 而不是 create', async () => {
    const { payload, calls } = fakePayload([
      { id: 7, slug: 'jingan-serviced-office-42-seats', deletedAt: '2026-08-31T00:00:00.000Z' },
    ])

    const result = await upsertBySlug(payload, 'listings', 'jingan-serviced-office-42-seats', {
      title: '静安服务式办公 42 工位',
    })

    expect(calls.find((c) => c.op === 'find')?.args.trash).toBe(true)
    expect(calls.some((c) => c.op === 'create')).toBe(false)
    expect(result.created).toBe(false)
    const update = calls.find((c) => c.op === 'update')
    expect(update?.args.id).toBe(7)
    expect(update?.args.trash).toBe(true)
  })

  it('命中软删行时顺带恢复：update 的数据里带 deletedAt: null', async () => {
    const { payload, calls } = fakePayload([
      { id: 7, slug: 'media-rich-listing', deletedAt: '2026-08-31T00:00:00.000Z' },
    ])

    await upsertBySlug(payload, 'listings', 'media-rich-listing', { title: 'x' })

    const data = calls.find((c) => c.op === 'update')?.args.data as Record<string, unknown>
    expect(data.deletedAt).toBeNull()
    expect(data.title).toBe('x')
  })

  it('命中未软删的行时不写 deletedAt（没开 trash 的集合上那是个不存在的字段）', async () => {
    const { payload, calls } = fakePayload([{ id: 3, slug: 'shanghai' }])

    const result = await upsertBySlug(payload, 'locations', 'shanghai', { name: '上海' })

    expect(result.created).toBe(false)
    const data = calls.find((c) => c.op === 'update')?.args.data as Record<string, unknown>
    expect('deletedAt' in data).toBe(false)
  })

  it('update 不带 immutableCode（protectLocation hook 会拒绝改建码），create 带', async () => {
    const seeded = { name: '上海', immutableCode: 'CN-SH' }

    const existing = fakePayload([{ id: 3, slug: 'shanghai' }])
    await upsertBySlug(existing.payload, 'locations', 'shanghai', { ...seeded })
    const updateData = existing.calls.find((c) => c.op === 'update')?.args.data as Record<
      string,
      unknown
    >
    expect('immutableCode' in updateData).toBe(false)

    const fresh = fakePayload([])
    await upsertBySlug(fresh.payload, 'locations', 'shanghai', { ...seeded })
    const createData = fresh.calls.find((c) => c.op === 'create')?.args.data as Record<
      string,
      unknown
    >
    expect(createData.immutableCode).toBe('CN-SH')
    expect(createData.slug).toBe('shanghai')
  })

  it('库里没有该 slug 时走 create', async () => {
    const { payload, calls } = fakePayload([{ id: 1, slug: 'other' }])

    const result = await upsertBySlug(payload, 'pages', 'about', { title: '关于我们' })

    expect(result.created).toBe(true)
    expect(calls.some((c) => c.op === 'update')).toBe(false)
    expect((calls.find((c) => c.op === 'create')?.args.data as any).slug).toBe('about')
  })

  it('回归守卫：find 若不带 trash，软删行会被漏查并撞上 slug 唯一约束', async () => {
    // 这条用例描述的是修复前的行为——直接对假库发一次「不带 trash」的查询，
    // 证明假库确实能复现 2026-08-31 那次 `ValidationError: ... slug` 失败，
    // 从而说明上面几条断言不是在测一个不会发生的场景。
    const { payload } = fakePayload([
      { id: 7, slug: 'jingan-serviced-office-42-seats', deletedAt: '2026-08-31T00:00:00.000Z' },
    ])

    const blind = await payload.find({
      collection: 'listings',
      limit: 1,
      where: { slug: { equals: 'jingan-serviced-office-42-seats' } },
    })
    expect(blind.docs).toHaveLength(0)

    await expect(
      payload.create({
        collection: 'listings',
        data: { slug: 'jingan-serviced-office-42-seats' },
      }),
    ).rejects.toThrow(/slug/)
  })
})

describe('withRestore', () => {
  it('软删的行：补一个 deletedAt: null 触发恢复，原数据不被改动', () => {
    const data = { title: 'x' }
    const out = withRestore(data, { id: 1, deletedAt: '2026-08-31T00:00:00.000Z' })

    expect(out).toEqual({ title: 'x', deletedAt: null })
    expect(data).toEqual({ title: 'x' }) // 不就地改调用方的对象
  })

  it('未软删 / 没开 trash 的集合：原样返回，不写不存在的 deletedAt 字段', () => {
    const data = { title: 'x' }

    expect(withRestore(data, { id: 1 })).toBe(data)
    expect(withRestore(data, { id: 1, deletedAt: null })).toBe(data)
  })
})
