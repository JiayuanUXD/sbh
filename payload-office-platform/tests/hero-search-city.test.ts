// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams() }))

import HeroSearch from '@/components/frontend/HeroSearch'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('HeroSearch city route ownership', () => {
  it('submits and quick-searches within the trusted city prefix', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(React.createElement(HeroSearch, {
      citySlug: 'hangzhou', districts: [], featuredBuildings: [{ slug: 'west-lake', name: '西湖中心' }],
    })))

    const form = container.querySelector('form')
    if (!form) throw new Error('missing hero form')
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

    expect(router.push).toHaveBeenCalledWith('/hangzhou/listings')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/hangzhou/listings?q=%E8%A5%BF%E6%B9%96%E4%B8%AD%E5%BF%83')
  })

  it('keeps the legacy route when no city prefix is supplied', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(React.createElement(HeroSearch, { districts: [] })))
    const form = container.querySelector('form')
    if (!form) throw new Error('missing hero form')
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(router.push).toHaveBeenCalledWith('/listings')
  })
})
