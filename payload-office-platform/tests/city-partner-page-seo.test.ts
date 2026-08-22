import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cityState = vi.hoisted(() => ({
  listPublicCityOptions: vi.fn(),
  resolveCityContext: vi.fn(),
}))

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  listPublicCityOptions: cityState.listPublicCityOptions,
  resolveCityContext: cityState.resolveCityContext,
}))

import CityPartnerPage, { metadata } from '@/app/(frontend)/city-partner/page'

describe('city partner recruitment page', () => {
  beforeEach(() => {
    cityState.listPublicCityOptions.mockResolvedValue([
      { slug: 'shanghai', name: '上海', serviceStatus: 'live', sortOrder: 10 },
      { slug: 'hangzhou', name: '杭州', serviceStatus: 'coming-soon', sortOrder: 20 },
    ])
    cityState.resolveCityContext.mockImplementation(async (slug: string) => {
      if (slug !== 'shanghai' && slug !== 'hangzhou' && slug !== 'ningbo') return null
      return {
        slug,
        name: slug === 'shanghai' ? '上海' : slug === 'hangzhou' ? '杭州' : '宁波',
        serviceStatus: slug === 'shanghai' ? 'live' : 'coming-soon',
        profile: { sortOrder: 30 },
      }
    })
  })

  it('uses one global canonical and exactly one truthful H1', async () => {
    expect(metadata.alternates?.canonical).toBe('/city-partner')
    const markup = renderToStaticMarkup(await CityPartnerPage({ searchParams: Promise.resolve({}) }))
    expect(markup.match(/<h1\b/g)).toHaveLength(1)
    expect(markup).toContain('城市合作伙伴申请')
    // OPT-038 Task 5 加强（**只加不减**）：原断言只要求整份 markup 里出现过这七个字，
    // 于是「h1 说 A、把这七个字塞进某个 aria-label / 卡片标题」也能蒙混通过，
    // 而用例名 truthful 要保护的恰恰是「正文与 metadata.title 同口径」。
    // 这里把它落到 h1 自身的内容上，并对齐 metadata.title。
    expect(markup).toMatch(/<h1\b[^>]*>[^<]*城市合作伙伴申请/)
    expect(metadata.title).toBe('城市合作伙伴申请')
    expect(markup).not.toMatch(/保证收益|独家代理|开城日期|年入百万/)
  })

  it('preselects a validated query city and visibly disables an explicit invalid city', async () => {
    const validMarkup = renderToStaticMarkup(await CityPartnerPage({
      searchParams: Promise.resolve({ city: 'hangzhou' }),
    }))
    expect(validMarkup).toMatch(/<option value="hangzhou" selected="">杭州/)
    expect(cityState.resolveCityContext).toHaveBeenCalledWith('hangzhou')

    const invalidMarkup = renderToStaticMarkup(await CityPartnerPage({
      searchParams: Promise.resolve({ city: 'HangZhou' }),
    }))
    expect(invalidMarkup).toContain('链接中的城市无效')
    expect(invalidMarkup).toMatch(/<button[^>]*disabled=""/)
    expect(invalidMarkup).not.toContain('HangZhou')
    expect(cityState.resolveCityContext).not.toHaveBeenCalledWith('HangZhou')
  })

  it('accepts a validated hidden profile and fails closed when the configured default cannot resolve', async () => {
    const hiddenMarkup = renderToStaticMarkup(await CityPartnerPage({
      searchParams: Promise.resolve({ city: 'ningbo' }),
    }))
    expect(hiddenMarkup).toMatch(/<option value="ningbo" selected="">宁波/)

    cityState.resolveCityContext.mockResolvedValueOnce(null)
    const missingDefaultMarkup = renderToStaticMarkup(await CityPartnerPage({
      searchParams: Promise.resolve({}),
    }))
    expect(missingDefaultMarkup).toContain('当前默认城市暂不可申请')
    expect(missingDefaultMarkup).toMatch(/<button[^>]*disabled=""/)
  })

  it.each([
    { city: ['hangzhou'] },
    { city: '' },
  ])('rejects non-scalar and empty explicit city queries without resolving them: %j', async (query) => {
    cityState.resolveCityContext.mockClear()
    const markup = renderToStaticMarkup(await CityPartnerPage({ searchParams: Promise.resolve(query) }))
    expect(markup).toContain('链接中的城市无效')
    expect(markup).toMatch(/<button[^>]*disabled=""/)
    expect(cityState.resolveCityContext).not.toHaveBeenCalled()
  })
})
