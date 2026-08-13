import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const view = readFileSync('src/components/frontend/city/ComingSoonCityView.tsx', 'utf8')
const css = readFileSync('src/app/(frontend)/styles.css', 'utf8')
const comingSoonStyles = css.slice(css.indexOf('.city-coming-soon'))

describe('ComingSoonCityView shell', () => {
  it('does not nest a main landmark and can render the public profile hero media', () => {
    expect(view).toContain('<div className="city-coming-soon">')
    expect(view).not.toContain('<main className="city-coming-soon">')
    expect(view).toContain('profile.hero.media ? <img className="city-coming-soon__media"')
  })

  it('styles readable responsive city sections and 44px action targets', () => {
    expect(css).toContain('.city-coming-soon__hero')
    expect(css).toContain('.city-coming-soon__regions ul')
    expect(css).toContain('min-height: 44px')
    expect(css).toContain('@media (max-width: 767px)')
    expect(comingSoonStyles).not.toContain('var(--paper)')
    expect(comingSoonStyles).not.toContain('var(--ink)')
    expect(comingSoonStyles).not.toContain('var(--line)')
    expect(comingSoonStyles).toContain('var(--color-paper)')
    expect(comingSoonStyles).toContain('var(--color-ink)')
    expect(comingSoonStyles).toContain('var(--color-line)')
  })
})
