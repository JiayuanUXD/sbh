import { describe, expect, it } from 'vitest'
import { resolveCtaPageType } from '@/components/frontend/SiteNav'

describe('resolveCtaPageType', () => {
  it('attributes the global selection CTA to the entrust landing page', () => {
    expect(resolveCtaPageType('/entrust')).toBe('entrust')
    expect(resolveCtaPageType('/entrust/')).toBe('entrust')
  })

  it('keeps the established attribution for other public routes', () => {
    expect(resolveCtaPageType('/')).toBe('home')
    expect(resolveCtaPageType('/listings')).toBe('search')
    expect(resolveCtaPageType('/buildings/example')).toBe('building')
    expect(resolveCtaPageType('/news/article')).toBe('content')
  })
})
