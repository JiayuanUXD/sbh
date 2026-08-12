import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { up as seedCitySiteProfiles } from '../src/migrations/20260813_011000_seed_city_site_profiles'

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
    expect(db.insertedProfiles.map(({ cityId, serviceStatus, sortOrder, switcherVisible }) => ({
      cityId,
      serviceStatus,
      sortOrder,
      switcherVisible,
    }))).toEqual(INSERT_EXPECTATIONS)
  })

  it('uses the existing profile ID, not the city ID, for featured-region identity lookup', async () => {
    const initialDb = createSeedDb({ mode: 'missing' })
    await seedCitySiteProfiles({ db: initialDb })
    const db = createSeedDb({ mode: 'matching', profiles: initialDb.insertedProfiles })

    await seedCitySiteProfiles({ db })

    expect(db.insertCount).toBe(0)
    expect(db.featuredRegionParentIds).toEqual(initialDb.insertedProfiles.map(({ id }) => id))
  })

  it.each([
    'city',
    'serviceStatus',
    'switcherVisible',
    'sortOrder',
    'seoTitle',
    'seoDescription',
    'heroEyebrow',
    'heroHeading',
    'heroBody',
    'heroMedia',
    'introHeading',
    'introBody',
    'contactHeading',
    'contactBody',
    'featuredRegions',
  ] as const)(
    'rejects an existing profile when optional %s differs from the seed',
    async (field) => {
      const initialDb = createSeedDb({ mode: 'missing' })
      await seedCitySiteProfiles({ db: initialDb })
      const db = createSeedDb({
        mismatchField: field,
        mode: 'optional-mismatch',
        profiles: initialDb.insertedProfiles,
      })

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

const INSERT_EXPECTATIONS = [
  { cityId: 101, serviceStatus: 'live', sortOrder: 10, switcherVisible: true },
  { cityId: 102, serviceStatus: 'coming-soon', sortOrder: 20, switcherVisible: true },
  { cityId: 103, serviceStatus: 'coming-soon', sortOrder: 30, switcherVisible: true },
  { cityId: 104, serviceStatus: 'coming-soon', sortOrder: 40, switcherVisible: true },
  { cityId: 105, serviceStatus: 'coming-soon', sortOrder: 50, switcherVisible: true },
  { cityId: 106, serviceStatus: 'coming-soon', sortOrder: 60, switcherVisible: true },
  { cityId: 107, serviceStatus: 'coming-soon', sortOrder: 70, switcherVisible: true },
] as const

type SeedDbMode = 'matching' | 'missing' | 'multiple-city-match' | 'optional-mismatch' | 'zero-city-match'
type MismatchField =
  | 'city'
  | 'contactBody'
  | 'contactHeading'
  | 'featuredRegions'
  | 'heroBody'
  | 'heroEyebrow'
  | 'heroHeading'
  | 'heroMedia'
  | 'introBody'
  | 'introHeading'
  | 'seoDescription'
  | 'seoTitle'
  | 'serviceStatus'
  | 'sortOrder'
  | 'switcherVisible'

type InsertedProfile = {
  cityId: number
  id: number
  row: Record<string, unknown>
  serviceStatus: string
  sortOrder: number
  switcherVisible: boolean
}

function createSeedDb({
  mismatchField,
  mode,
  profiles = [],
}: {
  mismatchField?: MismatchField
  mode: SeedDbMode
  profiles?: readonly InsertedProfile[]
}) {
  const dialect = new PgDialect()
  let cityLookupCount = 0
  let insertCount = 0
  const insertedProfiles: InsertedProfile[] = []
  const featuredRegionParentIds: number[] = []
  const db = {
    async execute(query: Parameters<PgDialect['sqlToQuery']>[0]) {
      const compiled = dialect.sqlToQuery(query)
      if (compiled.sql.includes('FROM "locations"')) {
        if (mode === 'zero-city-match') return { rows: [] }
        if (mode === 'multiple-city-match') return { rows: [{ id: 1 }, { id: 2 }] }
        const expected = INSERT_EXPECTATIONS[cityLookupCount]
        cityLookupCount++
        if (!expected) throw new Error('unexpected immutable city lookup')
        return { rows: [{ id: expected.cityId }] }
      }
      if (compiled.sql.includes('FROM "city_site_profiles"')) {
        if (mode === 'missing') return { rows: [] }
        const cityId = compiled.params[0]
        if (typeof cityId !== 'number') throw new Error('profile lookup must use a numeric city ID')
        const profile = profiles.find((candidate) => candidate.cityId === cityId)
        if (!profile) throw new Error(`missing controlled profile for city ${cityId}`)
        return { rows: [mismatchedProfileRow(profile, mismatchField)] }
      }
      if (compiled.sql.includes('FROM "city_site_profiles_rels"')) {
        const parentId = compiled.params[0]
        if (typeof parentId !== 'number') throw new Error('featured-region lookup must use a numeric profile ID')
        featuredRegionParentIds.push(parentId)
        return { rows: mismatchField === 'featuredRegions' ? [{ locations_id: 99 }] : [] }
      }
      if (compiled.sql.includes('INSERT INTO "city_site_profiles"')) {
        const expected = INSERT_EXPECTATIONS[insertCount]
        if (!expected) throw new Error('unexpected profile insert')
        const inserted = insertedProfileFromQuery(compiled.params, compiled.sql, expected, insertCount)
        insertedProfiles.push(inserted)
        insertCount++
        return { rows: [] }
      }
      throw new Error(`unexpected SQL in controlled seed DB: ${compiled.sql}`)
    },
    featuredRegionParentIds,
    get insertCount() {
      return insertCount
    },
    insertedProfiles,
  }
  return db
}

function insertedProfileFromQuery(
  params: unknown[],
  query: string,
  expected: (typeof INSERT_EXPECTATIONS)[number],
  insertIndex: number,
): InsertedProfile {
  const [cityIdValue, serviceStatusValue, sortOrderValue] = params
  if (
    cityIdValue !== expected.cityId ||
    serviceStatusValue !== expected.serviceStatus ||
    sortOrderValue !== expected.sortOrder
  ) {
    throw new Error(`profile insert ${insertIndex} has incorrect city, status, or sort order`)
  }
  const cityId = expected.cityId
  const serviceStatus = expected.serviceStatus
  const sortOrder = expected.sortOrder
  if (!query.includes('\n          true,')) {
    throw new Error(`profile insert ${insertIndex} must set switcher_visible true`)
  }
  return {
    cityId,
    id: 701 + insertIndex,
    row: {
      city_id: cityId,
      service_status: serviceStatus,
      switcher_visible: true,
      sort_order: sortOrder,
      seo_title: params[3],
      seo_description: params[4],
      hero_eyebrow: params[5],
      hero_heading: params[6],
      hero_body: params[7],
      hero_media_id: params[8],
      intro_heading: params[9],
      intro_body: params[10],
      contact_heading: params[11],
      contact_body: params[12],
    },
    serviceStatus,
    sortOrder,
    switcherVisible: true,
  }
}

function mismatchedProfileRow(
  profile: InsertedProfile,
  mismatchField: MismatchField | undefined,
): Record<string, unknown> {
  const row = { id: profile.id, ...profile.row }
  if (!mismatchField || mismatchField === 'featuredRegions') return row
  switch (mismatchField) {
    case 'city': return { ...row, city_id: -1 }
    case 'serviceStatus': return { ...row, service_status: 'incorrect-status' }
    case 'switcherVisible': return { ...row, switcher_visible: false }
    case 'sortOrder': return { ...row, sort_order: -1 }
    case 'seoTitle': return { ...row, seo_title: 'incorrect-title' }
    case 'seoDescription': return { ...row, seo_description: 'incorrect-description' }
    case 'heroEyebrow': return { ...row, hero_eyebrow: 'incorrect-eyebrow' }
    case 'heroHeading': return { ...row, hero_heading: 'incorrect-heading' }
    case 'heroBody': return { ...row, hero_body: 'incorrect-body' }
    case 'heroMedia': return { ...row, hero_media_id: 99 }
    case 'introHeading': return { ...row, intro_heading: 'incorrect-intro-heading' }
    case 'introBody': return { ...row, intro_body: 'incorrect-intro-body' }
    case 'contactHeading': return { ...row, contact_heading: 'incorrect-contact-heading' }
    case 'contactBody': return { ...row, contact_body: 'incorrect-contact-body' }
  }
}
