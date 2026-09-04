/**
 * OPT-068 根路径直出的结构契约。
 *
 * `/` 在多城市模式下原先 307 到 `/shanghai`：搜索引擎与收藏夹最常见的入口白等一个
 * 往返（线上实测 0.16–0.70 秒）。现在直出，canonical 仍指向 `/shanghai`。
 *
 * 三条守卫：
 *   1. 多城市分支不再 redirect；
 *   2. 两条首页路由的渲染只有一处定义（`_lib/city-home.tsx`）——重复一份必然漂移；
 *   3. `/listings` `/buildings` 这类旧路径**仍然**重定向（它们不是入口，收敛 URL 更重要）。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string) => readFile(resolve(ROOT, rel), 'utf8')

describe('OPT-068 根路径直出', () => {
  it('根路径多城市分支直接渲染，不再 redirect', async () => {
    const page = await read('src/app/(frontend)/page.tsx')
    expect(page).toContain('renderCityHomeRoute(city)')
    expect(page).not.toContain("from 'next/navigation'\nimport { redirect }")
    expect(page).not.toMatch(/redirect\(/)
    expect(page).not.toContain('prefixedCanonicalPath')
  })

  it('根路径 Metadata 在多城市模式下走城市口径（canonical 落 /<city>）', async () => {
    const page = await read('src/app/(frontend)/page.tsx')
    expect(page).toContain('export async function generateMetadata()')
    expect(page).toContain('cityHomeMetadata(city)')
    // 关闭多城市路由时保留原根页文案
    expect(page).toContain("canonicalPath: '/'")
  })

  it('两条首页路由共用同一处渲染定义', async () => {
    const cityPage = await read('src/app/(frontend)/[city]/page.tsx')
    expect(cityPage).toContain('renderCityHomeRoute(city)')
    expect(cityPage).toContain('cityHomeMetadata(city)')
    // 渲染细节不得在路由里重新写一份
    expect(cityPage).not.toContain('<CityHomeView')
    expect(cityPage).not.toContain('<ComingSoonCityView')
  })

  it('旧列表路径仍然重定向到城市前缀（只有根路径改成直出）', async () => {
    for (const route of ['src/app/(frontend)/listings/page.tsx', 'src/app/(frontend)/buildings/page.tsx']) {
      const source = await read(route)
      expect(source, route).toContain('redirect(destination)')
    }
  })
})
