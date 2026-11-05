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

describe('AdvisorCard 平台顾问卡片（OPT-127：电话高亮与右侧扫码拨打）', () => {
  it('渲染「商办顾问」、高亮电话号码（去除“客服电话”标签）及右侧扫码拨打与悬停浮层', async () => {
    const el = await AdvisorCard({
      phone: { display: '131-6224-7666', href: 'tel:13162247666' },
    })
    const html = renderToStaticMarkup(el!)

    // 核心信息保留
    expect(html).toContain('商办顾问')
    expect(html).toContain('131-6224-7666')
    expect(html).toContain('href="tel:13162247666"')
    expect(html).toContain('advisor-card__phone--highlight')

    // 去除“客服电话”前缀标签
    expect(html).not.toContain('advisor-card__phone-prefix')
    expect(html).not.toContain('>客服电话<')

    // 右侧常驻扫码区与悬停放大浮层
    expect(html).toContain('advisor-card__qr')
    expect(html).toContain('扫码拨打')
    expect(html).toContain('advisor-card__qr-popover')
    expect(html).toContain('手机扫码拨打')
    expect(html).toContain('微信或系统相机扫一扫')
    expect(html).toContain('data:image/svg+xml;utf8,')

    // 冗余文案与状态标签不存在
    expect(html).not.toContain('服务中')
    expect(html).not.toContain('非服务时段')
    expect(html).not.toContain('预计')
    expect(html).not.toContain('恢复')
  })

  it('未配置客服电话时，仅显示「商办顾问」，不渲染电话链接与右侧二维码', async () => {
    const el = await AdvisorCard({ phone: null })
    const html = renderToStaticMarkup(el!)

    expect(html).toContain('商办顾问')
    expect(html).not.toContain('href="tel:')
    expect(html).not.toContain('advisor-card__phone')
    expect(html).not.toContain('advisor-card__qr')
  })

  it('自动解析城市电话覆盖与全站默认配置，并生成二维码', async () => {
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

    // 上海城市覆盖号码生效且同步渲染二维码
    expect(html).toContain('021 6888 8888')
    expect(html).toContain('href="tel:02168888888"')
    expect(html).toContain('advisor-card__qr')
    expect(html).toContain('data:image/svg+xml;utf8,')
  })

  it('站点电话总开关关闭时，不显示电话入口与二维码', async () => {
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
    expect(html).not.toContain('advisor-card__qr')
  })
})
