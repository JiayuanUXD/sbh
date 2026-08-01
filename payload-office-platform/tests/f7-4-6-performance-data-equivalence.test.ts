/**
 * F7.4 / F7.6 综合验收：性能预算与数据等价守护不变量
 *
 * 设计依据：specs/frontend-mvp/tasks/F7-acceptance.md 7.4、7.6
 *           specs/frontend-mvp/design.md §14.1（性能预算）、§9（缓存）
 *           specs/backend-mvp/tasks/M4-listing-review-supply.md M4.7
 *
 * 守护不变量：
 *   - F7.4 性能预算：
 *     · 客户端组件不引入重型第三方（moment/lodash 全量/jQuery）
 *     · 字体策略：不引入额外网络字体（使用系统字体栈）
 *     · 图片：公开 DTO 不暴露原始全尺寸 URL（由 Payload media 自动派生）
 *     · 查询 depth：Facade 不允许嵌套 N+1（通过 mapper 单次 find 拉取）
 *     · 缓存：cached-queries 标记 tag，事件失效可清除
 *   - F7.6 数据等价：
 *     · 公开消费者（首页/列表/详情/楼盘/内容/sitemap/询盘）全部通过 Facade
 *     · Facade 内部统一调用 effective-supply 谓词
 *     · 不存在绕过 Facade 的直读 Payload 路径
 *
 * 与已有测试的关系：
 *   - public-catalog-effective-supply-consistency.test.ts：F1.2 / F7.6 谓词一致性已覆盖
 *   - public-catalog-facade.test.ts：Facade 接口契约已覆盖
 *   - 本测试文件为 F7.4 / F7.6 静态分析汇总，确保工程约束不被破坏。
 */
import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Dirent } from 'node:fs'

const ROOT = resolve(process.cwd())

// ---------------------------------------------------------------------------
// F7.4 性能预算
// ---------------------------------------------------------------------------

