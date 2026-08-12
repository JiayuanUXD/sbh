import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  __resetSiteConfigCacheForTests,
  getMultiCityRoutingEnabled,
  getSiteConfig,
} from '@/lib/frontend/site-config'

afterEach(() => {
  vi.unstubAllEnvs()
  __resetSiteConfigCacheForTests()
})

describe('site config city routing', () => {
  it('accepts an unlisted default city without requiring a build-time profile lookup', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_CITY', 'hangzhou')
    __resetSiteConfigCacheForTests()

    expect(getSiteConfig().defaultCity).toBe('hangzhou')
  })

  it.each([
    ['true', true],
    ['false', false],
    ['1', false],
    ['TRUE', false],
    ['', false],
  ])('enables multi-city routing only for %j', (value, expected) => {
    vi.stubEnv('MULTI_CITY_ROUTING_ENABLED', value)

    expect(getMultiCityRoutingEnabled()).toBe(expected)
  })
})
