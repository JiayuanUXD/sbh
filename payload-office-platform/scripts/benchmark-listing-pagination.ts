import { getPayload } from 'payload'
import { createPayloadSupplyAdapter, LISTING_SCAN_SELECT, LISTING_SCAN_POPULATE } from '@/domain/public-catalog/supply-adapter'
import { createSearchContext } from '@/domain/public-catalog/types'
import { parseSearchInput } from '@/domain/public-catalog/facade'
import { getEffectiveSupplyWhere, getPausedListingIds } from '@/domain/review/effective-supply'
import { createEffectiveSupplyPayloadPort } from '@/domain/review/effective-supply-payload-port'
import { resolveEffectiveSupplies } from '@/domain/review/effective-supply-snapshot'
import { collectListingScanPages, rowsFromListings } from '@/domain/public-catalog/listing-scan'

const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
databaseUrl.searchParams.set('options', '-c default_transaction_read_only=on')
process.env.DATABASE_URL = databaseUrl.toString()
process.env.PAYLOAD_DISABLE_JOB_AUTORUN = '1'
const { default: config } = await import('@/payload.config')
const payload = await getPayload({ config })
const pool = (payload.db as unknown as { pool: { query: (sql: string) => Promise<{ rows: { default_transaction_read_only: string }[] }> } }).pool
if ((await pool.query('SHOW default_transaction_read_only')).rows[0]?.default_transaction_read_only !== 'on') throw new Error('只读连接检查失败')
const adapter = createPayloadSupplyAdapter()
const ctx = createSearchContext('shanghai', new Date(), 'lease')
const input = parseSearchInput(new URLSearchParams())
const port = createEffectiveSupplyPayloadPort(payload)
const pausedIds = await getPausedListingIds(port)
const where = { ...getEffectiveSupplyWhere(new Date(ctx.asOf), { businessType: 'lease' }),
  'building.city.slug': { equals: ctx.city }, ...(pausedIds.length ? { id: { not_in: pausedIds } } : {}) }
try {
  if (process.env.FULL_SCAN === '1') {
    const fullStart = Date.now()
    const allRows = await collectListingScanPages(async (page, totalPages) => {
      const start = Date.now()
      const result = await adapter.scanEffectiveListingsPage!(input, ctx, page, totalPages)
      console.log(JSON.stringify({ page, totalPages, rows: result.rows.length, ms: Date.now() - start }))
      return result
    })
    const unique = new Set(allRows.map(row => row.id)).size
    console.log(JSON.stringify({ total: allRows.length, unique, ms: Date.now() - fullStart }))
    if (unique !== allRows.length) throw new Error('扫描出现重复房源')
  } else {
  for (const page of [20, 40, 57]) {
    const start = Date.now()
    const counted = await adapter.scanEffectiveListingsPage!(input, ctx, page)
    const countMs = Date.now() - start
    const slimStart = Date.now()
    const raw = await payload.find({ collection: 'listings', where, depth: 2,
      select: LISTING_SCAN_SELECT, populate: LISTING_SCAN_POPULATE, sort: 'id',
      limit: 1000, page, pagination: false })
    const supplies = await resolveEffectiveSupplies(port, raw.docs, new Date(ctx.asOf))
    const rows = rowsFromListings(raw.docs.filter(doc => supplies.get(String(doc.id))?.eligible))
    const same = JSON.stringify(counted.rows.map(row => row.id)) === JSON.stringify(rows.map(row => row.id))
    console.log(JSON.stringify({ page, countMs, withoutCountMs: Date.now() - slimStart, rows: rows.length, same }))
    if (!same) throw new Error('分页结果不一致')
    const batchStart = Date.now()
    const shallow = await payload.find({ collection: 'listings', where, depth: 0,
      select: LISTING_SCAN_SELECT, sort: 'id', limit: 1000, page, pagination: false })
    const buildingIds = [...new Set(shallow.docs.map(doc => typeof doc.building === 'number' ? doc.building : doc.building?.id).filter(id => id != null))]
    const merchantIds = [...new Set(shallow.docs.map(doc => typeof doc.merchant === 'number' ? doc.merchant : doc.merchant?.id).filter(id => id != null))]
    const [buildings, merchants] = await Promise.all([
      payload.find({ collection: 'buildings', where: { id: { in: buildingIds } }, depth: 1,
        select: LISTING_SCAN_POPULATE.buildings, populate: { locations: LISTING_SCAN_POPULATE.locations },
        limit: buildingIds.length, pagination: false }),
      payload.find({ collection: 'merchants', where: { id: { in: merchantIds } }, depth: 0,
        select: LISTING_SCAN_POPULATE.merchants, limit: merchantIds.length, pagination: false }),
    ])
    const byBuilding = new Map(buildings.docs.map(doc => [doc.id, doc]))
    const byMerchant = new Map(merchants.docs.map(doc => [doc.id, doc]))
    const hydrated = shallow.docs.map(doc => ({ ...doc,
      building: byBuilding.get(typeof doc.building === 'number' ? doc.building : doc.building?.id ?? -1) ?? null,
      merchant: byMerchant.get(typeof doc.merchant === 'number' ? doc.merchant : doc.merchant?.id ?? -1) ?? null }))
    const batchSupply = await resolveEffectiveSupplies(port, hydrated, new Date(ctx.asOf))
    const batchRows = rowsFromListings(hydrated.filter(doc => batchSupply.get(String(doc.id))?.eligible))
    const batchSame = JSON.stringify(rows) === JSON.stringify(batchRows)
    console.log(JSON.stringify({ page, batchMs: Date.now() - batchStart, buildings: buildingIds.length, merchants: merchantIds.length, rows: batchRows.length, batchSame }))
    if (!batchSame) throw new Error('批量关系扫描结果不一致')
  }
  }
} finally {
  await payload.db.destroy?.()
}
process.exit(0)
