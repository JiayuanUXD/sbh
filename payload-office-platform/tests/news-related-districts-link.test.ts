import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 资讯详情页「相关商圈」链接（OPT-119）。页面依赖 payload，不在单测里整页渲染，这里锁源码契约；
// 真实渲染由浏览器验收覆盖（artifacts/verification/OPT-119/）。
describe('资讯详情页的相关商圈链接', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/(frontend)/news/[slug]/page.tsx'), 'utf8')

  it('指向区域落地页，而不是对商圈无效的 ?district= 筛选', () => {
    expect(source).toContain('areaLandingPath(d.citySlug, d.slug)')
    expect(source).not.toMatch(/\?district=/)
  })
})

// Codex 评审（PR #230）：链接城市不能固定默认城市。后台没有限制 Articles.relatedDistricts 的城市，
// 关联到非默认城市区域时固定默认城市会 404。这里锁住 DTO 的 citySlug 语义与页面的降级。
describe('资讯相关区域的所属城市', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/(frontend)/news/[slug]/page.tsx'), 'utf8')

  it('页面不再把默认城市写进相关区域链接，城市缺失时只显示名称', () => {
    expect(source).not.toContain('areaLandingPath(siteConfig.defaultCity')
    expect(source).toMatch(/d\.citySlug \?/)
  })
})
