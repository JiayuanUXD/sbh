import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const appJsonPath = resolve(projectRoot, 'miniprogram/app.json')
const assetsDir = resolve(projectRoot, 'miniprogram')

describe('小程序 TabBar 契约', () => {
  it('严格注册 5 个 Tab：首页、楼盘、搜楼、资讯、我的', () => {
    const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8')) as {
      pages: string[]
      tabBar: {
        list: Array<{
          pagePath: string
          text: string
          iconPath: string
          selectedIconPath: string
        }>
      }
    }

    expect(appJson.tabBar).toBeDefined()
    expect(appJson.tabBar.list).toHaveLength(5)

    const expectedTabs = [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/buildings/index', text: '楼盘' },
      { pagePath: 'pages/listings/index', text: '搜楼' },
      { pagePath: 'pages/news/index', text: '资讯' },
      { pagePath: 'pages/profile/index', text: '我的' },
    ]

    expectedTabs.forEach((tab, index) => {
      const current = appJson.tabBar.list[index]
      expect(current.pagePath).toBe(tab.pagePath)
      expect(current.text).toBe(tab.text)
    })

    // 页面路由中必须包含资讯列表页与资讯详情页
    expect(appJson.pages).toContain('pages/news/index')
    expect(appJson.pages).toContain('pages/news-detail/index')
  })

  it('5 个 Tab 的图标文件均在磁盘上真实存在', () => {
    const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8')) as {
      tabBar: {
        list: Array<{
          iconPath: string
          selectedIconPath: string
        }>
      }
    }

    appJson.tabBar.list.forEach((tab) => {
      const iconFile = resolve(assetsDir, tab.iconPath)
      const selectedIconFile = resolve(assetsDir, tab.selectedIconPath)
      expect(existsSync(iconFile), `缺少图标文件: ${tab.iconPath}`).toBe(true)
      expect(existsSync(selectedIconFile), `缺少选中图标文件: ${tab.selectedIconPath}`).toBe(true)
    })
  })
})
