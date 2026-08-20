/**
 * sitemap 房源专用查询的接线契约（源码级断言）
 *
 * 背景（OPT-031）：/sitemap.xml 线上 70 秒无响应，且超时导致 unstable_cache 永远写不
 * 进去、下次仍然是冷的——死循环，所以是 100% 坏而非偶尔慢。根因是 sitemap 走了完整搜索
 * 管线：每套房源 depth 2 水合楼盘/城市/行政区/商圈/地铁/媒体/经纪人，再映射成展示卡片，
 * 而 sitemap 只要 slug 和 lastmod。
 *
 * 这里锁三件真跑不出来的事（跑真实查询要连库）：
 *   - sitemap 不再经过搜索管线
 *   - select 字段清单与 buildEffectiveSnapshot 的需求对齐（少一个字段就静默改变有效
 *     供给口径，多一个就是白付钱）
 *   - 精筛没有被绕开——sitemap 输出的 URL 必须逐条可达
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (p: string) => readFile(resolve(ROOT, p), 'utf8')

/** 取 findEffectiveListingsSitemapPage 的实现正文 */
async function sitemapQueryBody(): Promise<string> {
  const src = await read('src/domain/public-catalog/supply-adapter.ts')
  const start = src.indexOf('async findEffectiveListingsSitemapPage(')
  expect(start, '未找到 sitemap 专用查询实现').toBeGreaterThan(-1)
  const rest = src.slice(start)
  // 到下一个适配器方法为止
  const end = rest.indexOf('\n    async ', 1)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('sitemap-listings-query/不再走搜索管线', () => {
  it('sitemap.ts 使用专用查询，不再调 getCachedSearchListings', async () => {
    const src = await read('src/app/(frontend)/sitemap.ts')
    expect(src).toContain('getCachedSitemapListingsPage')
    // 判「调用」而不是「出现」：文件里的注释要解释为什么不再用搜索管线，
    // 直接 not.toContain 会被自己的注释绊倒（这个坑本轮已踩三次）。
    expect(src).not.toMatch(/getCachedSearchListings\s*\(/)
    expect(src).not.toMatch(/^\s*getCachedSearchListings,/m)
  })

  it('房源 lastmod 用真实 updatedAt，不再统一填 now', async () => {
    const src = await read('src/app/(frontend)/sitemap.ts')
    // 每条 URL 都写「刚刚更新」等于没给爬虫任何信息
    expect(src).toContain('listing.updatedAt ? new Date(listing.updatedAt) : now')
  })
})

describe('sitemap-listings-query/成本约束', () => {
  it('用 depth 1 而不是 depth 2', async () => {
    const body = await sitemapQueryBody()
    expect(body).toContain('depth: 1')
    expect(body).not.toContain('depth: 2')
  })

  it('select 只取输出与精筛需要的字段，不多不少', async () => {
    const body = await sitemapQueryBody()
    const selectBlock = /select:\s*\{([\s\S]*?)\}/.exec(body)?.[1] ?? ''
    const fields = [...selectBlock.matchAll(/(\w+):\s*true/g)].map((m) => m[1]).sort()

    // 输出用 slug/updatedAt/businessType；精筛用 building（取 city id）与
    // merchant（OPT-034 起 buildEffectiveSnapshot 直接读 listing.merchant，
    // 不再经 listing-merchant-relations 关系表）。这份清单必须与
    // buildEffectiveSnapshot 读的字段一致——它读 listing.building.city 与
    // listing.merchant，少一个精筛口径就变了（漏选 merchant 的真实后果：
    // merchant 恒为 undefined，精筛恒判 NO_SUPPLY_MERCHANT，sitemap 恒空）。
    // gallery 已于 2026-08-19 移出：媒体数量不再参与前台可见性判定。
    expect(fields).toEqual(['building', 'businessType', 'merchant', 'slug', 'updatedAt'])
  })
})

describe('sitemap-listings-query/口径不打折', () => {
  it('仍然走 fineFilter，没有绕开精筛', async () => {
    const body = await sitemapQueryBody()
    // 绕开精筛会输出一批实际不可见的 URL（详情页 404），是另一种 SEO 伤害
    expect(body).toContain('fineFilter(')
  })

  it('精筛快照读的字段确实是 building.city（select 清单的依据）', async () => {
    const src = await read('src/domain/review/effective-supply-snapshot.ts')
    expect(src).toContain('listing.building')
    expect(src).toContain('toId(building.city)')
    // 2026-08-19：媒体数量移出前台可见性，快照不再读 gallery，
    // sitemap 查询的 select 清单也该跟着去掉它（否则就是白付钱）。
    expect(src).not.toContain('listing.gallery')
    expect(await sitemapQueryBody()).not.toContain('gallery: true')
  })
})
