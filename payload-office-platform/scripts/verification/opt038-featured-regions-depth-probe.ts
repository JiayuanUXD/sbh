/**
 * OPT-038 Task 4 证据脚本：实测 `payload.find({collection:'city-site-profiles', depth: N})`
 * 把 `featuredRegions[].parent` 展开到什么形态。
 *
 * 为什么必须实测：Task 4 要补的「区位副标」取自 `parent.name` 与 `description`。
 * 若 depth:2 只把 parent 展开成裸 id，就得改取数（提 depth 或二次查询），改动量完全不同。
 * 踩点报告把这条标为「未验证」，本脚本把它做实。
 *
 * 本地库 7 个 profile 的 featuredRegions **全为空数组**，直接读读不出结构，
 * 所以脚本会临时给一个 profile 写入若干真实商圈、探完再原样还原（finally 兜底）。
 * 只对本地库生效：脚本开头 fail-fast 拒绝非 localhost 的 DATABASE_URL。
 *
 * 运行（cwd = payload-office-platform）：
 *   node --env-file-if-exists=.env.local --import tsx \
 *     scripts/verification/opt038-featured-regions-depth-probe.ts
 */
import { getPayload } from 'payload'
import config from '@/payload.config'

function shape(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === 'object') return `object{${Object.keys(value as object).sort().join(',')}}`
  return `${typeof value}(${String(value)})`
}

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? ''
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(`拒绝运行：本脚本会临时写库，DATABASE_URL 必须指向本地库。当前=${url}`)
  }
}

async function main() {
  assertLocalDatabase()
  const payload = await getPayload({ config })

  // ── 1. 找一座城市 + 它旗下可作为精选区域的节点（filterOptions 只收 district / business_area）
  const cityDocs = await payload.find({
    collection: 'locations',
    depth: 0,
    limit: 1,
    where: { and: [{ type: { equals: 'city' } }, { slug: { equals: 'shanghai' } }] },
  })
  const city = cityDocs.docs[0]
  if (!city) throw new Error('本地库没有 shanghai 城市节点')

  const candidates = await payload.find({
    collection: 'locations',
    depth: 0,
    limit: 6,
    sort: ['type', 'sortOrder', 'id'],
    where: {
      and: [
        { city: { equals: city.id } },
        { type: { in: ['district', 'business_area'] } },
        { status: { equals: 'active' } },
        { frontendVisible: { equals: true } },
      ],
    },
  })
  console.log(`\n候选精选区域（${city.name} / active + frontendVisible）：`)
  for (const doc of candidates.docs) {
    const d = doc as unknown as Record<string, unknown>
    console.log(
      `  · #${String(d.id)} ${String(d.name)} [${String(d.type)}] parent=${shape(d.parent)} description=${JSON.stringify(d.description)}`,
    )
  }
  if (candidates.docs.length === 0) throw new Error('没有可用于探测的商圈/行政区')

  const profiles = await payload.find({
    collection: 'city-site-profiles',
    depth: 0,
    limit: 1,
    where: { city: { equals: city.id } },
  })
  const profile = profiles.docs[0]
  if (!profile) throw new Error('该城市没有 city-site-profile')

  const original = (profile as unknown as Record<string, unknown>).featuredRegions
  const originalIds = Array.isArray(original)
    ? original.map((v) => (typeof v === 'object' && v !== null ? (v as { id: unknown }).id : v))
    : []
  console.log(`\nprofile #${String(profile.id)} 原 featuredRegions = ${JSON.stringify(originalIds)}`)
  // ⚠️ 起始状态守卫（与 opt038-task5-districts-probe.ts:115-124 同一判据）：
  // 本脚本「还原成观察到的原值」。如果上一轮跑残留了脏值，这一轮会把脏值当成
  // 原值再写回去，一路级联下去谁都看不出来。所以对预期的干净起点做**断言**而不是
  // 只打印——本地库 7 个 profile 的 featuredRegions 本来就全是空数组
  // （.agent/frontend.md「本地库夹具事实」）。
  if (originalIds.length > 0) {
    throw new Error(
      `拒绝运行：profile #${String(profile.id)} 的 featuredRegions 不是干净起点（可能是上一轮没还原干净）：` +
        `${JSON.stringify(originalIds)}。请先把它清空再跑。`,
    )
  }

  try {
    await payload.update({
      collection: 'city-site-profiles',
      id: profile.id,
      data: { featuredRegions: candidates.docs.map((d) => d.id) } as never,
      depth: 0,
    })

    for (const depth of [1, 2, 3]) {
      const result = await payload.find({
        collection: 'city-site-profiles',
        depth,
        limit: 1,
        where: { city: { equals: city.id } },
      })
      const doc = result.docs[0] as unknown as Record<string, unknown> | undefined
      const regions = doc?.featuredRegions
      console.log(`\n===== depth: ${depth} =====  featuredRegions ${shape(regions)}`)
      if (!Array.isArray(regions)) continue
      for (const region of regions) {
        if (typeof region !== 'object' || region === null) {
          console.log(`    · 未展开：${shape(region)}`)
          continue
        }
        const r = region as unknown as Record<string, unknown>
        const parent = r.parent
        const parentDetail =
          typeof parent === 'object' && parent !== null
            ? ` → parent.name=${JSON.stringify((parent as unknown as Record<string, unknown>).name)}` +
              ` parent.type=${String((parent as unknown as Record<string, unknown>).type)}` +
              ` parent.parent=${shape((parent as unknown as Record<string, unknown>).parent)}`
            : ''
        console.log(`    · ${String(r.name)} [${String(r.type)}]`)
        console.log(`        parent      = ${shape(parent)}${parentDetail}`)
        console.log(`        city        = ${shape(r.city)}`)
        console.log(
          `        description = ${JSON.stringify(r.description)} (len=${typeof r.description === 'string' ? r.description.length : 'n/a'})`,
        )
      }
    }
  } finally {
    await payload.update({
      collection: 'city-site-profiles',
      id: profile.id,
      data: { featuredRegions: originalIds } as never,
      depth: 0,
    })
    const after = await payload.findByID({
      collection: 'city-site-profiles',
      id: profile.id,
      depth: 0,
    })
    const restored = (after as unknown as Record<string, unknown>).featuredRegions
    console.log(`\n已还原 featuredRegions = ${JSON.stringify(restored)}`)
    // 还原后**自查**：只打一句「已还原」而不核对，等于把还原当成了信仰
    // （同 opt038-task5-districts-probe.ts:213-226）。
    if (Array.isArray(restored) ? restored.length > 0 : restored != null) {
      throw new Error('还原失败：本地库被留下了临时写入，请手工清空该 profile 的 featuredRegions 后再跑')
    }
  }
  process.exit(0)
}

void main()
