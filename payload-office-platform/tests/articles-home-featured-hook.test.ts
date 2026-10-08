import { describe, expect, it, vi } from 'vitest'
import { syncHomeFeaturedExclusivity } from '@/collections/Articles'

describe('syncHomeFeaturedExclusivity hook', () => {
  it('does nothing if skipHomeFeaturedSync context is set', async () => {
    const update = vi.fn()
    const req = {
      payload: { update },
    } as unknown as Parameters<typeof syncHomeFeaturedExclusivity>[0]['req']

    await syncHomeFeaturedExclusivity({
      doc: { id: 1, isHomeFeatured: true },
      previousDoc: { id: 1, isHomeFeatured: false },
      data: {},
      req,
      context: { skipHomeFeaturedSync: true },
      operation: 'update',
      collection: {} as any,
    })

    expect(update).not.toHaveBeenCalled()
  })

  it('does nothing if doc.isHomeFeatured is false or falsy', async () => {
    const update = vi.fn()
    const req = {
      payload: { update },
    } as unknown as Parameters<typeof syncHomeFeaturedExclusivity>[0]['req']

    await syncHomeFeaturedExclusivity({
      doc: { id: 1, isHomeFeatured: false },
      previousDoc: { id: 1, isHomeFeatured: false },
      data: {},
      req,
      context: {},
      operation: 'update',
      collection: {} as any,
    })

    expect(update).not.toHaveBeenCalled()
  })

  it('updates all other articles to isHomeFeatured: false when doc.isHomeFeatured is true', async () => {
    const update = vi.fn().mockResolvedValue([])
    const req = {
      payload: { update },
    } as unknown as Parameters<typeof syncHomeFeaturedExclusivity>[0]['req']

    await syncHomeFeaturedExclusivity({
      doc: { id: 42, isHomeFeatured: true },
      previousDoc: { id: 42, isHomeFeatured: false },
      data: {},
      req,
      context: {},
      operation: 'update',
      collection: {} as any,
    })

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
      context: { skipHomeFeaturedSync: true },
    })
  })
})
