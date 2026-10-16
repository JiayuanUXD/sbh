import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ getCachedAreaLandingIndex: vi.fn(), multiCity: true }))

vi.mock('@/lib/frontend/cached-queries', () => ({ getCachedAreaLandingIndex: io.getCachedAreaLandingIndex }))
vi.mock('@/lib/frontend/site-config', () => ({
  siteConfig: { siteOrigin: 'https://example.com' },
  getMultiCityRoutingEnabled: () => io.multiCity,
}))

import { withLocationFilterCanonical } from '@/app/(frontend)/_lib/location-filter-canonical'

const base = {
  title: '上海在租房源',
  alternates: { canonical: '/shanghai/listings?district=xuhui' },
  openGraph: { type: 'website' as const, url: 'https://example.com/shanghai/listings?district=xuhui' },
}
const index = [{ kind: 'district', slug: 'xuhui', indexable: true }]

beforeEach(() => {
  vi.clearAllMocks()
  io.multiCity = true
  io.getCachedAreaLandingIndex.mockResolvedValue(index)
})

describe('withLocationFilterCanonical', () => {
  it('纯地点筛选且落地页达标 → canonical 指向落地页', async () => {
    const result = await withLocationFilterCanonical(base, { citySlug: 'shanghai', serviceStatus: 'live', canonicalQuery: 'district=xuhui' })
    expect(result.alternates?.canonical).toBe('/shanghai/area/xuhui')
    expect(io.getCachedAreaLandingIndex).toHaveBeenCalledWith('shanghai')
  })

  it('叠加了其它条件 → 原样返回且不取数', async () => {
    const result = await withLocationFilterCanonical(base, { citySlug: 'shanghai', serviceStatus: 'live', canonicalQuery: 'district=xuhui&type=coworking' })
    expect(result).toBe(base)
    expect(io.getCachedAreaLandingIndex).not.toHaveBeenCalled()
  })

  it('未开通城市 / 多城开关关闭 → 原样返回且不取数（未开城不查库）', async () => {
    expect(await withLocationFilterCanonical(base, { citySlug: 'hangzhou', serviceStatus: 'coming-soon', canonicalQuery: 'district=xuhui' })).toBe(base)
    io.multiCity = false
    expect(await withLocationFilterCanonical(base, { citySlug: 'shanghai', serviceStatus: 'live', canonicalQuery: 'district=xuhui' })).toBe(base)
    expect(io.getCachedAreaLandingIndex).not.toHaveBeenCalled()
  })
})

describe('两个列表路由都经过同一个合并函数（不各写一份）', () => {
  it.each(['listings', 'buildings'])('[city]/%s/page.tsx', (segment) => {
    const source = readFileSync(join(process.cwd(), `src/app/(frontend)/[city]/${segment}/page.tsx`), 'utf8')
    expect(source).toContain('withLocationFilterCanonical')
  })

  it('出售口径的楼盘页不合并（保持 noindex，canonical 仍带 business=sale）', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/(frontend)/[city]/buildings/page.tsx'), 'utf8')
    const afterSaleGuard = source.slice(source.indexOf("if (input.business !== 'sale')"))
    expect(afterSaleGuard.indexOf('withLocationFilterCanonical')).toBeLessThan(afterSaleGuard.indexOf('在售写字楼楼盘'))
  })
})
