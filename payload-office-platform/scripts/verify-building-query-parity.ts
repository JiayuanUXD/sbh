/** 生产只读对照：楼盘 SQL 页与原完整摘要目录、首页输出；不运行作业或写库。 */
import { writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { getPayload } from 'payload'
import type { Building } from '@/payload-types'
import { createPayloadSupplyAdapter } from '@/domain/public-catalog/supply-adapter'
import { createSearchContext } from '@/domain/public-catalog/types'
import { parseBuildingSearchInput } from '@/domain/public-catalog/building-search'
import { getHomepage, searchBuildingsFiltered } from '@/domain/public-catalog/facade'

const target = new URL(process.env.DATABASE_URL ?? '')
target.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=120000')
process.env.DATABASE_URL = target.toString()
process.env.PAYLOAD_DISABLE_JOB_AUTORUN = '1'
const { default: config } = await import('@/payload.config')
const payload = await getPayload({ config })
const readOnly = await payload.db.pool.query('SHOW default_transaction_read_only')
if (readOnly.rows[0]?.default_transaction_read_only !== 'on') throw new Error('只读连接校验失败')
const adapter = createPayloadSupplyAdapter()
const cities = process.argv.slice(2)
if (cities.length === 0) cities.push('shanghai', 'beijing', 'guangzhou', 'shenzhen', 'hangzhou', 'chengdu', 'wuhan')
const asOf = new Date()
const results: unknown[] = []
const homepageResults: unknown[] = []
try {
  for (const city of cities) {
    const ctx = createSearchContext(city, asOf)
    console.log(JSON.stringify({ city, phase: 'legacy-buildings', asOf: ctx.asOf }))
    const start = Date.now()
    const documents: Building[] = []
    let page = 1
    while (true) {
      const result = await adapter.findEffectiveBuildingsPage(ctx, { page, limit: 200 })
      documents.push(...result.docs)
      if (!result.hasNextPage) break
      if (result.nextPage !== page + 1 || page * 200 >= 250000) throw new Error('原目录分页未连续推进')
      page++
    }
    if (new Set(documents.map(doc => doc.id)).size !== documents.length) throw new Error('原楼盘目录跨页重复')
    const legacyMs = Date.now() - start
    for (const business of ['lease', 'sale'] as const) {
      const supply = await adapter.aggregateEffectiveSupplyByBuildings(documents.map(doc => doc.id), { ...ctx, businessType: business })
      const baseline = { ...adapter, findBuildingPageSelection: undefined,
        findEffectiveBuildings: async () => documents, aggregateEffectiveSupplyByBuildings: async () => supply }
      const channel = business === 'sale' ? 'business=sale' : ''
      const first = await searchBuildingsFiltered(parseBuildingSearchInput(new URLSearchParams(channel)), ctx, baseline)
      const queries = ['', 'page=2', `page=${first.totalPages}`, 'page=999999', 'sort=area-desc', 'sort=grade',
        'sort=completion-desc', 'onlyWithStock=1', 'leasableAreaMin=1000', 'leasableAreaMax=5000',
        'completedAfter=2010', 'completedAfter=2020']
      for (const district of first.facets.districts.slice(0, 2)) queries.push(`district=${encodeURIComponent(district.slug)}`)
      for (const area of first.facets.businessAreas.slice(0, 2)) queries.push(`businessArea=${encodeURIComponent(area.slug)}`)
      for (const grade of first.facets.grades.slice(0, 2)) queries.push(`grade=${encodeURIComponent(grade.value)}`)
      for (const metro of first.facets.metros.slice(0, 2)) queries.push(`metro=${encodeURIComponent(metro.slug)}`)
      const district = first.facets.districts[0]?.slug
      const area = first.facets.businessAreas[0]?.slug
      if (district && area) queries.push(`district=${encodeURIComponent(district)}&businessArea=${encodeURIComponent(area)}`)
      queries.push('district=missing&grade=grade-a', 'metro=missing&onlyWithStock=1')
      for (const query of queries) {
        const input = parseBuildingSearchInput(new URLSearchParams([channel, query].filter(Boolean).join('&')))
        const expected = await searchBuildingsFiltered(input, ctx, baseline)
        const queryStart = Date.now()
        const selected = await adapter.findBuildingPageSelection!(input, ctx)
        const actual = { ...selected }
        const metadata = Object.fromEntries(Object.entries(expected).filter(([key]) => !['docs', 'groups'].includes(key)))
        const wanted = { ...metadata, supply: expected.docs.map(doc => ({ id: doc.id, count: doc.listingCount ?? 0,
          area: doc.leasableArea ?? null })) }
        const matched = isDeepStrictEqual(actual, wanted)
        results.push({ city, business, query, total: selected.totalDocs, ids: selected.supply.map(row => row.id),
          queryMs: Date.now() - queryStart, matched })
        console.log(JSON.stringify(results.at(-1)))
        if (!matched) {
          console.error(JSON.stringify({ actual, wanted }))
          throw new Error(`楼盘 SQL 与原目录不一致：${city}/${business}/${query}`)
        }
      }
    }
    const legacyAdapter = { ...adapter, findHomepageBuildingOverview: undefined, findEffectiveBuildings: async () => documents }
    const previous = await getHomepage(ctx, {}, legacyAdapter)
    const overviewStart = Date.now()
    const current = await getHomepage(ctx, {}, adapter)
    const matched = isDeepStrictEqual(current, previous)
    homepageResults.push({ city, stats: current.stats, legacyMs, overviewHomepageMs: Date.now() - overviewStart,
      districtCards: current.districtCards.map(card => ({ slug: card.slug, buildings: card.buildings, cover: card.coverImage?.src ?? null })), matched })
    console.log(JSON.stringify(homepageResults.at(-1)))
    if (!matched) {
      console.error(JSON.stringify({ previousCards: previous.districtCards, currentCards: current.districtCards }))
      throw new Error(`首页完整输出与原实现不一致：${city}`)
    }
  }
  if (process.env.PARITY_OUTPUT) await writeFile(process.env.PARITY_OUTPUT,
    JSON.stringify({ asOf: asOf.toISOString(), cases: results, homepages: homepageResults }, null, 2) + '\n')
} finally { await payload.db.destroy?.() }
process.exit(0)
