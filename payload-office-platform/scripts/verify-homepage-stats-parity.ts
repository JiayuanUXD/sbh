/** 只读比对平台聚合计数与公开目录扫描；所有查询固定同一 asOf。 */
import { writeFile } from 'node:fs/promises'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getPlatformHomepageStats, scanListings, parseSearchInput } from '@/domain/public-catalog/facade'
import { createPayloadSupplyAdapter } from '@/domain/public-catalog/supply-adapter'
import { createSearchContext } from '@/domain/public-catalog/types'
import { mapBuildingSummary } from '@/domain/public-catalog/mappers'

const payload = await getPayload({ config })
const pool = (payload.db as unknown as {
  pool: { query: (sql: string) => Promise<{ rows: { default_transaction_read_only: string }[] }> }
}).pool
const readOnly = await pool.query('SHOW default_transaction_read_only')
if (readOnly.rows[0]?.default_transaction_read_only !== 'on') {
  await payload.db.destroy?.()
  throw new Error('比对脚本必须使用只读数据库连接（PGOPTIONS=-c default_transaction_read_only=on）')
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
    const result = { city, asOf, aggregated, scanned, aggregateMs, scanMs: Date.now() - scanStart }
    console.log(JSON.stringify(result))
    results.push(result)
    if (JSON.stringify(aggregated) !== JSON.stringify(scanned)) {
      throw new Error(`首页计数与目录口径不一致：${city}`)
    }
  }
  if (process.env.PARITY_OUTPUT) await writeFile(process.env.PARITY_OUTPUT, JSON.stringify(results, null, 2))
} finally {
  await payload.db.destroy?.()
}
