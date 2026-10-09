import { describe, expect, it, vi } from 'vitest'
import { syncHomeFeaturedExclusivity } from '@/collections/Articles'

type HookArgs = Parameters<typeof syncHomeFeaturedExclusivity>[0]

// hook 只读 doc / req / context，collection 与 data 用最小桩；类型取自 hook 自身的
// 参数，Payload 改了 hook 契约这里会跟着报错，而不是被 any 吞掉。
function makeArgs(
  update: ReturnType<typeof vi.fn>,
  overrides: Pick<HookArgs, 'doc' | 'context'>,
): HookArgs {
  const req = { payload: { update } } as unknown as HookArgs['req']
  return {
    previousDoc: { id: overrides.doc.id, isHomeFeatured: false },
    data: {},
    req,
    operation: 'update',
    collection: {} as HookArgs['collection'],
    ...overrides,
  }
}

describe('syncHomeFeaturedExclusivity hook', () => {
  it('does nothing if skipHomeFeaturedSync context is set', async () => {
    const update = vi.fn()
    await syncHomeFeaturedExclusivity(makeArgs(update, {
      doc: { id: 1, isHomeFeatured: true },
      context: { skipHomeFeaturedSync: true },
    }))
    expect(update).not.toHaveBeenCalled()
  })

  it('does nothing if doc.isHomeFeatured is false or falsy', async () => {
    const update = vi.fn()
    await syncHomeFeaturedExclusivity(makeArgs(update, {
      doc: { id: 1, isHomeFeatured: false },
      context: {},
    }))
    expect(update).not.toHaveBeenCalled()
  })

  it('updates all other articles to isHomeFeatured: false within the same request', async () => {
    const update = vi.fn().mockResolvedValue({ docs: [], errors: [] })
    const args = makeArgs(update, { doc: { id: 42, isHomeFeatured: true }, context: {} })
    await syncHomeFeaturedExclusivity(args)

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({
      collection: 'articles',
      where: {
        and: [
          { isHomeFeatured: { equals: true } },
          { id: { not_equals: 42 } },
        ],
      },
      data: { isHomeFeatured: false },
      // 传 req 才会加入外层保存的事务，下面抛错时整笔回滚
      req: args.req,
      context: { skipHomeFeaturedSync: true },
    })
  })

  it('throws when the bulk update reports a per-document failure, so the save rolls back', async () => {
    const update = vi.fn().mockResolvedValue({
      docs: [],
      errors: [{ id: 7, isPublic: false, message: 'validation failed' }],
    })
    await expect(syncHomeFeaturedExclusivity(makeArgs(update, {
      doc: { id: 42, isHomeFeatured: true },
      context: {},
    }))).rejects.toThrow(/#7: validation failed/)
  })

  it('lets a thrown bulk update failure propagate instead of swallowing it', async () => {
    const update = vi.fn().mockRejectedValue(new Error('db down'))
    await expect(syncHomeFeaturedExclusivity(makeArgs(update, {
      doc: { id: 42, isHomeFeatured: true },
      context: {},
    }))).rejects.toThrow('db down')
  })
})
