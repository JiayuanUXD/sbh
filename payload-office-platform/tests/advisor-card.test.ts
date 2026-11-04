import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/frontend/site-settings', () => ({
  getCachedSiteSettings: vi.fn(),
}))

vi.mock('@/app/(frontend)/_lib/city-context', () => ({
  resolveCityContext: vi.fn(),
}))

import { getCachedSiteSettings } from '@/lib/frontend/site-settings'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import AdvisorCard from '@/components/frontend/AdvisorCard'

const mockGetSettings = vi.mocked(getCachedSiteSettings)
const mockResolveCity = vi.mocked(resolveCityContext)

describe('AdvisorCard 平台顾问卡片（方案 A 极简版：保留商办顾问与客服电话）', () => {
  it('渲染「商办顾问」与客服电话，且不包含任何服务时段冗余文案', async () => {
    const el = await AdvisorCard({
      phone: { display: '400-820-1234', href: 'tel:4008201234' },
    })
    const html = renderToStaticMarkup(el!)

    // 核心信息保留
    expect(html).toContain('商办顾问')
    expect(html).toContain('客服电话')
    expect(html).toContain('400-820-1234')
    expect(html).toContain('href="tel:4008201234"')

    // 冗余文案与状态标签彻底移除
    expect(html).not.toContain('服务中')
    expect(html).not.toContain('非服务时段')
    expect(html).not.toContain('当前服务中，欢迎咨询')
    expect(html).not.toContain('平台商办顾问，按服务时段响应咨询')
    expect(html).not.toContain('预计')
    expect(html).not.toContain('恢复')
    expect(html).not.toContain('advisor-card__status')
  })

  it('未配置客服电话时，仅显示「商办顾问」，不渲染电话链接', async () => {
    const el = await AdvisorCard({ phone: null })
    const html = renderToStaticMarkup(el!)

    expect(html).toContain('商办顾问')
    expect(html).not.toContain('href="tel:')
    expect(html).not.toContain('advisor-card__phone')
  })

  it('自动解析城市电话覆盖与全站默认配置', async () => {
    mockGetSettings.mockResolvedValueOnce({
      headerFeatures: {
        memberEntryVisible: false,
        servicePhoneVisible: true,
        servicePhone: { display: '400-820-1234', href: 'tel:4008201234' },
      },
    } as any)
    mockResolveCity.mockResolvedValueOnce({
      id: 1,
      slug: 'shanghai',
      name: '上海',
      serviceStatus: 'live',
      profile: {
        cityId: 1,
        citySlug: 'shanghai',
        cityName: '上海',
        serviceStatus: 'live',
        switcherVisible: true,
        sortOrder: 1,
        servicePhone: '021 6888 8888',
      } as any,
    })

    const el = await AdvisorCard({ citySlug: 'shanghai' })
    const html = renderToStaticMarkup(el!)

    // 上海城市覆盖号码生效
    expect(html).toContain('021 6888 8888')
    expect(html).toContain('href="tel:02168888888"')
    expect(html).toContain('商办顾问')
  })

  it('站点电话总开关关闭时，不显示电话入口', async () => {
    mockGetSettings.mockResolvedValueOnce({
      headerFeatures: {
        memberEntryVisible: false,
        servicePhoneVisible: false,
        servicePhone: { display: '400-820-1234', href: 'tel:4008201234' },
      },
    } as any)

    const el = await AdvisorCard({})
    const html = renderToStaticMarkup(el!)

    expect(html).toContain('商办顾问')
    expect(html).not.toContain('href="tel:')
    expect(html).not.toContain('advisor-card__phone')
  })
})
