import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const migration = readFileSync(
  resolve(here, '../src/migrations/20260725_130727_m2_1_locations_geo_node.ts'),
  'utf8',
)

function statementPosition(fragment: string): number {
  const position = migration.indexOf(fragment)
  expect(position, `迁移缺少 SQL：${fragment}`).toBeGreaterThanOrEqual(0)
  return position
}

describe('M2.1 Locations 生产旧数据迁移', () => {
  it('在新枚举强制转换前归一化旧类型', () => {
    const toText = statementPosition('ALTER TABLE "locations" ALTER COLUMN "type" SET DATA TYPE text')
    const normalizeBusinessArea = statementPosition(
      `WHEN 'business-district' THEN 'business_area'`,
    )
    const normalizeMetro = statementPosition(`WHEN 'metro' THEN 'metro_station'`)
    const castToNewEnum = statementPosition(
      `USING "type"::"public"."enum_locations_type"`,
    )

    expect(toText).toBeLessThan(normalizeBusinessArea)
    expect(normalizeBusinessArea).toBeLessThan(castToNewEnum)
    expect(normalizeMetro).toBeLessThan(castToNewEnum)
  })

  it('先生成唯一合法的历史区域代码，再施加非空和唯一约束', () => {
    const addNullable = statementPosition(
      `ALTER TABLE "locations" ADD COLUMN "immutable_code" varchar;`,
    )
    const backfill = statementPosition(
      `UPDATE "locations" SET "immutable_code" = 'LEGACY_LOC_' || "id"::text`,
    )
    const setNotNull = statementPosition(
      `ALTER TABLE "locations" ALTER COLUMN "immutable_code" SET NOT NULL`,
    )
    const uniqueIndex = statementPosition(
      `CREATE UNIQUE INDEX "locations_immutable_code_idx"`,
    )

    expect(addNullable).toBeLessThan(backfill)
    expect(backfill).toBeLessThan(setNotNull)
    expect(setNotNull).toBeLessThan(uniqueIndex)
  })

  it('回滚前把新版类型归一化回旧枚举', () => {
    const downStart = statementPosition('export async function down')
    const normalizeBusinessArea = migration.indexOf(
      `WHEN 'business_area' THEN 'business-district'`,
      downStart,
    )
    const normalizeMetroLine = migration.indexOf(`WHEN 'metro_line' THEN 'metro'`, downStart)
    const normalizeMetroStation = migration.indexOf(
      `WHEN 'metro_station' THEN 'metro'`,
      downStart,
    )
    const castToOldEnum = migration.indexOf(
      `USING "type"::"public"."enum_locations_type"`,
      downStart,
    )

    expect(normalizeBusinessArea).toBeGreaterThan(downStart)
    expect(normalizeMetroLine).toBeGreaterThan(downStart)
    expect(normalizeMetroStation).toBeGreaterThan(downStart)
    expect(castToOldEnum).toBeGreaterThan(normalizeBusinessArea)
    expect(castToOldEnum).toBeGreaterThan(normalizeMetroLine)
    expect(castToOldEnum).toBeGreaterThan(normalizeMetroStation)
  })
})
