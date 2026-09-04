/**
 * OPT-068 详情页推荐流式输出的结构契约。
 *
 * 这三条锁的都是「首屏不等推荐」这一条性质本身，不是文案：
 *   1. 两条详情路由都**不 await** 推荐（写成 await 就把首字节推迟到推荐算完）；
 *   2. 视图把推荐渲染在 `<Suspense>` 里，并给出骨架 fallback；
 *   3. 缓存层的推荐回调注入的是**已缓存的整城扫描**，不是各自再查一遍库。
 *
 * 用源码断言而不是渲染断言：Suspense 的流式行为在 vitest 的同步渲染里量不到，
 * 真正的可用性证据在浏览器走查（artifacts/verification/OPT-068/）。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string) => readFile(resolve(ROOT, rel), 'utf8')

const ROUTES = [
  'src/app/(frontend)/[city]/listings/[slug]/page.tsx',
  'src/app/(frontend)/listings/[slug]/page.tsx',
] as const

describe('OPT-068 详情页推荐流式输出', () => {
  it('两条详情路由都不 await 推荐，而是把 Promise 传给视图', async () => {
    for (const route of ROUTES) {
      const source = await read(route)
      expect(source, `${route} 应保留推荐取数`).toContain('getCachedDetailRecommendations(')
      expect(source, `${route} 不得 await 推荐`).not.toMatch(/await[^\n]*getCachedDetailRecommendations\(/)
      expect(source, `${route} 推荐不得进 Promise.all（等价于 await）`).not.toMatch(
        /Promise\.all\(\[[^\]]*getCachedDetailRecommendations\(/s,
      )
      expect(source, `${route} 应把推荐作为 prop 传下去`).toMatch(/recommendations=\{recommendations\}/)
    }
  })

  it('详情视图把推荐放在 Suspense 内并给骨架 fallback', async () => {
    const view = await read('src/components/frontend/city/CityListingDetailView.tsx')
    expect(view).toContain('<React.Suspense fallback={<RelatedListingsSkeleton />}>')
    expect(view).toContain('<RelatedListings recommendations={recommendations}')
    // 视图不得自己 await 推荐（那样 Suspense 边界就形同虚设）
    expect(view).not.toMatch(/await\s+recommendations/)
  })

  it('推荐区零条时整段消失（不留空标题）', async () => {
    const section = await read('src/components/frontend/detail/RelatedListings.tsx')
    expect(section).toContain('if (items.length === 0) return null')
    expect(section).toContain('id="related"')
  })

  it('缓存层给推荐注入已缓存的整城扫描', async () => {
    const cached = await read('src/lib/frontend/cached-queries.ts')
    expect(cached).toMatch(/scan: \(input\) => getCachedListingScan\(citySlug, input, 'all'\)/)
  })
})
