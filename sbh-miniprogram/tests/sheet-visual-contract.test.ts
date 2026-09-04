import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const runnerPath = resolve(projectRoot, 'scripts/mp109-sheet-acceptance-runner.mjs')

function read(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('MP-109 抽屉共享设计系统', () => {
  it('提供 primitive → semantic → component 的共享 sheet tokens', () => {
    const tokens = read('miniprogram/styles/tokens.wxss')

    expect(tokens).toContain('--sbh-color-black-alpha-48:')
    expect(tokens).toContain('--sbh-duration-180: 180ms;')
    expect(tokens).toContain('--sbh-overlay-background: var(--sbh-color-black-alpha-48);')
    expect(tokens).toContain('--sbh-sheet-backdrop-background: var(--sbh-overlay-background);')
    expect(tokens).toContain('--sbh-sheet-panel-radius:')
    expect(tokens).toContain('--sbh-sheet-close-size: var(--sbh-size-touch-target);')
    expect(tokens).toContain('--sbh-sheet-motion-duration: var(--sbh-motion-sheet-duration);')
    expect(tokens).toContain('--sbh-sheet-header-min-height:')
    expect(tokens).toContain('--sbh-sheet-footer-background: var(--sbh-surface-background);')
  })

  it('找房页打开抽屉锁背景，并在打开、关闭、应用、隐藏、卸载和异常路径成对管理原生 TabBar', () => {
    const source = read('miniprogram/pages/listings/index.ts')
    const markup = read('miniprogram/pages/listings/index.wxml')

    expect(markup).toMatch(/<page-meta[\s\S]*sheetOpen[\s\S]*overflow:\s*hidden/)
    expect(markup).toContain('aria-hidden="{{sheetOpen}}"')
    expect(source).toContain('showModalTabBarBoundary')
    expect(source).toContain('restoreModalTabBarBoundary')
    expect(source).toMatch(/handleOpenFilter[\s\S]*showModalTabBarBoundary/)
    expect(source).toMatch(/handleFilterApply[\s\S]*restoreModalTabBarBoundary/)
    expect(source).toMatch(/handleFilterClose[\s\S]*restoreModalTabBarBoundary/)
    expect(source).toMatch(/onHide\(\)[\s\S]*restoreModalTabBarBoundary/)
    expect(source).toMatch(/onUnload\(\)[\s\S]*restoreModalTabBarBoundary/)
    expect(source).toMatch(/showModalTabBarBoundary[\s\S]*catch[\s\S]*restoreModalTabBarBoundary/)
  })

  it('所有咨询宿主页均锁背景且接入真实 inquiry-sheet，首页和楼盘页不再用 toast 冒充委托', () => {
    for (const page of ['home', 'buildings', 'building-detail', 'listing-detail']) {
      const markup = read(`miniprogram/pages/${page}/index.wxml`)
      const config = JSON.parse(read(`miniprogram/pages/${page}/index.json`)) as {
        usingComponents?: Record<string, string>
      }
      expect(markup, page).toMatch(/<page-meta[\s\S]*inquiryOpen[\s\S]*overflow:\s*hidden/)
      expect(markup, page).toContain('<inquiry-sheet')
      expect(config.usingComponents?.['inquiry-sheet'], page).toBe('/components/inquiry-sheet/index')
    }

    expect(read('miniprogram/pages/home/index.ts')).toContain("targetType: 'general'")
    expect(read('miniprogram/pages/buildings/index.ts')).toContain("targetType: 'general'")
  })

  it('详情收藏使用中性 CSS 图标，不含红色或心形 emoji', () => {
    const detailSources = [
      'miniprogram/pages/listing-detail/index.wxml',
      'miniprogram/pages/listing-detail/index.wxss',
      'miniprogram/pages/building-detail/index.wxml',
      'miniprogram/pages/building-detail/index.wxss',
    ].map(read).join('\n')

    expect(detailSources).not.toMatch(/[♥♡❤]/)
    expect(detailSources).not.toMatch(/#ff3b30/i)
    expect(detailSources).toContain('favorite-icon__glyph')
  })
})

describe('MP-109 runner fail-closed 合同', () => {
  it('runner 存在且通过真实 tap 打开价格、全部筛选和咨询抽屉', () => {
    expect(existsSync(runnerPath)).toBe(true)
    if (!existsSync(runnerPath)) return
    const source = readFileSync(runnerPath, 'utf8')

    expect(source).toContain('priceFilter.tap()')
    expect(source).toContain('allFilter.tap()')
    expect(source).toContain('inquiryCta.tap()')
    expect(source).not.toMatch(/callMethod\(['"]handleOpen(?:Filter|Inquiry)/)
    for (const name of [
      'filterPrice',
      'filterAll',
      'inquiryWechat',
      'inquiryManual',
      'inquiryError',
      'inquirySubmitting',
      'inquirySuccess',
    ]) expect(source).toContain(name)
  })

  it('缺 selector、几何越界或 TabBar 可见时一律失败', async () => {
    expect(existsSync(runnerPath)).toBe(true)
    if (!existsSync(runnerPath)) return
    const module = await import(`${pathToFileURL(runnerPath).href}?test=${Date.now()}`) as {
      evaluateSheetGeometry(input: unknown): { passed: boolean; failures: readonly string[] }
    }
    const valid = {
      viewport: { width: 375, height: 812 },
      panel: { left: 0, right: 375, top: 160, bottom: 812 },
      footer: { left: 0, right: 375, top: 724, bottom: 790 },
      close: { left: 315, right: 359, top: 180, bottom: 224 },
      primaryAction: { left: 16, right: 359, top: 730, bottom: 790 },
      safeAreaBottomInset: 22,
      requiredSelectorsPresent: true,
      tabBarVisible: false,
      expectedSectionOnly: true,
    }

    expect(module.evaluateSheetGeometry(valid).passed).toBe(true)
    expect(module.evaluateSheetGeometry({ ...valid, requiredSelectorsPresent: false }).passed).toBe(false)
    expect(module.evaluateSheetGeometry({ ...valid, panel: { ...valid.panel, right: 391 } }).passed).toBe(false)
    expect(module.evaluateSheetGeometry({ ...valid, footer: { ...valid.footer, bottom: 820 } }).passed).toBe(false)
    expect(module.evaluateSheetGeometry({ ...valid, close: { ...valid.close, right: 350 } }).passed).toBe(false)
    expect(module.evaluateSheetGeometry({ ...valid, close: { ...valid.close, left: 250, right: 294 } }).passed).toBe(false)
    expect(module.evaluateSheetGeometry({ ...valid, primaryAction: { ...valid.primaryAction, bottom: 800 } }).passed).toBe(false)
    expect(module.evaluateSheetGeometry({ ...valid, tabBarVisible: true }).passed).toBe(false)
    expect(module.evaluateSheetGeometry({ ...valid, expectedSectionOnly: false }).passed).toBe(false)
  })

  it('任何缺失状态或 passed=false 都拒绝整体验收', async () => {
    expect(existsSync(runnerPath)).toBe(true)
    if (!existsSync(runnerPath)) return
    const module = await import(`${pathToFileURL(runnerPath).href}?assert=${Date.now()}`) as {
      assertMp109SheetAcceptance(report: unknown): void
    }
    const passingStates = Object.fromEntries([
      'filterPrice',
      'filterAll',
      'inquiryWechat',
      'inquiryManual',
      'inquiryError',
      'inquirySubmitting',
      'inquirySuccess',
    ].map((name) => [name, { passed: true }]))

    expect(() => module.assertMp109SheetAcceptance({ status: 'passed', states: passingStates })).not.toThrow()
    expect(() => module.assertMp109SheetAcceptance({ status: 'passed', states: { ...passingStates, filterAll: { passed: false } } })).toThrow()
    const { inquirySuccess: _missing, ...missingState } = passingStates
    expect(() => module.assertMp109SheetAcceptance({ status: 'passed', states: missingState })).toThrow()
    expect(() => module.assertMp109SheetAcceptance({ status: 'environment-unavailable', states: {} })).toThrow()
  })
})
