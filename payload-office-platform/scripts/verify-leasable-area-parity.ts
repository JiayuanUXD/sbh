/**
 * 在租面积/在租套数口径比对：两条独立维护的 SQL 实现之间是否漂移
 *
 * SupplyAdapter.aggregateEffectiveSupplyByBuildings 与 findEffectiveListingsByBuilding
 * 各自是一段独立维护的原始 SQL 字符串，各自把同一批有效供给规则手写成一遍 WHERE 子句——
 * **两者都不调用** `isListingEffectivelySupplied`，所以本脚本验证的不是「SQL 聚合 vs
 * 逐条精筛」这种双路径互证，而是「改一条谓词时是否忘了同步改另一条」的字符串级漂移。
 * 这仍然有真实价值（两处规则各改各的、悄悄对不上是真实会发生的疏漏），但不能替代
 * 「与 isListingEffectivelySupplied 真正同口径」的证明——那是另一层目前未覆盖的风险。
 *
 * 本脚本对当前库中全部楼盘逐个比对两条路径的面积合计与套数，任一栋对不上即非零退出。
 * **改动任何有效供给规则后必须重跑**（新增字段、调整商户资质判定、改举报暂停
 * 语义等）。SQL 侧的规则对照见 supply-adapter.ts 中该方法的注释。
 *
 * 已知限制：findEffectiveListingsByBuilding 侧受 PUBLIC_CATALOG_CANDIDATE_LIMIT
 * （1000）封顶，aggregateEffectiveSupplyByBuildings 侧的 SQL 聚合不封顶——若某栋楼
 * 真实有效房源数超过 1000，doc 侧的 count/area 会被截断，产生假阳性不一致。当前
 * 生产数据规模下不会触发，一旦真的报错先确认涉事楼盘是否触顶这个上限，而不是
 * 直接当作有效供给规则分叉去排查。
 *
 *   pnpm verify:leasable-area
 */
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getDefaultSupplyAdapter } from '@/domain/public-catalog/supply-adapter'
import { createSearchContext } from '@/domain/public-catalog'
import { siteConfig } from '@/lib/frontend/site-config'

const payload = await getPayload({ config })
const adapter = getDefaultSupplyAdapter()
const ctx = createSearchContext(siteConfig.defaultCity)

const allBuildings = await payload.find({ collection: 'buildings', limit: 500, depth: 0 })
const ids = allBuildings.docs.map((b) => b.id)

const tSql = Date.now()
const sqlMap = await adapter.aggregateEffectiveSupplyByBuildings(ids, ctx)
const msSql = Date.now() - tSql

const tDoc = Date.now()
const docMap = new Map<string, { area: number; count: number }>()
for (const id of ids) {
  const listings = await adapter.findEffectiveListingsByBuilding(id, ctx)
  if (listings.length === 0) continue
  const sum = listings.reduce((s, l) => {
    const a = typeof l.area === 'number' && Number.isFinite(l.area) ? l.area : 0
    return s + a
  }, 0)
  docMap.set(String(id), { area: Math.round(sum * 100) / 100, count: listings.length })
}
const msDoc = Date.now() - tDoc

console.log(`聚合 SQL（aggregateEffectiveSupplyByBuildings）: ${msSql}ms, ${sqlMap.size} 栋有在租`)
console.log(`逐楼盘 SQL（findEffectiveListingsByBuilding）  : ${msDoc}ms, ${docMap.size} 栋有在租`)

let bad = 0
for (const id of ids) {
  const key = String(id)
  const fromSql = sqlMap.get(key) ?? { area: 0, count: 0 }
  const fromDoc = docMap.get(key) ?? { area: 0, count: 0 }
  // 面积允许 0.01 的浮点容差；套数是整数，必须严格相等
  const areaBad = Math.abs(fromSql.area - fromDoc.area) > 0.01
  const countBad = fromSql.count !== fromDoc.count
  if (areaBad || countBad) {
    bad++
    console.error(
      `❌ 楼盘 ${key}: SQL 面积=${fromSql.area} 精筛面积=${fromDoc.area} 差=${(fromSql.area - fromDoc.area).toFixed(2)}`
      + ` | SQL 套数=${fromSql.count} 精筛套数=${fromDoc.count}`,
    )
  }
}

if (bad === 0) {
  console.log(`✅ ${ids.length} 栋楼盘逐个一致，面积与套数口径均未分叉`)
  process.exit(0)
}
console.error(`❌ ${bad} 栋不一致，SQL 与精筛口径已分叉`)
process.exit(1)
