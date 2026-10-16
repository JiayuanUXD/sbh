import { describe, expect, it, vi } from 'vitest'

import type { AreaLandingEntry } from '@/domain/public-catalog/area-landing-facade'
import {
  locationFilterTarget,
  resolveAreaLandingCanonicalPath,
  withAreaLandingCanonical,
} from '@/lib/frontend/area-landing-canonical'

function entry(overrides: Partial<AreaLandingEntry>): AreaLandingEntry {
  return {
    kind: 'district', id: 1, slug: 'xuhui', name: '徐汇区', parentSlug: null, parentName: null, listingCount: 100, buildingCount: 10,
    priceSampleCount: 100, priceMin: 1, priceP25: 2, priceMedian: 3, priceP75: 4, priceMax: 5, otherUnitCount: 0, areaMedian: 100,
    lastUpdatedAt: null, description: null, indexable: true, ...overrides,
  }
}

describe('locationFilterTarget：只认「纯地点」的筛选页', () => {
  it.each([
    ['district=xuhui', { kind: 'district', slug: 'xuhui' }],
    ['businessArea=caohejing', { kind: 'business_area', slug: 'caohejing' }],
  ])('%s → 落地页目标', (query, expected) => {
    expect(locationFilterTarget(query)).toEqual(expected)
  })

  it.each([
    ['无筛选', ''],
    ['叠加了别的条件', 'district=xuhui&grade=grade-a'],
    ['叠加了类型', 'district=xuhui&type=coworking'],
    ['行政区 + 商圈同时选', 'businessArea=caohejing&district=xuhui'],
    ['多个行政区', 'district=xuhui&district=jingan'],
    ['第 2 页', 'district=xuhui&page=2'],
    ['非默认排序', 'district=xuhui&sort=newest'],
    ['出售口径', 'business=sale&district=xuhui'],
    ['空值', 'district='],
  ])('%s → 不合并', (_, query) => {
    expect(locationFilterTarget(query)).toBeNull()
  })
})

describe('resolveAreaLandingCanonicalPath', () => {
  const index = [
    entry({ slug: 'xuhui' }),
    entry({ kind: 'business_area', id: 2, slug: 'caohejing', parentSlug: 'xuhui' }),
    entry({ slug: 'thin', indexable: false }),
  ]

  it('达标地点 → 落地页路径', async () => {
    const load = vi.fn(async () => index)
    expect(await resolveAreaLandingCanonicalPath('shanghai', 'district=xuhui', load)).toBe('/shanghai/area/xuhui')
    expect(await resolveAreaLandingCanonicalPath('shanghai', 'businessArea=caohejing', load)).toBe('/shanghai/area/caohejing')
  })

  it('不是纯地点筛选时不取数', async () => {
    const load = vi.fn(async () => index)
    expect(await resolveAreaLandingCanonicalPath('shanghai', 'district=xuhui&grade=grade-a', load)).toBeNull()
    expect(await resolveAreaLandingCanonicalPath('shanghai', '', load)).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it.each([
    ['薄页（落地页是 noindex）', 'district=thin'],
    ['不存在的地点', 'district=nope'],
    ['类型对不上（商圈 slug 当行政区）', 'district=caohejing'],
  ])('%s → 保持自 canonical', async (_, query) => {
    expect(await resolveAreaLandingCanonicalPath('shanghai', query, async () => index)).toBeNull()
  })

  it('取数失败时降级为自 canonical，不让筛选页一起 500', async () => {
    const load = vi.fn(async () => { throw new Error('db down') })
    expect(await resolveAreaLandingCanonicalPath('shanghai', 'district=xuhui', load)).toBeNull()
  })
})

describe('withAreaLandingCanonical', () => {
  it('只替换 canonical 与 og:url，其余字段原样保留', () => {
    const base = {
      title: '上海写字楼',
      robots: { index: true, follow: true },
      alternates: { canonical: '/shanghai/buildings?district=xuhui' },
      openGraph: { type: 'website' as const, url: 'https://example.com/shanghai/buildings?district=xuhui', title: 'x' },
    }
    const next = withAreaLandingCanonical(base, '/shanghai/area/xuhui', 'https://example.com')
    expect(next.alternates?.canonical).toBe('/shanghai/area/xuhui')
    expect((next.openGraph as { url?: string }).url).toBe('https://example.com/shanghai/area/xuhui')
    expect(next.title).toBe('上海写字楼')
    expect(next.robots).toEqual({ index: true, follow: true })
  })
})
