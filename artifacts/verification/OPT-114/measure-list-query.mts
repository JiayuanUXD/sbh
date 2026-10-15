/**
 * OPT-114 D5 对照：房源后台列表查询「全量展开」与「select + populate 瘦身」的耗时与体积。
 *
 * 查询条件与列表页完全一致（复用 buildListingListConditions，sort / depth / limit 同列表），
 * 只差 select / populate 两个参数。每个变体先预热 1 次，再跑 ROUNDS 次取中位数。
 *
 * 用法（应用目录内，夹具楼盘见 seed-500-listings.mts）：
 *   cp ../artifacts/verification/OPT-114/measure-list-query.mts ./.opt114-measure.mts
 *   node --env-file-if-exists=.env.local --import tsx ./.opt114-measure.mts <楼盘 id> [limit]
 *   rm ./.opt114-measure.mts
 */
import { getPayload } from 'payload'

import config from './src/payload.config'
import { buildListingListConditions } from './src/components/admin/listings-list-conditions'
import { assertSeedTargetFromProcessEnv } from './src/lib/runtime/seed-target-guard'

const ROUNDS = 5

const buildingId = Number.parseInt(process.argv[2] ?? '', 10)
const limit = Number.parseInt(process.argv[3] ?? '500', 10)
if (!Number.isInteger(buildingId) || buildingId < 1) {
  throw new Error('用法：<楼盘 id> [limit]')
}

assertSeedTargetFromProcessEnv()
const payload = await getPayload({ config })

const conditions = buildListingListConditions({
  q: null,
  publicationStatus: 'published',
  reviewStatus: null,
  listingType: null,
  businessType: null,
  building: buildingId,
  missingCover: false,
  pendingRecheck: false,
})

const base = {
  collection: 'listings' as const,
  where: { and: conditions },
  depth: 1,
  limit,
  page: 1,
  sort: '-updatedAt',
}

const variants: Record<string, () => Promise<{ docs: unknown[] }>> = {
  '现状（depth 1 全量展开）': () => payload.find(base),
  '瘦身（select + populate）': () =>
    payload.find({
      ...base,
      select: {
        title: true,
        slug: true,
        building: true,
        merchant: true,
        listingType: true,
        businessType: true,
        publicationStatus: true,
        reviewStatus: true,
        supplyVisibilityHold: true,
        isFeatured: true,
        area: true,
        roomNumber: true,
        version: true,
        updatedAt: true,
      },
      populate: {
        buildings: { name: true },
        merchants: { name: true },
      },
    }),
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const report: Record<string, unknown> = { buildingId, limit, rounds: ROUNDS }
for (const [name, run] of Object.entries(variants)) {
  const warm = await run()
  const times: number[] = []
  for (let i = 0; i < ROUNDS; i += 1) {
    const started = performance.now()
    await run()
    times.push(performance.now() - started)
  }
  report[name] = {
    docs: warm.docs.length,
    jsonBytes: Buffer.byteLength(JSON.stringify(warm.docs)),
    medianMs: Math.round(median(times)),
    allMs: times.map((t) => Math.round(t)),
  }
}

console.log(JSON.stringify(report, null, 2))
process.exit(0)
