import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CITY_SITE_PROFILE_SEEDS,
  up as seedCitySiteProfiles,
} from '../src/migrations/20260813_011000_seed_city_site_profiles'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '..', 'src', 'migrations')
const schemaMigrationPath = resolve(migrationsDir, '20260813_010000_city_site_profiles.ts')
const seedMigrationPath = resolve(migrationsDir, '20260813_011000_seed_city_site_profiles.ts')

function migrationText(path: string): string {
  expect(existsSync(path), `expected migration file: ${path}`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('city site profile migrations', () => {
  it('creates the one-profile-per-city schema through the generated migration', () => {
    const schemaMigrationText = migrationText(schemaMigrationPath)

    expect(schemaMigrationText).toContain('city_site_profiles')
    expect(schemaMigrationText).toMatch(/UNIQUE.*city_id|city_id.*UNIQUE/is)
  })

  it('seeds seven profiles by immutable city code without changing location visibility', () => {
    const seedMigrationText = migrationText(seedMigrationPath)

    for (const immutableCode of [
      'LEGACY_LOC_1',
      'CITY-HZ',
      'CITY-NB',
      'CITY-SZ',
      'CITY-NJ',
      'CITY-JX',
      'CITY-WX',
    ]) {
      expect(seedMigrationText).toContain(`'${immutableCode}'`)
    }
    expect(seedMigrationText).toContain("'LEGACY_LOC_1'")
    expect(seedMigrationText).not.toMatch(/UPDATE\s+locations\s+SET\s+frontend_visible/i)
    expect(seedMigrationText).not.toMatch(/WHERE\s+"?name"?\s*=/i)
  })

  it('uses an idempotent transaction that fails closed on city or seeded-content mismatches', () => {
    const seedMigrationText = migrationText(seedMigrationPath)

    expect(seedMigrationText).toMatch(/transaction|BEGIN/i)
    expect(seedMigrationText).toContain('city_site_profile_seed_conflict')
    expect(seedMigrationText).toContain('cityResult.rows.length !== 1')
    expect(seedMigrationText).toContain("'live'")
    expect(seedMigrationText).toContain("'coming-soon'")
    expect(seedMigrationText).toContain('shanghaiCopy')
    expect(seedMigrationText).toContain('comingSoonCopy')
  })

  it('resolves Shanghai only through ordered immutable-code compatibility aliases', () => {
    const seedMigrationText = migrationText(seedMigrationPath)

    expect(seedMigrationText).toContain("cityCodes: ['LEGACY_LOC_1', 'CITY-SH', 'SH']")
    expect(seedMigrationText).toContain('sql.join(cityCodePredicates')
    expect(seedMigrationText).toContain('cityResult.rows.length !== 1')
    expect(seedMigrationText).not.toMatch(/WHERE\s+"?name"?\s*=/i)
  })

  it('inserts seven deterministic profiles with one live and six coming-soon statuses', async () => {
    const db = createSeedDb({ mode: 'missing' })

    await seedCitySiteProfiles({ db })

    expect(db.insertCount).toBe(7)
    expect(CITY_SITE_PROFILE_SEEDS.filter((seed) => seed.serviceStatus === 'live')).toHaveLength(1)
    expect(CITY_SITE_PROFILE_SEEDS.filter((seed) => seed.serviceStatus === 'coming-soon')).toHaveLength(6)
  })

  it('skips a fully matching existing profile idempotently', async () => {
    const db = createSeedDb({ mode: 'matching' })

    await seedCitySiteProfiles({ db })

    expect(db.insertCount).toBe(0)
  })

  it.each([
    'heroMedia',
    'introHeading',
    'introBody',
    'contactHeading',
    'contactBody',
    'featuredRegions',
  ] as const)(
    'rejects an existing profile when optional %s differs from the seed',
    async (field) => {
      const db = createSeedDb({ mode: 'optional-mismatch', mismatchField: field })

      await expect(seedCitySiteProfiles({ db })).rejects.toThrow(
        'city_site_profile_seed_conflict',
      )
      expect(db.insertCount).toBe(0)
    },
  )

  it.each(['zero-city-match', 'multiple-city-match'] as const)(
    'aborts when immutable aliases have %s',
    async (mode) => {
      const db = createSeedDb({ mode })

      await expect(seedCitySiteProfiles({ db })).rejects.toThrow(
        'city_site_profile_seed_conflict',
      )
      expect(db.insertCount).toBe(0)
    },
  )
})

type SeedDbMode = 'matching' | 'missing' | 'multiple-city-match' | 'optional-mismatch' | 'zero-city-match'
type OptionalField = 'contactBody' | 'contactHeading' | 'featuredRegions' | 'heroMedia' | 'introBody' | 'introHeading'

function createSeedDb({
  mismatchField,
  mode,
}: {
  mismatchField?: OptionalField
  mode: SeedDbMode
}) {
  let call = 0
  let insertCount = 0
  const matchingProfile = (cityId: number) => ({
    city_id: cityId,
    service_status: cityId === 1 ? 'live' : 'coming-soon',
    switcher_visible: true,
    sort_order: cityId * 10,
    seo_title: CITY_SITE_PROFILE_SEEDS[cityId - 1].seoTitle,
    seo_description: CITY_SITE_PROFILE_SEEDS[cityId - 1].seoDescription,
    hero_eyebrow: CITY_SITE_PROFILE_SEEDS[cityId - 1].heroEyebrow,
    hero_heading: CITY_SITE_PROFILE_SEEDS[cityId - 1].heroHeading,
    hero_body: CITY_SITE_PROFILE_SEEDS[cityId - 1].heroBody,
    hero_media_id: mismatchField === 'heroMedia' ? 99 : null,
    intro_heading: mismatchField === 'introHeading' ? 'changed' : null,
    intro_body: mismatchField === 'introBody' ? 'changed' : null,
    contact_heading: mismatchField === 'contactHeading' ? 'changed' : null,
    contact_body: mismatchField === 'contactBody' ? 'changed' : null,
  })
  const db = {
    async execute() {
      const phase = call % 3
      const cityId = Math.floor(call / 3) + 1
      call++
      if (phase === 0) {
        if (mode === 'zero-city-match') return { rows: [] }
        if (mode === 'multiple-city-match') return { rows: [{ id: 1 }, { id: 2 }] }
        return { rows: [{ id: cityId }] }
      }
      if (phase === 1) {
        return { rows: mode === 'missing' ? [] : [matchingProfile(cityId)] }
      }
      if (mode === 'missing') {
        insertCount++
        return { rows: [] }
      }
      return { rows: mismatchField === 'featuredRegions' ? [{ locations_id: 99 }] : [] }
    },
    get insertCount() {
      return insertCount
    },
  }
  return db
}
