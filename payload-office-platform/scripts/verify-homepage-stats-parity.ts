/** 只读比对平台聚合计数与公开目录扫描；所有查询固定同一 asOf。 */
import { writeFile } from 'node:fs/promises'
import { getPayload } from 'payload'
import { getPlatformHomepageStats, scanListings, parseSearchInput } from '@/domain/public-catalog/facade'
import { createPayloadSupplyAdapter } from '@/domain/public-catalog/supply-adapter'
import { createSearchContext } from '@/domain/public-catalog/types'
import { mapBuildingSummary } from '@/domain/public-catalog/mappers'

const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
databaseUrl.searchParams.set('options', '-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=120000')
process.env.DATABASE_URL = databaseUrl.toString()
process.env.PAYLOAD_DISABLE_JOB_AUTORUN = '1'
const { default: config } = await import('@/payload.config')
const payload = await getPayload({ config })
const pool = (payload.db as unknown as {
  pool: { query: (sql: string) => Promise<{ rows: { default_transaction_read_only: string }[] }> }
}).pool
const readOnly = await pool.query('SHOW default_transaction_read_only')
if (readOnly.rows[0]?.default_transaction_read_only !== 'on') {
  await payload.db.destroy?.()
  throw new Error('比对脚本数据库连接未进入只读模式')
}
const adapter = createPayloadSupplyAdapter()
const asOf = new Date().toISOString()
const cities = process.argv.slice(2)
if (cities.length === 0) cities.push('shanghai')
const results = []
try {
  for (const city of cities) {
    const ctx = createSearchContext(city, new Date(asOf), 'lease')
    const fixedAdapter = {
      ...adapter,
      findEffectiveBuildingIdentities: () => adapter.findEffectiveBuildingIdentities!(ctx),
      findEffectiveBusinessAreas: () => adapter.findEffectiveBusinessAreas(ctx),
      aggregateEffectiveSupplyByBuildings: (ids: readonly (number | string)[]) =>
        adapter.aggregateEffectiveSupplyByBuildings(ids, ctx),
    }
    const start = Date.now()
    console.log(JSON.stringify({ city, phase: 'aggregate', asOf }))
    const aggregated = await getPlatformHomepageStats([city], fixedAdapter)
    const aggregateMs = Date.now() - start
    const scanStart = Date.now()
    const [rows, buildings, areas] = await Promise.all([
      scanListings(parseSearchInput(new URLSearchParams()), ctx, adapter),
      adapter.findEffectiveBuildings(ctx),
      adapter.findEffectiveBusinessAreas(ctx),
    ])
    const scanned = { listings: rows.length,
      buildings: buildings.filter(building => mapBuildingSummary(building) !== null).length,
      businessAreas: areas.length }
    const uniqueListings = new Set(rows.map(row => row.id)).size
    const scanMs = Date.now() - scanStart
    const summaryStart = Date.now()
    const summary = await adapter.findHomepageListingAggregate!(buildings.map(building => building.id), ctx, true)
    const expectedTypes = new Map<string | null, { type: string | null; count: number; coverId: number }>()
    for (const row of rows) {
      const existing = expectedTypes.get(row.listingType)
      expectedTypes.set(row.listingType, { type: row.listingType, count: (existing?.count ?? 0) + 1,
        coverId: Math.min(existing?.coverId ?? row.id, row.id) })
    }
    const normalizeTypes = (types: typeof summary.types) => [...types].sort((a, b) => String(a.type).localeCompare(String(b.type)))
    const normalizeNearby = (candidates: typeof summary.nearbyCandidates) => [...candidates]
      .filter(row => row.coordinates != null).sort((a, b) => a.id - b.id)
    const expectedNearby = rows.map(({ id, slug, coordinates }) => ({ id, slug, coordinates }))
    const summaryMatches = summary.count === rows.length &&
      JSON.stringify(normalizeTypes(summary.types)) === JSON.stringify(normalizeTypes([...expectedTypes.values()])) &&
      JSON.stringify(normalizeNearby(summary.nearbyCandidates)) === JSON.stringify(normalizeNearby(expectedNearby))
    const result = { city, asOf, aggregated, scanned, uniqueListings, aggregateMs, scanMs,
      homepageAggregateMs: Date.now() - summaryStart, homepageAggregateCount: summary.count,
      homepageTypesAndNearbyMatch: summaryMatches }
    console.log(JSON.stringify(result))
    results.push(result)
    if (!summaryMatches || uniqueListings !== rows.length || JSON.stringify(aggregated) !== JSON.stringify(scanned)) {
      throw new Error(`首页计数与目录口径不一致：${city}`)
    }
  }
  if (process.env.PARITY_OUTPUT) await writeFile(process.env.PARITY_OUTPUT, JSON.stringify(results, null, 2))
} finally {
  await payload.db.destroy?.()
}
process.exit(0)
