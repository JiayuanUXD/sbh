// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn() },
  search: new URLSearchParams(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.search,
}))

import FilterBar from '@/components/frontend/FilterBar'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  navigation.search = new URLSearchParams()
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('FilterBar city route ownership', () => {
  it('keeps quick-filter chips and reset links inside the supplied city listing path', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(React.createElement(FilterBar, {
      districts: [], basePath: '/hangzhou/listings',
    })))

    const quickFilter = [...container.querySelectorAll('a')].find((link) => link.textContent?.includes('近地铁'))
    const reset = [...container.querySelectorAll('a')].find((link) => link.textContent === '重置')
    expect(quickFilter?.getAttribute('href')).toBe('/hangzhou/listings?q=%E5%9C%B0%E9%93%81')
    expect(reset?.getAttribute('href')).toBe('/hangzhou/listings')
  })
})
