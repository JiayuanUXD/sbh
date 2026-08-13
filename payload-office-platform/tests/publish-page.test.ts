import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  listPublicCityOptions: async () => [
    { slug: 'shanghai', name: '上海市', serviceStatus: 'live', sortOrder: 1 },
  ],
  resolveCityContext: async () => ({
    id: 1,
    slug: 'shanghai',
    name: '上海市',
    serviceStatus: 'live',
    profile: { sortOrder: 1 },
  }),
}))
import EntrustPage from '@/app/(frontend)/entrust/page'
import PublishPage, { metadata } from '@/app/(frontend)/publish/page'

describe('/publish page', () => {
  it('uses canonical metadata for the static publishing route', () => {
    expect(metadata.alternates?.canonical).toBe('/publish')
    expect(metadata.title).toBe('投放房源｜免费委托出租')
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it('renders one h1, one submission form, four process steps, and Service JSON-LD', async () => {
    const markup = renderToStaticMarkup(await PublishPage({ searchParams: Promise.resolve({}) }))

    expect(markup.match(/<h1\b/g)).toHaveLength(1)
    expect(markup.match(/class="process-steps__item"/g)).toHaveLength(4)
    expect(markup.match(/<form\b/g)).toHaveLength(1)
    expect(markup).toContain('房源委托 商办租赁 帮您出租')
    expect(markup).toContain('"@type":"Service"')
    expect(markup).not.toContain('"@type":"FAQPage"')
  })

  it('uses a publish-specific COS hero background that is separate from entrust', async () => {
    const publishMarkup = renderToStaticMarkup(await PublishPage({ searchParams: Promise.resolve({}) }))
    const entrustMarkup = renderToStaticMarkup(await EntrustPage({ searchParams: Promise.resolve({}) }))

    const publishBackground = '/api/media/file/landing-hero-publish-20260810.jpg?prefix=media'
    const entrustBackground = '/api/media/file/landing-hero-entrust-20260810.jpg?prefix=media'

    expect(publishMarkup).toContain(publishBackground)
    expect(entrustMarkup).toContain(entrustBackground)
    expect(publishBackground).not.toBe(entrustBackground)
    expect(publishMarkup).not.toContain(entrustBackground)
    expect(entrustMarkup).not.toContain(publishBackground)
  })
})
