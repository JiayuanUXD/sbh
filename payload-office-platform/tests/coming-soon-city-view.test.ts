// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const trackSpy = vi.hoisted(() => vi.fn())
vi.mock('@/lib/frontend/analytics', () => ({
  track: trackSpy,
  safeTrackCityEvent: (tracker: typeof trackSpy, name: string, props: Record<string, unknown>) => {
    tracker(name, props)
  },
}))
vi.mock('@/components/frontend/InquiryModal', () => ({
  default: ({ triggerLabel, onTriggerClick }: { triggerLabel: string; onTriggerClick?: () => void }) => (
    React.createElement('button', { type: 'button', onClick: onTriggerClick }, triggerLabel)
  ),
}))

import ComingSoonCityView from '@/components/frontend/city/ComingSoonCityView'

const view = readFileSync('src/components/frontend/city/ComingSoonCityView.tsx', 'utf8')
const css = readFileSync('src/app/(frontend)/styles.css', 'utf8')
const comingSoonStyles = css.slice(css.indexOf('.city-coming-soon'))
let root: Root | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  trackSpy.mockClear()
})

describe('ComingSoonCityView shell', () => {
  it('does not nest a main landmark and can render the public profile hero media', () => {
    expect(view).toContain('<div className="city-coming-soon">')
    expect(view).not.toContain('<main className="city-coming-soon">')
    expect(view).toContain('profile.hero.media ? <img className="city-coming-soon__media"')
    expect(view).toContain('<CityPartnerApplicationForm')
  })

  it('styles readable responsive city sections and 44px action targets', () => {
    expect(css).toContain('.city-coming-soon__hero')
    expect(css).toContain('.city-coming-soon__district-grid')
    expect(css).toContain('.city-coming-soon__stats')
    expect(css).toContain('.city-coming-soon__benefits')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('@media (max-width: 767px)')
    expect(comingSoonStyles).not.toContain('var(--paper)')
    expect(comingSoonStyles).not.toContain('var(--ink)')
    expect(comingSoonStyles).not.toContain('var(--line)')
    expect(comingSoonStyles).toContain('var(--color-paper)')
    expect(comingSoonStyles).toContain('var(--color-ink)')
    expect(comingSoonStyles).toContain('var(--color-line)')
  })

  it('keeps the recruit composition free of the fabricated batch labels and platform stats', () => {
    // OPT-038 Task 5：改版把三块「编出来的东西」摘掉了，这条守卫防的是它们被恢复。
    //   1. `DEFAULT_DISTRICTS` 与「首批上线 / 筹备中 / 规划服务区」——
    //      招募位批次这个维度在 Locations / CitySiteProfiles 上都不存在，
    //      按列表位置挑前三个标成「首批」= 凭排序编造承诺（工作项 §3.3）；
    //   2. 平台实力背书数据（30,000+ / 1,500+ / 98.5% / 12 城）——四个写死的字面量，
    //      没有任何取数，且「12 城」与实际 7 座城市 profile 直接矛盾。
    // 断的是**源码**而不是渲染结果：这两组东西一旦被写回来，不论渲染条件如何都算破例。
    // 先剥注释——组件文件头就在解释「为什么删掉它们」，逐字提到了这些词。
    const code = view.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toContain('DEFAULT_DISTRICTS')
    expect(code).not.toMatch(/首批上线|筹备中|规划服务区/)
    expect(code).not.toMatch(/30,000|1,500|98\.5/)
    // 反过来：四段新版式必须都在（漏接一段就等于半新半旧并存）
    expect(view).toContain('<RecruitHero')
    expect(view).toContain('<RecruitValueProps')
    expect(view).toContain('<RecruitDistrictGrid')
    expect(view).toContain('<RecruitSecondaryCta')
  })

  it('keeps both conversion entries and the auxiliary links after the redesign', () => {
    // 稿子的次要入口只画了租客那一张卡。业主入口（/publish）与两条辅助跳转
    // 是城市路由的既有功能，改版只换版式、不删功能——这条把它们钉住。
    expect(view).toContain('/publish?city=')
    expect(view).toContain('/entrust?city=')
    expect(view).toContain('/city-partner?city=')
    expect(view).toContain('返回城市首页')
  })

  it('tracks each coming-soon action using only trusted city enums', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(React.createElement(ComingSoonCityView, { city: {
      id: 2,
      slug: 'hangzhou',
      name: '杭州',
      serviceStatus: 'coming-soon',
      profile: {
        cityId: 2, citySlug: 'hangzhou', cityName: '杭州', serviceStatus: 'coming-soon',
        switcherVisible: true, sortOrder: 20, avgResponseHours: null,
        seoTitle: '杭州办公租赁', seoDescription: '杭州办公租赁与选址服务。',
        hero: { eyebrow: '', heading: '', body: '', media: null },
        intro: { heading: '', body: '' }, contact: { heading: '', body: '' },
        featuredRegions: [],
      },
    } })))

    const partner = container.querySelector<HTMLAnchorElement>('a[href="/city-partner?city=hangzhou"]')
    if (!partner) throw new Error('missing partner CTA')
    await act(async () => partner.click())

    expect(trackSpy).toHaveBeenCalledWith('coming_soon_cta_clicked', {
      city: 'hangzhou', status: 'coming-soon', cta_type: 'city-partner',
    })
    expect(trackSpy).toHaveBeenCalledWith('city_partner_cta_clicked', {
      city: 'hangzhou', status: 'coming-soon',
    })
    expect(JSON.stringify(trackSpy.mock.calls)).not.toMatch(/phone|query|\?city/)
  })
})
