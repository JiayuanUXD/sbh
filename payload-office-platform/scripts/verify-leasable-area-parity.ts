/**
 * 在租面积口径比对：两条 SQL 聚合路径互相校验
 *
 * SupplyAdapter 有两个方法各自用原始 SQL 判定有效供给：
 *   - sumEffectiveLeasableAreaByBuildings：一条 SQL 直接 GROUP BY 聚合面积；
 *   - findEffectiveListingsByBuilding：SQL 选出符合条件的房源 id，再
 *     payload.find 回填文档——**全程不调用 isListingEffectivelySupplied**，
 *     不是「粗筛 + 逐条精筛」，两者都是纯 SQL 路径。
 * 本脚本把 findEffectiveListingsByBuilding 的结果在 JS 里手动按面积求和，
 * 与 sumEffectiveLeasableAreaByBuildings 的聚合值逐楼盘比对。
 *
 * 这两条 SQL 理应共享同一套有效供给规则、永远同口径，否则楼盘卡上的
 * 「在租 xxx ㎡」会与详情页、列表页的房源集合对不上。
 *
 * **它能证明什么**：两处 SQL 的 WHERE/JOIN 条件有没有互相漂移——例如改
 * 有效供给规则时只改了其中一处、漏改了另一处，这类问题会被立刻抓住。
 * **它不能证明什么**：本脚本比对的两条路径都是 SQL，不涉及 TypeScript
 * 精筛层（effective-supply.ts 的 isListingEffectivelySupplied，那是列表页
 * /详情页用的独立判定路径）。SQL 的业务规则本身是否正确、SQL 与 TS 精筛层
 * 是否口径一致，本脚本都无法验证——两条 SQL 共享同一个错误假设时，本脚本
 * 依然会显示「一致」。
 *
 * 本脚本对当前库中全部楼盘逐个比对两条路径的合计值，任一栋对不上即非零退出。
 * **改动任一处 SQL 的有效供给规则后必须重跑**（新增字段、调整商户资质判定、
 * 改举报暂停语义等）。SQL 侧的规则对照见 supply-adapter.ts 中该方法的注释。
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
