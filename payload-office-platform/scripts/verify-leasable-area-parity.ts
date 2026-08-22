/**
 * 在租面积 / 在租套数口径比对：两条 SQL 路径互相校验
 *
 * SupplyAdapter 有两个方法各自用原始 SQL 判定有效供给，各自把同一批有效供给
 * 规则手写成一遍 WHERE/JOIN 子句：
 *   - aggregateEffectiveSupplyByBuildings：一条 SQL 直接 GROUP BY 聚合面积与套数；
 *   - findEffectiveListingsByBuilding：SQL 选出符合条件的房源 id，再
 *     payload.find 回填文档——**全程不调用 isListingEffectivelySupplied**，
 *     不是「粗筛 + 逐条精筛」，两者都是纯 SQL 路径。
 * 本脚本把 findEffectiveListingsByBuilding 的结果在 JS 里手动求和 / 计数，
 * 与 aggregateEffectiveSupplyByBuildings 的聚合值逐楼盘比对。
 *
 * 这两条 SQL 理应共享同一套有效供给规则、永远同口径，否则楼盘卡上的
 * 「在租 xxx ㎡ / N 套」会与详情页、列表页的房源集合对不上。
 *
 * **它能证明什么**：两处 SQL 的 WHERE/JOIN 条件有没有互相漂移——例如改
 * 有效供给规则时只改了其中一处、漏改了另一处，这类问题会被立刻抓住。
 * **它不能证明什么**：本脚本比对的两条路径都是 SQL，不涉及 TypeScript
 * 精筛层（effective-supply.ts 的 isListingEffectivelySupplied，那是列表页
 * /详情页用的独立判定路径）。SQL 的业务规则本身是否正确、SQL 与 TS 精筛层
 * 是否口径一致，本脚本都无法验证——两条 SQL 共享同一个错误假设时，本脚本
 * 依然会显示「一致」。
 *
 * 本脚本对当前库中全部楼盘逐个比对两条路径的面积合计与套数，任一栋对不上即
 * 非零退出。**改动任一处 SQL 的有效供给规则后必须重跑**（新增字段、调整商户
 * 资质判定、改举报暂停语义等）。SQL 侧的规则对照见 supply-adapter.ts 中
 * aggregateEffectiveSupplyByBuildings 的注释。
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

// 标签直接点名两个方法，避免用「精筛」二字制造混淆：两条都是纯 SQL 路径，
// 都不调用 isListingEffectivelySupplied。
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
