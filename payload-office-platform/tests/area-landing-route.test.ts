import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  resolveCityContext: vi.fn(),
  getCachedAreaLanding: vi.fn(),
  multiCity: true,
  viewProps: [] as unknown[],
  notFound: vi.fn(() => {
    throw new Error('not-found')
  }),
}))

vi.mock('next/navigation', () => ({ notFound: io.notFound }))
vi.mock('@/app/(frontend)/_lib/city-context', () => ({ resolveCityContext: io.resolveCityContext }))
vi.mock('@/lib/frontend/cached-queries', () => ({ getCachedAreaLanding: io.getCachedAreaLanding }))
vi.mock('@/lib/frontend/site-config', () => ({
  siteConfig: { siteOrigin: 'https://example.com', siteUrl: new URL('https://example.com') },
  getMultiCityRoutingEnabled: () => io.multiCity,
}))
vi.mock('@/components/frontend/city/AreaLandingView', () => ({
  default: (props: unknown) => {
    io.viewProps.push(props)
    return null
  },
}))

import AreaLandingPage, { generateMetadata } from '@/app/(frontend)/[city]/area/[slug]/page'
import type { AreaLandingEntry, AreaLandingPage as AreaLandingPageData } from '@/domain/public-catalog/area-landing-facade'

const liveCity = { id: 1, slug: 'shanghai', name: '上海', serviceStatus: 'live' as const }

function entry(overrides: Partial<AreaLandingEntry> = {}): AreaLandingEntry {
  return {
    kind: 'district', id: 15, slug: 'xuhui', name: '徐汇区', parentSlug: null, parentName: null, listingCount: 6216, buildingCount: 323,
    priceSampleCount: 6200, priceMin: 1.4, priceP25: 3.96, priceMedian: 4.31, priceP75: 5.1, priceMax: 9.78, otherUnitCount: 0,
    areaMedian: 313, lastUpdatedAt: '2026-10-15T08:00:00.000Z', description: null, indexable: true, ...overrides,
  }
}
function pageData(overrides: Partial<AreaLandingPageData> = {}): AreaLandingPageData {
  return { entry: entry(), parent: null, childAreas: [], siblingAreas: [], price: null, topBuildings: [], articles: [], ...overrides }
}

const props = (slug: string, city = 'shanghai') => ({ params: Promise.resolve({ city, slug }) })

async function render(slug: string, city = 'shanghai') {
  const element = await AreaLandingPage(props(slug, city))
  // 页面返回 <><script/><View/></>：把 View 的 props 和 JSON-LD 文本都取出来
  return element
}

beforeEach(() => {
  vi.clearAllMocks()
  io.viewProps.length = 0
  io.multiCity = true
  io.resolveCityContext.mockResolvedValue(liveCity)
  io.getCachedAreaLanding.mockResolvedValue(pageData())
})

describe('/[city]/area/[slug] 页面', () => {
  it('城市不存在 / 未开通 / 区域不存在 → 404，且未开通城市不查库', async () => {
    io.resolveCityContext.mockResolvedValueOnce(null)
    await expect(render('xuhui', 'nope')).rejects.toThrow('not-found')
    io.resolveCityContext.mockResolvedValueOnce({ ...liveCity, serviceStatus: 'coming-soon' })
    io.getCachedAreaLanding.mockClear()
    await expect(render('xuhui')).rejects.toThrow('not-found')
    expect(io.getCachedAreaLanding).not.toHaveBeenCalled()
    io.getCachedAreaLanding.mockResolvedValueOnce(null)
    await expect(render('missing')).rejects.toThrow('not-found')
  })

  it('按城市 + slug 取数；渲染视图并输出 JSON-LD', async () => {
    const element = await render('xuhui')
    expect(io.getCachedAreaLanding).toHaveBeenCalledWith('shanghai', 'xuhui')
    const json = JSON.stringify(element)
    expect(json).toContain('application/ld+json')
    expect(json).toContain('BreadcrumbList')
    expect(json).toContain('https://example.com/shanghai/area/xuhui')
  })

  it('把百分号编码的 slug 解码后再查（非 ASCII slug 也能命中）', async () => {
    await render('%E5%BE%90%E6%B1%87')
    expect(io.getCachedAreaLanding).toHaveBeenCalledWith('shanghai', '徐汇')
  })

  it('畸形百分号编码 → 404，而不是 500', async () => {
    await expect(render('%E0%A4%A')).rejects.toThrow('not-found')
  })
})

describe('/[city]/area/[slug] generateMetadata', () => {
  it('达标页：唯一 title / description / 自 canonical，可索引', async () => {
    const metadata = await generateMetadata(props('xuhui'))
    expect(metadata.title).toBe('徐汇区写字楼出租 · 办公室租金与热门楼盘')
    expect(metadata.description).toContain('4.31 元/㎡/天')
    expect(metadata.alternates?.canonical).toBe('/shanghai/area/xuhui')
    expect(metadata.robots).toMatchObject({ index: true })
  })

  it('薄页 noindex；多城开关关闭 noindex', async () => {
    io.getCachedAreaLanding.mockResolvedValueOnce(pageData({ entry: entry({ indexable: false, listingCount: 3 }) }))
    expect((await generateMetadata(props('xuhui'))).robots).toMatchObject({ index: false })
    io.multiCity = false
    expect((await generateMetadata(props('xuhui'))).robots).toMatchObject({ index: false })
  })

  it('不存在 / 未开通 → noindex,nofollow 的“未找到”元数据', async () => {
    io.getCachedAreaLanding.mockResolvedValueOnce(null)
    expect((await generateMetadata(props('missing'))).robots).toMatchObject({ index: false, follow: false })
    io.resolveCityContext.mockResolvedValueOnce(null)
    expect((await generateMetadata(props('xuhui', 'nope'))).robots).toMatchObject({ index: false, follow: false })
    io.resolveCityContext.mockResolvedValueOnce({ ...liveCity, serviceStatus: 'coming-soon' })
    expect((await generateMetadata(props('xuhui'))).robots).toMatchObject({ index: false, follow: false })
  })

  it('商圈页描述带所属行政区', async () => {
    io.getCachedAreaLanding.mockResolvedValueOnce(pageData({
      entry: entry({ kind: 'business_area', slug: 'caohejing', name: '漕河泾', parentSlug: 'xuhui', parentName: '徐汇区' }),
      parent: entry(),
    }))
    expect((await generateMetadata(props('caohejing'))).description).toContain('上海徐汇区漕河泾')
  })
})
