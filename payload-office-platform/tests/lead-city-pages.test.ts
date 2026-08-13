import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveCityContextMock = vi.fn()
const listPublicCityOptionsMock = vi.fn()

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  resolveCityContext: (slug: unknown) => resolveCityContextMock(slug),
  listPublicCityOptions: () => listPublicCityOptionsMock(),
}))

import EntrustPage from '@/app/(frontend)/entrust/page'
import PublishPage from '@/app/(frontend)/publish/page'

const city = (slug: string, name: string, id: number) => ({
  id,
  slug,
  name,
  serviceStatus: 'live' as const,
  profile: { sortOrder: id },
})

beforeEach(() => {
  listPublicCityOptionsMock.mockResolvedValue([
    { slug: 'shanghai', name: '上海市', serviceStatus: 'live', sortOrder: 1 },
    { slug: 'hangzhou', name: '杭州市', serviceStatus: 'live', sortOrder: 2 },
  ])
  resolveCityContextMock.mockImplementation(async (slug: unknown) =>
    slug === 'shanghai'
      ? city('shanghai', '上海市', 1)
      : slug === 'hangzhou'
        ? city('hangzhou', '杭州市', 2)
        : null,
  )
})

describe.each([
  ['entrust', EntrustPage],
  ['publish', PublishPage],
] as const)('/%s trusted city selection', (path, Page) => {
  it('uses the validated configured default when city is missing', async () => {
    const element = await Page({ searchParams: Promise.resolve({}) })
    const markup = renderToStaticMarkup(element)

    expect(resolveCityContextMock).toHaveBeenCalledWith('shanghai')
    expect(markup).toContain('name="city"')
    expect(markup).toContain('value="shanghai" selected=""')
    expect(markup).not.toContain('城市无效')
  })

  it('uses a trusted explicit city and does not expose its relationship ID', async () => {
    const element = await Page({ searchParams: Promise.resolve({ city: 'hangzhou' }) })
    const markup = renderToStaticMarkup(element)

    expect(resolveCityContextMock).toHaveBeenCalledWith('hangzhou')
    expect(markup).toContain('value="hangzhou" selected=""')
    expect(markup).not.toContain('name="cityId"')
  })

  it('shows a visible error and disables submission for an explicit invalid city', async () => {
    const element = await Page({ searchParams: Promise.resolve({ city: 'entrust' }) })
    const markup = renderToStaticMarkup(element)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('城市无效')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/)
  })
})
