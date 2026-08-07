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
      /export const getCachedDetailRecommendations = unstable_cache\([\s\S]*?revalidate:\s*300[\s\S]*?\n\)/,
    )
  })

  it('uses cached slug data and parallel detail secondary work on listing detail pages', async () => {
    const page = await readFile(resolve(ROOT, 'src/app/(frontend)/listings/[slug]/page.tsx'), 'utf8')

    expect(page).toContain('getCachedListingBySlug(slug)')
    expect(page).toContain('getCachedBuildingBySlug(building.slug)')
    expect(page).toContain('getCachedDetailRecommendations(slug, 6)')
    expect(page).toMatch(/Promise\.all\(\[[\s\S]*getCachedBuildingBySlug\(building\.slug\)[\s\S]*getCachedDetailRecommendations\(slug, 6\)[\s\S]*fetchNearbyPois/)
  })

  it('uses cached related buildings on building detail pages', async () => {
    const page = await readFile(resolve(ROOT, 'src/app/(frontend)/buildings/[slug]/page.tsx'), 'utf8')

    expect(page).toContain('getCachedRelatedBuildings(slug)')
    expect(page).not.toContain('getRelatedBuildings(slug, ctx)')
  })

  it('loads the homepage hero video only after client-side capability checks', async () => {
    const [homePage, heroVideo] = await Promise.all([
      readFile(resolve(ROOT, 'src/app/(frontend)/page.tsx'), 'utf8'),
      readFile(resolve(ROOT, 'src/components/frontend/HomeHeroMedia.tsx'), 'utf8'),
    ])

    expect(homePage).toContain('<HomeHeroMedia />')
    expect(homePage).not.toContain('<video autoPlay')
    expect(heroVideo).toContain("poster=\"/hero/poster.jpg\"")
    expect(heroVideo).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(heroVideo).toContain("matchMedia('(max-width: 767px)')")
    expect(heroVideo).toContain('connection?.saveData')
    expect(heroVideo).toContain('requestIdleCallback')
  })
})
