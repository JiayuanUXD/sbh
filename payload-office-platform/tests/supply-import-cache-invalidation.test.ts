import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

const { revalidateTag } = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidateTag }))

import { invalidateSupplyImportCache, resolveCitySlugs } from '@/domain/supply-import/cache-invalidation'

const LOCATIONS = [
  { id: 1, slug: 'shanghai', type: 'city' },
  { id: 2, slug: 'beijing', type: 'city' },
]

function fakePayload(overrides: { find?: ReturnType<typeof vi.fn> } = {}): Payload {
  const find =
    overrides.find ??
    vi.fn(async (opts: { collection: string; where?: { id?: { in?: unknown[] } } }) => {
      if (opts.collection !== 'locations') return { docs: [] }
      const ids = (opts.where?.id?.in ?? []).map(String)
      return { docs: LOCATIONS.filter((l) => ids.includes(String(l.id))) }
    })
  return { find } as unknown as Payload
}

describe('resolveCitySlugs', () => {
  it('空 cityIds → 空数组，不发查询', async () => {
    const find = vi.fn()
    const payload = fakePayload({ find })
    const slugs = await resolveCitySlugs(payload, undefined, [])
    expect(slugs).toEqual([])
    expect(find).not.toHaveBeenCalled()
  })

  it('按 id 查出对应 slug，去重', async () => {
    const payload = fakePayload()
    const slugs = await resolveCitySlugs(payload, undefined, [1, 1, 2])
    expect(new Set(slugs)).toEqual(new Set(['shanghai', 'beijing']))
  })

  it('查不到的 id 静默丢弃，不抛错', async () => {
    const payload = fakePayload()
    const slugs = await resolveCitySlugs(payload, undefined, [999])
    expect(slugs).toEqual([])
  })
})

describe('invalidateSupplyImportCache', () => {
  it('解析出城市 slug 后调用 revalidateTag 失效该城市的 tag', async () => {
    revalidateTag.mockClear()
    const payload = fakePayload()
    await invalidateSupplyImportCache(payload, undefined, [1], 'supply_import')
    const calledTags = revalidateTag.mock.calls.map((call) => call[0])
    expect(calledTags).toContain('public:home:shanghai')
  })

  it('cityIds 全部解析不出来 → 仍然调用（退化为全城市兜底），不静默跳过', async () => {
    revalidateTag.mockClear()
    const payload = fakePayload()
    await invalidateSupplyImportCache(payload, undefined, [999], 'supply_import_rollback')
    const calledTags = revalidateTag.mock.calls.map((call) => call[0])
    expect(calledTags).toContain('public:sitemap')
    expect(calledTags.some((t) => t.startsWith('public:home:'))).toBe(false)
  })
})
