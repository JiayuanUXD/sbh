/**
 * 在租面积口径比对：SQL 聚合 vs 逐条精筛
 *
 * SupplyAdapter.sumEffectiveLeasableAreaByBuildings 用一条 SQL 求楼盘在租面积，
 * 把有效供给规则下推到了 WHERE 子句；而 findEffectiveListingsByBuilding 走的是
 * 「粗筛 where + 逐条 isListingEffectivelySupplied 精筛」。两者必须永远同口径，
 * 否则楼盘卡上的「在租 xxx ㎡」会与详情页、列表页的房源集合对不上。
 *
 * 本脚本对当前库中全部楼盘逐个比对两条路径的合计值，任一栋对不上即非零退出。
 * **改动任何有效供给规则后必须重跑**（新增字段、调整商户资质判定、改举报暂停
 * 语义等）。SQL 侧的规则对照见 supply-adapter.ts 中该方法的注释。
 *
 *   pnpm verify:leasable-area
 */
import { getPayload } from 'payload'
import config from '@/payload.config'
import { getDefaultSupplyAdapter } from '@/domain/public-catalog/supply-adapter'
import { defaultSearchContext } from '@/domain/public-catalog'

const payload = await getPayload({ config })
const adapter = getDefaultSupplyAdapter()
const ctx = defaultSearchContext()

const allBuildings = await payload.find({ collection: 'buildings', limit: 500, depth: 0 })
const ids = allBuildings.docs.map((b) => b.id)

const tSql = Date.now()
const sqlMap = await adapter.sumEffectiveLeasableAreaByBuildings(ids, ctx)
const msSql = Date.now() - tSql

const tDoc = Date.now()
const docMap = new Map<string, number>()
for (const id of ids) {
  const listings = await adapter.findEffectiveListingsByBuilding(id, ctx)
  const sum = listings.reduce((s, l) => {
    const a = typeof l.area === 'number' && Number.isFinite(l.area) ? l.area : 0
    return s + a
  }, 0)
  if (sum > 0) docMap.set(String(id), Math.round(sum * 100) / 100)
}
const msDoc = Date.now() - tDoc

console.log(`SQL 聚合  : ${msSql}ms, ${sqlMap.size} 栋有在租`)
console.log(`逐条精筛  : ${msDoc}ms, ${docMap.size} 栋有在租`)

let bad = 0
for (const id of ids) {
  const key = String(id)
  const fromSql = sqlMap.get(key) ?? 0
  const fromDoc = docMap.get(key) ?? 0
  // 允许 0.01 的浮点容差；超出即为口径分叉
  if (Math.abs(fromSql - fromDoc) > 0.01) {
    bad++
    console.error(`❌ 楼盘 ${key}: SQL=${fromSql} 精筛=${fromDoc} 差=${(fromSql - fromDoc).toFixed(2)}`)
  }
}

if (bad === 0) {
  console.log(`✅ ${ids.length} 栋楼盘逐个一致，口径未分叉`)
  process.exit(0)
}
console.error(`❌ ${bad} 栋不一致，SQL 与精筛口径已分叉`)
process.exit(1)
