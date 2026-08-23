/**
 * OPT-037 Task 11e：本地 `/news/<slug>` 关系链接夹具（**临时**，测完即删）。
 *
 * 为什么需要它：`scripts/seed-articles.ts` 种的 5 篇文章**一条 relatedBuildings /
 * relatedDistricts 都没有**（实测 `articles_rels` 表为空），于是本地
 * `/news/<slug>` 的「相关推荐」整块不渲染，改前/改后的预取数都会是 0——
 * 「没变化」会被误读成「没生效」。所以先给 article#4 挂上关系，量完再删干净。
 *
 * 直接写 `articles_rels`（Payload 对 hasMany relationship 的连接表），
 * 不碰 `articles` 主表，`remove` 按 parent_id 整段删除，可完全还原。
 * **只对本地开发库执行**（DATABASE_URL 来自 .env.local），不进任何迁移。
 *
 * 用法：node --env-file-if-exists=.env.local task11e-fixture.mjs add|remove|show
 */
import pg from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js'
const mode = process.argv[2]
const ARTICLE = 4
const BUILDINGS = [1, 2, 3, 4, 5, 6]
const LOCATIONS = [2, 3, 6, 7, 8]
const c = new pg.Client(process.env.DATABASE_URL)
await c.connect()
if (mode === 'add') {
  let order = 0
  for (const b of BUILDINGS) {
    await c.query(
      'insert into articles_rels ("order", parent_id, path, buildings_id) values ($1,$2,$3,$4)',
      [order++, ARTICLE, 'relatedBuildings', b],
    )
  }
  for (const l of LOCATIONS) {
    await c.query(
      'insert into articles_rels ("order", parent_id, path, locations_id) values ($1,$2,$3,$4)',
      [order++, ARTICLE, 'relatedDistricts', l],
    )
  }
  console.log('inserted', BUILDINGS.length + LOCATIONS.length)
} else if (mode === 'remove') {
  const r = await c.query('delete from articles_rels where parent_id = $1', [ARTICLE])
  console.log('deleted', r.rowCount)
}
const rows = await c.query('select id, "order", parent_id, path, buildings_id, locations_id from articles_rels order by id')
console.log('articles_rels now:', rows.rows)
await c.end()
