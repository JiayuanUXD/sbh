// @vitest-environment happy-dom

import React, { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import HomeHeroMedia from '@/components/frontend/HomeHeroMedia'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

describe('HomeHeroMedia', () => {
  it('uses a city profile hero image instead of the default-city video poster', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const CityHeroMedia = HomeHeroMedia as React.ComponentType<{ poster?: { src: string; alt: string } }>
    await act(async () => root?.render(createElement(CityHeroMedia, {
      poster: { src: 'https://cdn.example.test/hangzhou-hero.jpg', alt: '杭州城市天际线' },
    })))
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.test/hangzhou-hero.jpg')
    expect(container.querySelector('video')).toBeNull()
  })
})
