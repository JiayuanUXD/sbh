import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * OPT-083：详情页参数配置的接线守卫。
 *
 * 守卫落在**失效点那一层**：registry、后台字段、读取层、隐藏规则各自都有单测，
 * 但没有一条能阻止「某个路由忘了把配置传下去」。那种漏接的症状是——运营在后台关掉
 * 一个字段，城市站生效、legacy 路由不生效（或反过来），两条路由对同一栋楼给出
 * 不同的参数清单。typecheck 不会红（prop 是可选的）、单测不会红（面板函数本身
 * 是对的）、页面不报错，只有人肉逐条路由点过去才会发现。
 *
 * 四条详情路由：
 *   - `(frontend)/[city]/buildings/[slug]` / `(frontend)/buildings/[slug]`
 *   - `(frontend)/[city]/listings/[slug]`  / `(frontend)/listings/[slug]`
 *
 * 用读源码断言而不是渲染：要守的是「这行代码在不在」，渲染反而绕远
 * （同 `tests/opt036-buildings-view-wiring.test.ts` 的取舍）。
 */

const APP = join(process.cwd(), 'src', 'app', '(frontend)')

function read(...segments: string[]): string {
  return readFileSync(join(APP, ...segments), 'utf8')
}

const BUILDING_ROUTES: ReadonlyArray<readonly [string, string[]]> = [
  ['城市站楼盘详情', ['[city]', 'buildings', '[slug]', 'page.tsx']],
  ['legacy 楼盘详情', ['buildings', '[slug]', 'page.tsx']],
]

const LISTING_ROUTES: ReadonlyArray<readonly [string, string[]]> = [
  ['城市站房源详情', ['[city]', 'listings', '[slug]', 'page.tsx']],
  ['legacy 房源详情', ['listings', '[slug]', 'page.tsx']],
]

describe('详情页参数配置接线守卫', () => {
  it.each(BUILDING_ROUTES)('%s 把楼盘侧配置传给了视图', (_name, segments) => {
    const source = read(...segments)
    expect(source).toContain('getCachedSiteSettings')
    expect(source).toContain('specVisibility={siteSettings.detailSpecFields.building}')
  })

  it.each(LISTING_ROUTES)('%s 把房源侧配置传给了视图', (_name, segments) => {
    const source = read(...segments)
    expect(source).toContain('getCachedSiteSettings')
    expect(source).toContain('specVisibility={siteSettings.detailSpecFields.listing}')
  })

  it('楼盘视图把配置转交给面板，且用它判断整段渲不渲染', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'components', 'frontend', 'building-detail', 'BuildingDetailLayout.tsx'),
      'utf8',
    )
    // 转交给面板
    expect(source).toContain('visibility={specVisibility}')
    // 「有没有参数」的判据必须建立在**过滤后**的结果上。写成
    // `buildBuildingSpecGroups(specInput, minLeasableArea)`（漏掉第三个参数）
    // 会让运营关光字段后仍判 true，页面留一张空白面板。
    expect(source).toContain('buildBuildingSpecGroups(specInput, minLeasableArea, specVisibility)')
    expect(source).toContain('const hasSpecValues = specGroups.length > 0')
  })

  it('房源视图整块受控：分组为空时连 h2 一起不渲染', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'components', 'frontend', 'city', 'CityListingDetailView.tsx'),
      'utf8',
    )
    expect(source).toContain('buildListingOverviewGroups(listing, specVisibility)')
    expect(source).toContain('overviewGroups.length > 0 &&')
    // 面板接收算好的分组，避免「判断用的那份」与「渲染用的那份」分叉
    expect(source).toContain('<ListingOverviewPanel groups={overviewGroups} />')
  })
})
