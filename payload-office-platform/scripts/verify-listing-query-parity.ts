/** 生产只读对账：数据库目录分页 / facet 与原完整扫描逐项比较。 */
import { writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { getPayload } from 'payload'
import { scanListings, parseSearchInput } from '@/domain/public-catalog/facade'
import { createPayloadSupplyAdapter } from '@/domain/public-catalog/supply-adapter'
import { createSearchContext } from '@/domain/public-catalog/types'
import { applyMemoryFilters, selectListingPage, computeFacets, toScanInput } from '@/domain/public-catalog/listing-scan'

const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
databaseUrl.searchParams.set('options', '-c default_transaction_read_only=on -c idle_in_transaction_session_timeout=120000')
process.env.DATABASE_URL = databaseUrl.toString()
process.env.PAYLOAD_DISABLE_JOB_AUTORUN = '1'
const { default: config } = await import('@/payload.config')
const payload = await getPayload({ config })
if ((await payload.db.pool.query('SHOW default_transaction_read_only')).rows[0]?.default_transaction_read_only !== 'on') {
  await payload.db.destroy?.()
  throw new Error('目录对账未进入只读模式')
}
const adapter = createPayloadSupplyAdapter()
const results: Record<string, unknown>[] = []
const asOf = new Date()
try {
  for (const channel of ['lease', 'sale'] as const) {
    for (const city of process.argv.slice(2).length ? process.argv.slice(2) : ['shanghai']) {
      const ctx = createSearchContext(city, asOf, channel)
      const baseInput = parseSearchInput(new URLSearchParams())
      const start = Date.now()
      const baseRows = await scanListings(baseInput, ctx, adapter)
      console.log(JSON.stringify({ city, channel, phase: 'baseline', rows: baseRows.length, elapsedMs: Date.now() - start }))
      const home = await adapter.findHomepageListingAggregate!(null, ctx, true)
      const types = new Map<string | null, { type: string | null; count: number; coverId: number }>()
      for (const row of baseRows) {
        const existing = types.get(row.listingType)
        types.set(row.listingType, { type: row.listingType, count: (existing?.count ?? 0) + 1,
          coverId: Math.min(existing?.coverId ?? row.id, row.id) })
      }
      const sortTypes = (rows: typeof home.types) => [...rows].sort((a, b) => String(a.type).localeCompare(String(b.type)))
      const nearby = baseRows.filter(row => row.coordinates != null).map(({ id, slug, coordinates }) => ({ id, slug, coordinates }))
      if (home.count !== baseRows.length || !isDeepStrictEqual(sortTypes(home.types), sortTypes([...types.values()])) ||
        !isDeepStrictEqual([...home.nearbyCandidates].sort((a, b) => a.id - b.id), nearby.sort((a, b) => a.id - b.id))) {
        throw new Error(`城市首页聚合与目录基线不一致：${city}/${channel}`)
      }
      console.log(JSON.stringify({ city, channel, phase: 'homepage-aggregate', matches: true, count: home.count }))
      const units = [...new Set(baseRows.flatMap(row => row.price ? [row.price.displayUnit] : []))]
      const district = baseRows.find(row => row.district)?.district?.slug
      const area = baseRows.find(row => row.businessDistrict)?.businessDistrict?.slug
      const cases = ['', 'sort=newest', 'page=2', `page=${Math.max(1, Math.ceil(baseRows.length / 24))}`, 'page=999999',
        'type=coworking', 'type=traditional-office', 'form=detached',
        ...(district ? [`district=${district}`] : []), ...(area ? [`businessArea=${area}`] : []),
        ...units.flatMap(unit => [`priceUnit=${unit}`, `priceUnit=${unit}&sort=price-asc`,
          `priceUnit=${unit}&sort=price-desc`, `priceUnit=${unit}&priceMin=0&priceMax=100`]),
        'areaMin=100&areaMax=300', 'q=虹桥', 'q=静安', 'q=陆家嘴', 'availableBefore=2026-12-01']
      for (const query of cases) {
        const input = parseSearchInput(new URLSearchParams(query))
        const coarse = toScanInput(input)
        const needsScan = coarse.areaMin != null || coarse.areaMax != null || coarse.q != null || coarse.availableBefore != null
        const rows = needsScan ? await scanListings(coarse, ctx, adapter) : baseRows
        const expectedPage = selectListingPage(rows, input)
        const expectedFacets = computeFacets(applyMemoryFilters(rows, input))
        const begin = Date.now()
        const actualPage = await adapter.findListingPage!(input, ctx)
        const pageMs = Date.now() - begin
        const facetStart = Date.now()
        const actualFacets = await adapter.findListingFacets!(input, ctx)
        const matches = isDeepStrictEqual(expectedPage, actualPage) && isDeepStrictEqual(expectedFacets, actualFacets)
        const result = { city, channel, query, matches, total: actualPage.pagination.totalDocs, pageMs, facetsMs: Date.now() - facetStart }
        results.push(result)
        console.log(JSON.stringify(result))
        if (!matches) {
          console.error(JSON.stringify({ expectedPage, actualPage, expectedFacets, actualFacets }))
          throw new Error('数据库目录与旧扫描结果不一致')
        }
      }
    }
  }
  if (process.env.PARITY_OUTPUT) await writeFile(process.env.PARITY_OUTPUT, JSON.stringify({ at: asOf.toISOString(), results }, null, 2))
} finally {
  await payload.db.destroy?.()
}
process.exit(0)
