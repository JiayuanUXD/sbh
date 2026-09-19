import { describe, expect, it } from 'vitest'
import { navTargetById } from '@/lib/frontend/nav-targets'
import { MAIN_NAV_ITEMS, FOOTER_COLUMNS } from '@/lib/frontend/public-nav'
import { SITE_SETTINGS_FALLBACK } from '@/lib/frontend/site-settings'
import { SLOT_TARGETS } from '@/components/frontend/home/HomeTypeCards'

/**
 * OPT-103：共享办公入口全部指向独立频道 /coworking。
 * 生产后台 SiteSettings.mainNav 存的是目标 id（listings-type-coworking），只改 href 即零迁移。
 */
describe('共享办公入口', () => {
  it('导航目标池：listings-type-coworking 的 href 是 /coworking，其余类型目标不动', () => {
    expect(navTargetById('listings-type-coworking')?.href).toBe('/coworking')
    expect(navTargetById('listings-type-full-floor')?.href).toBe('/listings?type=full-floor')
  })

  it('默认主导航与站点设置兜底里再没有 /listings?type=coworking', () => {
    const hrefs = [
      ...MAIN_NAV_ITEMS.map((i) => i.href),
      ...FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href)),
      ...SITE_SETTINGS_FALLBACK.mainNav.map((i) => i.href),
      ...SITE_SETTINGS_FALLBACK.footerColumns.flatMap((c) => c.links.map((l) => l.href)),
    ]
    expect(hrefs).not.toContain('/listings?type=coworking')
    expect(hrefs.filter((h) => h === '/coworking').length).toBeGreaterThanOrEqual(2)
  })

  it('首页类型卡 coworking 槽位跳独立频道', () => {
    expect(SLOT_TARGETS['coworking']?.href).toBe('/coworking')
  })
})