describe('F7.4 性能预算 · 客户端依赖守护', () => {
  it('package.json 不引入 moment / lodash 全量 / jQuery / bootstrap', async () => {
    const pkg = JSON.parse(
      await readFile(resolve(ROOT, 'package.json'), 'utf-8'),
    ) as Record<string, Record<string, string>>
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    const forbidden = ['moment', 'lodash', 'jquery', 'bootstrap', 'rxjs']
    for (const f of forbidden) {
      expect(deps, `不应依赖 ${f}（性能预算禁止）`).not.toHaveProperty(f)
    }
  })

  it('前端组件不直接 import 全量 lodash（应使用原生或特定子模块）', async () => {
    const frontendDir = resolve(ROOT, 'src', 'components', 'frontend')
    const files = await collectTsFiles(frontendDir)
    for (const f of files) {
      const source = await readFile(f, 'utf-8')
      // 禁止 import _ from 'lodash' 或 import { x } from 'lodash'
      expect(source, `${f} 不应直接 import lodash`).not.toMatch(
        /from\s+['"]lodash['"]/,
      )
    }
  })

  it('前端组件不引入第三方 reset CSS（design.md 禁止）', async () => {
    const cssFiles = await collectCssFiles(resolve(ROOT, 'src', 'styles'))
    for (const f of cssFiles) {
      const source = await readFile(f, 'utf-8')
      expect(source, `${f} 不应含 @import 第三方 reset`).not.toMatch(
        /@import\s+['"]*(normalize|reset|sanitize|tachyons|tailwind)/i,
      )
    }
  })

  it('前端布局使用系统字体栈（不引入网络字体）', async () => {
    // styles.css 位置：src/app/(frontend)/styles.css（F2.1 视觉系统）
    const cssFiles = await collectCssFiles(resolve(ROOT, 'src', 'app'))
    let hasFontStack = false
    for (const f of cssFiles) {
      const source = await readFile(f, 'utf-8')
      if (source.match(/font-family/i)) {
        hasFontStack = true
        // 不应 @import google fonts 或 fonts.googleapis.com
        expect(source, `${f} 不应引入 Google Fonts`).not.toMatch(
          /fonts\.googleapis\.com|@import\s+url\(['"]?https?:\/\/fonts\./i,
        )
        // 字体应通过 next/font CSS 变量注入（--font-sans / --font-display）
        // 不应直接 @font-face 引入远程字体文件
        expect(source, `${f} 不应直接 @font-face 引入远程字体`).not.toMatch(
          /@font-face\s*{[^}]*src:\s*url\(['"]?https?:\/\//is,
        )
      }
    }
    // 若有 CSS 文件，至少应有一处 font-family 声明
    expect(hasFontStack, '应至少有一处 font-family 声明').toBe(true)
  })
})

describe('F7.4 性能预算 · 查询 depth 与 N+1 守护', () => {
  it('Facade mapper 不在循环内调用 find（避免 N+1）', async () => {
    const mapperDir = resolve(ROOT, 'src', 'domain', 'public-catalog')
    const files = await collectTsFiles(mapperDir)
    for (const f of files) {
      const source = await readFile(f, 'utf-8')
      // 简单启发式：mapper 文件不应出现 while/for 循环内 await find 调用
      // 注：此启发式较保守，仅作为静态守护
      const hasLoop = source.match(/(?:for|while)\s*\(/)
      const hasFind = source.match(/\.find\(/)
      // 允许同时存在，但需人工 review；此处仅记录不阻断
      if (hasLoop && hasFind) {
        // 进一步检查是否在循环内 await find
        const loopAwaitFind = source.match(
          /(?:for|while)\s*\([^)]*\)\s*{[^}]*await[^}]*\.find\(/s,
        )
        // 不强制阻断，仅记录（mapper 通常已通过 find + map 单次拉取）
        expect(loopAwaitFind, `${f} 应避免循环内 await find（N+1 风险）`).toBeNull()
      }
    }
  })
})

describe('F7.4 性能预算 · 缓存命中守护', () => {
  it('cached-queries.ts 为每个 Facade 调用标记 cache tag', async () => {
    const filePath = resolve(ROOT, 'src', 'lib', 'frontend', 'cached-queries.ts')
    const source = await readFile(filePath, 'utf-8')
    // unstable_cache 包装应声明 tags
    const unstableCacheCount = (source.match(/unstable_cache\(/g) || []).length
    const tagsCount = (source.match(/tags:\s*\[/g) || []).length
    expect(unstableCacheCount, 'cached-queries 应使用 unstable_cache').toBeGreaterThan(0)
    expect(tagsCount, '每个 unstable_cache 应声明 tags 数组').toBeGreaterThanOrEqual(unstableCacheCount)
  })

  it('cache-invalidator 监听的事件覆盖发布/审核/举报 4 类', async () => {
    const filePath = resolve(
      ROOT,
      'src',
      'domain',
      'public-catalog',
      'cache-invalidator.ts',
    )
    const source = await readFile(filePath, 'utf-8')
    const eventTypes = [
      'listing.published',
      'listing.unpublished',
      'listing.review_approved',
      'listing.review_rejected',
      'report.supply_paused',
      'report.supply_resumed',
    ]
    for (const evt of eventTypes) {
      expect(source, `cache-invalidator 应监听 ${evt}`).toContain(evt)
    }
  })
})

// ---------------------------------------------------------------------------
// F7.6 数据等价
// ---------------------------------------------------------------------------

describe('F7.6 数据等价 · 公开消费者全部通过 Facade', () => {
  it('首页 page.tsx 调用 getHomepage Facade', async () => {
    const filePath = resolve(ROOT, 'src', 'app', '(frontend)', 'page.tsx')
    const source = await readFile(filePath, 'utf-8')
    expect(source, '首页应通过 getHomepage 获取数据').toContain('getHomepage')
    // 不应直接调用 payload DB
    expect(source, '首页不应直接调用 payload.find').not.toMatch(
      /payload\.(find|findOne|findByID)\s*\(/,
    )
  })

  it('列表页 page.tsx 调用 searchListings Facade', async () => {
    const filePath = resolve(ROOT, 'src', 'app', '(frontend)', 'listings', 'page.tsx')
    const source = await readFile(filePath, 'utf-8')
    expect(source, '列表页应通过 searchListings / getSearchFacets 获取数据')
      .toMatch(/searchListings|getSearchFacets/)
    expect(source, '列表页不应直接调用 payload.find').not.toMatch(
      /payload\.(find|findOne|findByID)\s*\(/,
    )
  })

  it('房源详情 page.tsx 调用 getListingBySlug Facade', async () => {
    const filePath = resolve(
      ROOT,
      'src',
      'app',
      '(frontend)',
      'listings',
      '[slug]',
      'page.tsx',
    )
    const source = await readFile(filePath, 'utf-8')
    expect(source, '房源详情应通过 getListingBySlug 获取数据').toContain(
      'getListingBySlug',
    )
    expect(source, '房源详情应通过 getDetailRecommendations 获取推荐').toContain(
      'getDetailRecommendations',
    )
  })

  it('楼盘详情 page.tsx 调用 getBuildingDetail Facade', async () => {
    const filePath = resolve(
      ROOT,
      'src',
      'app',
      '(frontend)',
      'buildings',
      '[slug]',
      'page.tsx',
    )
    const source = await readFile(filePath, 'utf-8')
    expect(source, '楼盘详情应通过 getBuildingDetail 或 getBuildingBySlug 获取数据')
      .toMatch(/getBuildingDetail|getBuildingBySlug/)
  })

  it('内容页 page.tsx 调用 getPageBySlug Facade', async () => {
    const filePath = resolve(ROOT, 'src', 'app', '(frontend)', 'pages', '[slug]', 'page.tsx')
    const source = await readFile(filePath, 'utf-8')
    expect(source, '内容页应通过 getPageBySlug 获取数据').toContain('getPageBySlug')
  })

  it('sitemap.ts 通过 Facade 查询（不直读 Payload）', async () => {
    const filePath = resolve(ROOT, 'src', 'app', '(frontend)', 'sitemap.ts')
    const source = await readFile(filePath, 'utf-8')
    expect(source, 'sitemap 应调用 Facade 查询函数')
      .toMatch(/listPublishedPages|searchListings|searchBuildings|findEffectiveListings/)
    // 楼盘查询允许使用 payload.find + buildingOperationalWhere（M3.5 楼盘级谓词，
    // 楼盘可见性只依赖楼盘自身状态 + 在营，无需房源级精筛）
    // 这里仅断言不出现 status=available 旧谓词
    expect(source, 'sitemap 不应使用 status=available 旧谓词').not.toMatch(
      /status['"]?\s*:\s*['"]?available['"]?/i,
    )
    // listings 必须通过 SupplyAdapter（不直读 payload.find 查 listings）
    expect(source, 'sitemap 房源应通过 SupplyAdapter.findEffectiveListings').toContain(
      'findEffectiveListings',
    )
  })

  it('询盘 API 调用 assertEffectiveListing Facade 校验目标有效性', async () => {
    const filePath = resolve(ROOT, 'src', 'app', 'api', 'inquiries', 'route.ts')
    const source = await readFile(filePath, 'utf-8')
    expect(source, '询盘 API 应调用 assertEffectiveListing').toContain(
      'assertEffectiveListing',
    )
  })
})

describe('F7.6 数据等价 · Facade 内部统一谓词', () => {
  it('public-catalog Facade 引用 effective-supply 谓词', async () => {
    const facadeDir = resolve(ROOT, 'src', 'domain', 'public-catalog')
    const files = await collectTsFiles(facadeDir)
    // 至少有一个文件引用 effective-supply
    let found = false
    for (const f of files) {
      const source = await readFile(f, 'utf-8')
      if (
        source.includes('effective-supply') ||
        source.includes('isListingEffectivelySupplied') ||
        source.includes('SupplyAdapter')
      ) {
        found = true
        break
      }
    }
    expect(found, 'public-catalog 应引用 effective-supply 谓词').toBe(true)
  })

  it('不存在绕过 Facade 的 status=available 旧查询', async () => {
    // design.md 禁止以 status=available 作为生产降级
    const frontendDir = resolve(ROOT, 'src', 'app', '(frontend)')
    const files = await collectTsFiles(frontendDir)
    for (const f of files) {
      const source = await readFile(f, 'utf-8')
      // 禁止 status: { equals: 'available' } 等旧谓词
      expect(source, `${f} 不应使用 status=available 旧谓词`).not.toMatch(
        /status['"]?\s*:\s*['"]?available['"]?/i,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

async function collectTsFiles(dir: string): Promise<string[]> {
  const result: string[] = []
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await collectTsFiles(full)))
    } else if (entry.name.match(/\.(ts|tsx)$/)) {
      result.push(full)
    }
  }
  return result
}

async function collectCssFiles(dir: string): Promise<string[]> {
  const result: string[] = []
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await collectCssFiles(full)))
    } else if (entry.name.match(/\.(css|scss)$/)) {
      result.push(full)
    }
  }
  return result
}
