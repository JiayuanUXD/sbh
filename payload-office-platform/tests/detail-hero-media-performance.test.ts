import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

describe('OPT-028 detail caching and hero media contracts', () => {
  it('exposes cached detail recommendation wrappers', async () => {
    const cachedQueries = await readFile(resolve(ROOT, 'src/lib/frontend/cached-queries.ts'), 'utf8')

    expect(cachedQueries).toContain('getCachedDetailRecommendations')
    expect(cachedQueries).toContain('getCachedRelatedBuildings')
    expect(cachedQueries).toMatch(
      /const getCachedDetailRecommendationsByCity = memoizeByCity\([\s\S]*?revalidate:\s*300[\s\S]*?\n\)/,
    )
  })

  it('uses cached slug data and parallel detail secondary work on listing detail pages', async () => {
    const page = await readFile(resolve(ROOT, 'src/app/(frontend)/listings/[slug]/page.tsx'), 'utf8')

    expect(page).toContain('getCachedListingBySlug(siteConfig.defaultCity, slug)')
    expect(page).toContain('getCachedBuildingBySlug(city.slug, building.slug)')
    expect(page).toContain('getCachedDetailRecommendations(city.slug, slug, 6)')
    expect(page).toMatch(/Promise\.all\(\[[\s\S]*getCachedBuildingBySlug\(city\.slug, building\.slug\)[\s\S]*getCachedDetailRecommendations\(city\.slug, slug, 6\)[\s\S]*fetchNearbyPois/)
  })

  it('uses cached related buildings on building detail pages', async () => {
    const page = await readFile(resolve(ROOT, 'src/app/(frontend)/buildings/[slug]/page.tsx'), 'utf8')

    expect(page).toContain('getCachedRelatedBuildings(siteConfig.defaultCity, slug)')
    expect(page).not.toContain('getRelatedBuildings(slug, ctx)')
  })

  it('loads the homepage hero video only after client-side capability checks', async () => {
    const [homePage, homeHero, heroVideo] = await Promise.all([
      readFile(resolve(ROOT, 'src/app/(frontend)/page.tsx'), 'utf8'),
      // OPT-035 Task 9：CityHomeView 重组为编排层，<HomeHeroMedia> 的调用点
      // 随首页改版下沉到 HomeHero.tsx（Task 5 产物），CityHomeView 自身不再直接引用。
      readFile(resolve(ROOT, 'src/components/frontend/home/HomeHero.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/HomeHeroMedia.tsx'), 'utf8'),
    ])

    expect(homePage).toContain('<CityHomeView')
    expect(homeHero).toContain('<HomeHeroMedia poster={routeMode === \'prefixed\' ? city.profile.hero.media : null} />')
    expect(homePage).not.toContain('<video autoPlay')
    // poster 走 next 构建产物而非 public/（平台在线构建曾剥离 public 二进制致 404）
    expect(heroVideo).toContain("from '@/lib/frontend/hero-poster'")
    expect(heroVideo).toContain('poster={HERO_POSTER_SRC}')
    expect(heroVideo).not.toContain('/hero/poster.jpg')
    expect(heroVideo).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(heroVideo).toContain("matchMedia('(max-width: 767px)')")
    expect(heroVideo).toContain('connection?.saveData')
    expect(heroVideo).toContain('requestIdleCallback')
  })
})
