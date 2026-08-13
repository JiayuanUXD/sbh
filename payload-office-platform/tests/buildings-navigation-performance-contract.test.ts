import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')

describe('OPT-025 楼盘列表导航性能合同', () => {
  it('楼盘搜索缓存使用固定键、依赖楼盘与房源，并设置 300 秒重新验证阈值', async () => {
    const source = await readFile(
      resolve(ROOT, 'src/lib/frontend/cached-queries.ts'),
      'utf8',
    )
    const wrapper = source.match(
      /const getCachedSearchBuildingsByCity = memoizeByCity\([\s\S]*?\n\)/,
    )?.[0]

    expect(wrapper).toBeDefined()
    expect(wrapper).toContain('searchBuildings(createSearchContext(citySlug))')
    expect(wrapper).toContain("['search-buildings', citySlug]")
    expect(wrapper).toContain('mixedSupplyCacheTags(citySlug)')
    expect(wrapper).toMatch(/revalidate:\s*300/)
  })

  it('楼盘列表页面使用缓存查询且不直接创建搜索上下文', async () => {
    const source = await readFile(
      resolve(ROOT, 'src/app/(frontend)/buildings/page.tsx'),
      'utf8',
    )

    expect(source).toContain("import { getCachedSearchBuildings } from '@/lib/frontend/cached-queries'")
    expect(source).toContain('await getCachedSearchBuildings(city.slug)')
    expect(source).not.toContain('defaultSearchContext')
    expect(source).not.toMatch(/\bsearchBuildings\s*\(/)
  })
})
