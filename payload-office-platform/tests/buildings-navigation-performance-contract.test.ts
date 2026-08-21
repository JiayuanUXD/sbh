import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')

describe('OPT-025 楼盘列表导航性能合同', () => {
  // 未筛选版 getCachedSearchBuildingsByCity/getCachedSearchBuildings 曾在此处
  // 单独锁定缓存契约，已随该函数在 OPT-036 Task 13 从 cached-queries.ts 删除
  // （无生产调用方，楼盘列表页自 Task 12 起全部走下面这条 Filtered 版本）。

  it('楼盘筛选缓存同样固定键、依赖楼盘与 facets，并设置 300 秒重新验证阈值', async () => {
    const source = await readFile(
      resolve(ROOT, 'src/lib/frontend/cached-queries.ts'),
      'utf8',
    )
    const wrapper = source.match(
      /const getCachedSearchBuildingsFilteredByCity = memoizeByCity\([\s\S]*?\n\)\n/,
    )?.[0]

    expect(wrapper).toBeDefined()
    expect(wrapper).toContain('searchBuildingsFiltered(input, createSearchContext(citySlug))')
    expect(wrapper).toContain("['search-buildings-filtered', citySlug]")
    expect(wrapper).toContain('buildingCacheTags(citySlug)')
    expect(wrapper).toMatch(/revalidate:\s*300/)
  })

  it('楼盘列表页面使用缓存查询且不直接创建搜索上下文', async () => {
    // OPT-036 Task 12：筛选/排序/分页下沉到查询层后，这一页改走 Filtered 版本；
    // 断言的意图不变——页面只调缓存包装器，绝不自己 createSearchContext / 调域层。
    for (const route of ['src/app/(frontend)/buildings/page.tsx', 'src/app/(frontend)/[city]/buildings/page.tsx']) {
      const source = await readFile(resolve(ROOT, route), 'utf8')

      expect(source).toContain("import { getCachedSearchBuildingsFiltered } from '@/lib/frontend/cached-queries'")
      expect(source).toContain('await getCachedSearchBuildingsFiltered(city.slug, input)')
      expect(source).not.toContain('defaultSearchContext')
      expect(source).not.toContain('createSearchContext')
      // 视图层不再收原始 searchParams 自己过滤：路由必须先解析成 BuildingSearchInput
      expect(source).toContain('parseBuildingSearchInput(')
      expect(source).not.toMatch(/\bsearchBuildingsFiltered\s*\(/)
    }
  })
})
