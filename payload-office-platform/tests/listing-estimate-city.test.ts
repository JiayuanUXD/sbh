import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  resolveCityContext: vi.fn(),
  createSearchContext: vi.fn(),
  getSearchFacets: vi.fn(),
  parseListingSearchInput: vi.fn(),
}))

vi.mock('@/app/(frontend)/_lib/city-context', () => ({ resolveCityContext: io.resolveCityContext }))
vi.mock('@/domain/public-catalog', () => ({
  createSearchContext: io.createSearchContext,
  getSearchFacets: io.getSearchFacets,
  parseListingSearchInput: io.parseListingSearchInput,
}))
vi.mock('@/lib/frontend/site-config', () => ({ siteConfig: { defaultCity: 'shanghai' } }))

import { estimateListingCount } from '@/app/(frontend)/listings/actions'

describe('estimateListingCount city boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    io.resolveCityContext.mockResolvedValue({ slug: 'hangzhou', serviceStatus: 'live' })
    io.parseListingSearchInput.mockReturnValue({ page: 1 })
    io.createSearchContext.mockReturnValue({ citySlug: 'hangzhou' })
    io.getSearchFacets.mockResolvedValue({ totalDocs: 12 })
  })

  it('resolves a trusted prefixed city on the server before estimating', async () => {
    await expect(estimateListingCount({ q: 'west lake' }, 'hangzhou')).resolves.toBe(12)
    expect(io.resolveCityContext).toHaveBeenCalledWith('hangzhou')
    expect(io.createSearchContext).toHaveBeenCalledWith('hangzhou')
  })

  it('fails closed for a reserved raw city slug before querying the catalog', async () => {
    await expect(estimateListingCount({}, 'news')).resolves.toBeNull()
    expect(io.resolveCityContext).not.toHaveBeenCalled()
    expect(io.getSearchFacets).not.toHaveBeenCalled()
  })
})
