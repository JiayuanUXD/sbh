import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

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
})
