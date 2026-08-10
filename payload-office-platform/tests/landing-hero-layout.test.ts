import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/app/(frontend)/styles.css', 'utf8')
const migrationIndex = readFileSync('src/migrations/index.ts', 'utf8')

describe('LandingHero layout', () => {
  it('bleeds the hero background to the viewport while the content remains constrained', () => {
    expect(css).toMatch(
      /\.landing-hero\s*\{(?=[^}]*width:\s*100vw)(?=[^}]*margin-inline:\s*calc\(50%\s*-\s*50vw\))[^}]*\}/,
    )
    expect(css).toMatch(/\.landing-hero__inner\s*\{(?=[^}]*width:\s*min\(100%,\s*var\(--container-max\)\))[^}]*\}/)
  })

  it('uses a covered decorative image layer with a readability scrim', () => {
    expect(css).toMatch(
      /\.landing-hero__background-image\s*\{(?=[^}]*width:\s*100%)(?=[^}]*height:\s*100%)(?=[^}]*object-fit:\s*cover)[^}]*\}/,
    )
    expect(css).toMatch(/\.landing-hero__scrim\s*\{[^}]*background:\s*linear-gradient/s)
  })
})

describe('LandingHero media migration', () => {
  it('registers an idempotent media metadata migration for production file routes', () => {
    const migrationName = '20260810_153500_landing_hero_media_assets'
    const migration = readFileSync(`src/migrations/${migrationName}.ts`, 'utf8')

    expect(migrationIndex).toContain(`./${migrationName}`)
    expect(migrationIndex).toContain(`name: '${migrationName}'`)
    expect(migration).toContain('landing-hero-publish-20260810.jpg')
    expect(migration).toContain('landing-hero-entrust-20260810.jpg')
    expect(migration).toContain('ON CONFLICT ("filename") DO UPDATE')
  })
})
