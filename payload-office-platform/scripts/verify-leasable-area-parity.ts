/**
 * 在租面积/在租套数口径比对：SQL 聚合 vs 逐条精筛
 *
 * SupplyAdapter.aggregateEffectiveSupplyByBuildings 用一条 SQL 同时求楼盘在租面积
 * 与在租套数，把有效供给规则下推到了 WHERE 子句；而 findEffectiveListingsByBuilding
 * 走的是「粗筛 where + 逐条 isListingEffectivelySupplied 精筛」。两条路径必须永远
 * 同口径，否则楼盘卡上的「在租 xxx ㎡」「N 套在租」会与详情页、列表页的房源集合对不上。
 *
 * 本脚本对当前库中全部楼盘逐个比对两条路径的面积合计与套数，任一栋对不上即非零退出。
 * **改动任何有效供给规则后必须重跑**（新增字段、调整商户资质判定、改举报暂停
 * 语义等）。SQL 侧的规则对照见 supply-adapter.ts 中该方法的注释。
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

console.log(`SQL 聚合  : ${msSql}ms, ${sqlMap.size} 栋有在租`)
console.log(`逐条精筛  : ${msDoc}ms, ${docMap.size} 栋有在租`)

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
