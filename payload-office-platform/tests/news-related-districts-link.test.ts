import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 资讯详情页「相关商圈」链接（OPT-119）。页面依赖 payload，不在单测里整页渲染，这里锁源码契约；
// 真实渲染由浏览器验收覆盖（artifacts/verification/OPT-119/）。
describe('资讯详情页的相关商圈链接', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/(frontend)/news/[slug]/page.tsx'), 'utf8')

  it('指向区域落地页，而不是对商圈无效的 ?district= 筛选', () => {
    expect(source).toContain('areaLandingPath(siteConfig.defaultCity, d.slug)')
    expect(source).not.toMatch(/\?district=/)
  })
})
