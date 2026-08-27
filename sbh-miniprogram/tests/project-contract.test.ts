import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const miniprogramRoot = resolve(projectRoot, 'miniprogram')
const entryFiles = ['app.ts', 'app.json', 'app.wxss', 'sitemap.json']
const routeExtensions = ['ts', 'json', 'wxml', 'wxss']

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(resolve(projectRoot, relativePath), 'utf8')) as Record<string, unknown>
}

function checkIgnored(candidatePath: string): string {
  return execFileSync('git', ['check-ignore', '--no-index', '--verbose', '--', candidatePath], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
}

function requirePages(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((route): route is string => typeof route === 'string')) {
    throw new Error('app.json 的 pages 必须是字符串数组')
  }

  return value
}

describe('小程序工程入口合同', () => {
  it('从 miniprogram 目录以 TypeScript 模式打开', () => {
    const project = readJson('project.config.json')

    expect(project.miniprogramRoot).toBe('miniprogram/')
    expect(project.compileType).toBe('miniprogram')
    expect(project.appid).toBe('touristappid')
    expect(project.setting).toMatchObject({
      useCompilerPlugins: ['typescript'],
    })
  })

  it('以首页为首路由并只注册已交付的两项 tab', () => {
    const app = readJson('miniprogram/app.json')
    const pages = requirePages(app.pages)
    const tabBar = app.tabBar as
      | { list?: Array<{ pagePath?: unknown }> }
      | undefined

    expect(pages[0]).toBe('pages/home/index')
    expect(pages).toContain('pages/listings/index')
    expect(pages).toContain('pages/listing-detail/index')
    expect(pages).toContain('pages/foundation/index')
    expect(tabBar?.list?.map((item) => item.pagePath)).toEqual([
      'pages/home/index',
      'pages/listings/index',
    ])
    expect(app.tabBar).toMatchObject({
      color: '#6e6e73',
      selectedColor: '#1d1d1f',
      backgroundColor: '#ffffff',
      borderStyle: 'black',
      list: [
        { pagePath: 'pages/home/index', text: '首页' },
        { pagePath: 'pages/listings/index', text: '找房' },
      ],
    })
  })

  it('锁定与 jsdom 和 Vite 兼容的 Node 版本边界', () => {
    const packageJson = readJson('package.json')

    expect(packageJson.engines).toEqual({ node: '>=22.12 <23' })
  })

  it('通过设计 token 使用完成稿的页面与基础状态颜色', () => {
    const app = readJson('miniprogram/app.json')
    const appStyles = readFileSync(resolve(miniprogramRoot, 'app.wxss'), 'utf8')
    const tokens = readFileSync(resolve(miniprogramRoot, 'styles/tokens.wxss'), 'utf8')
    const foundationStyles = readFileSync(resolve(miniprogramRoot, 'pages/foundation/index.wxss'), 'utf8')

    expect(app.window).toMatchObject({ backgroundColor: '#f2f2f4' })
    expect(appStyles).toContain('@import "./styles/tokens.wxss";')
    expect(appStyles).toMatch(/color:\s*var\(--sbh-text-primary\);/)
    expect(tokens).toContain('--sbh-color-gray-950: #1d1d1f;')
    expect(tokens).toContain('--sbh-color-gray-700: #6e6e73;')
    expect(tokens).toContain('--sbh-text-primary: var(--sbh-color-gray-950);')
    expect(tokens).toContain('--sbh-text-secondary: var(--sbh-color-gray-700);')
    expect(foundationStyles).toMatch(/\.foundation-status\s*\{[\s\S]*?color:\s*var\(--sbh-text-secondary\);/)
  })

  it('保留全部基础入口与 foundation 页面四件套', () => {
    for (const entryFile of entryFiles) {
      expect(existsSync(resolve(miniprogramRoot, entryFile))).toBe(true)
    }

    for (const extension of routeExtensions) {
      expect(existsSync(resolve(miniprogramRoot, `pages/foundation/index.${extension}`))).toBe(true)
    }
  })

  it('为 app.json 中的每个页面路由提供四种入口文件', () => {
    const app = readJson('miniprogram/app.json')
    const pages = requirePages(app.pages)

    expect(pages.length).toBeGreaterThan(0)
    for (const route of pages) {
      for (const extension of routeExtensions) {
        expect(existsSync(resolve(miniprogramRoot, `${route}.${extension}`))).toBe(true)
      }
    }
  })

  it('为首页、找房和可信详情态提供自动化就绪标记', () => {
    const homeMarkup = readFileSync(resolve(miniprogramRoot, 'pages/home/index.wxml'), 'utf8')
    const listingsMarkup = readFileSync(
      resolve(miniprogramRoot, 'pages/listings/index.wxml'),
      'utf8',
    )
    const detailMarkup = readFileSync(
      resolve(miniprogramRoot, 'pages/listing-detail/index.wxml'),
      'utf8',
    )

    expect(homeMarkup).toContain('id="home-ready"')
    expect(listingsMarkup).toContain('id="listings-ready"')
    expect(detailMarkup).toMatch(
      /wx:if="\{\{state === 'ready' \|\| state === 'stale'\}\}"\s+id="listing-detail-ready"/,
    )
  })

  it('以空 App 配置作为当前阶段的最小入口', () => {
    expect(readFileSync(resolve(miniprogramRoot, 'app.ts'), 'utf8').trim()).toBe('App({})')
  })

  it('通过真实 Git 忽略规则保护本机私有配置和私钥', () => {
    const candidates = [
      'project.private.config.json',
      'keys/upload.key',
      'keys/release.pem',
      'keys/cert.p12',
    ]

    for (const candidate of candidates) {
      expect(checkIgnored(candidate)).toContain(candidate)
    }
  })
})
