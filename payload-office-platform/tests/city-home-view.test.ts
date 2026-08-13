import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
import CityHomeView from '@/components/frontend/city/CityHomeView'

const city = {
  id: 1, slug: 'shanghai', name: '上海', serviceStatus: 'live' as const,
  profile: {
    citySlug: 'shanghai', cityName: '上海', serviceStatus: 'live' as const,
    seoTitle: '', seoDescription: '', cityId: 1, switcherVisible: true, sortOrder: 1,
    hero: { eyebrow: 'Custom eyebrow', heading: 'Custom heading', body: 'Custom summary', media: null },
    intro: { heading: '', body: '' }, contact: { heading: '', body: '' }, featuredRegions: [],
  },
}
const homepage = { featuredListings: [], districts: [], featuredBuildings: [], districtCards: [], latestArticles: [] }

describe('CityHomeView legacy compatibility', () => {
  it('preserves the exact legacy hero copy while prefixed pages may use the city profile copy', () => {
    const legacy = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'legacy' }))
    const prefixed = renderToStaticMarkup(createElement(CityHomeView, { city, homepage, routeMode: 'prefixed' }))
    expect(legacy).toContain('汇聚高端商务空间，赋能企业卓越成长')
    expect(legacy).toContain('覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策')
    expect(legacy).not.toContain('覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策。')
    expect(prefixed).toContain('Custom heading')
  })
})
