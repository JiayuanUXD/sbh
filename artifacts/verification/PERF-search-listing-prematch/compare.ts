/**
 * 房源关键词 SQL 改写的「改前 vs 改后」对照：同一份合成数据、同一组查询，
 * 逐条比较完整有序 id 列表与 total，并计时。
 *
 * 用法（应用目录下，库只允许本地环回）：
 *   arch -arm64 pnpm exec tsx ../artifacts/verification/PERF-search-listing-prematch/compare.ts
 * 「改前」取自 origin/master 的同名文件（脚本自己 git show 到临时文件再导入，跑完删除）。
 * 夹具规模取线上量级：房源 57080、楼盘 4447、行政区 16、商圈 80、地铁站 200。
 */
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import pg from 'pg'

const ADMIN_URL = process.env.COMPARE_ADMIN_URL ?? 'postgres://liujiayuan@localhost:5432/postgres'
const DB = 'perf_listing_prematch'
const LISTINGS = 57_080
const BUILDINGS = 4_447
const REPEAT = 5

const appDir = process.cwd()
const dir = path.join(appDir, 'src/domain/public-catalog')
const oldFile = path.join(dir, 'listing-query-sql.old-tmp.ts')

const host = new URL(ADMIN_URL).hostname
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('只允许本地库')

writeFileSync(oldFile, execFileSync('git', ['show', 'origin/master:payload-office-platform/src/domain/public-catalog/listing-query-sql.ts'], { encoding: 'utf8' }))

const districts = ['浦东新区', '静安区', '黄浦区', '徐汇区', '长宁区', '虹口区', '杨浦区', '闵行区', '普陀区', '宝山区', '嘉定区', '松江区', '青浦区', '奉贤区', '金山区', '崇明区']
const areas = ['陆家嘴', '外滩', '徐家汇', '南京西路', '人民广场', '世纪大道', '虹桥', '张江', '五角场', '北外滩']
const metros = ['陆家嘴', '人民广场', '静安寺', '世纪大道', '徐家汇', '中山公园', '龙阳路', '江苏路']
const prefixes = ['上海', '中星', '国金', '恒隆', '正大', '港汇', '来福士', '久事', '会德丰', '太平金融', '招商局', '西门子']
const suffixes = ['中心', '大厦', '广场', '商务楼', '国际大厦', '科技园']
const roads = ['南京西路', '世纪大道', '陆家嘴环路', '淮海中路', '延安西路', '张江路']
const titleA = ['整层', '精装', '带家具', '朝南', '近地铁', '拎包入驻']
const titleB = ['办公室', '写字楼', '独栋', '共享办公']

const QUERIES: Array<{ name: string; input: Record<string, unknown>; ranking?: { terms: string[]; mode?: 'and' | 'or' } }> = [
  ...['上海中心', '陆家嘴', '办公室', '中星', '南京西路', '徐家汇', '不存在xyz', '国金中心', '大厦', '10', '号', '2号线'].flatMap((t) => [
    { name: `rank and [${t}]`, input: {}, ranking: { terms: [t], mode: 'and' as const } },
    { name: `rank or [${t}]`, input: {}, ranking: { terms: [t], mode: 'or' as const } },
    { name: `q=${t}`, input: { q: t } },
  ]),
  { name: 'rank and [上海, 中心]', input: {}, ranking: { terms: ['上海', '中心'], mode: 'and' } },
  { name: 'rank or [上海, 陆家嘴]', input: {}, ranking: { terms: ['上海', '陆家嘴'], mode: 'or' } },
  { name: 'rank and [整层, 大厦]', input: {}, ranking: { terms: ['整层', '大厦'], mode: 'and' } },
  { name: 'rank and [陆家嘴] + 面积', input: { areaMin: 200, areaMax: 800 }, ranking: { terms: ['陆家嘴'], mode: 'and' } },
  { name: 'rank and [大厦] + 类型', input: { listingType: ['coworking'] }, ranking: { terms: ['大厦'], mode: 'and' } },
  { name: 'rank and [办公室] + 价格升序', input: { sort: 'price-asc', priceUnit: '元/㎡/天' }, ranking: { terms: ['办公室'], mode: 'and' } },
  { name: 'rank and [%] 通配符已转义', input: {}, ranking: { terms: ['\\%'], mode: 'and' } },
  { name: '无关键词', input: {} },
]

async function main() {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`)
  // 与生产一致：C 字符集、UTF8
  await admin.query(`CREATE DATABASE ${DB} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`)
  await admin.end()
  const pool = new pg.Pool({ connectionString: ADMIN_URL.replace(/\/[^/]*$/, `/${DB}`), max: 1 })
  const c = await pool.connect()

  await c.query(`
    CREATE TABLE locations (id int primary key, slug text, name text, status text, type text, parent_id int);
    CREATE TABLE buildings (id int primary key, city_id int, district_id int, business_district_id int, nearest_metro_id int,
      name text, address text, status text, operational_status text, deleted_at timestamptz);
    CREATE TABLE merchants (id int primary key, status text, qualification_status text, qualification_expires_at timestamptz);
    CREATE TABLE merchants_rels (parent_id int, path text, locations_id int);
    CREATE TABLE listing_reports (target_listing_id int, supply_paused boolean);
    CREATE TABLE listings_building_form (parent_id int, value text, "order" int);
    CREATE TABLE listings (id int primary key, building_id int, merchant_id int, title text, business_type text,
      listing_type text, area numeric, available_from timestamptz, is_featured boolean, updated_at timestamptz,
      publication_status text, review_status text, supply_visibility_hold text, deleted_at timestamptz,
      price_amount numeric, price_currency text, price_period text, price_unit text, rent numeric, rent_unit text);
    INSERT INTO locations VALUES (1,'shanghai','上海','active','city',NULL);
    INSERT INTO locations SELECT 100+g, 'd'||g, (array[${districts.map((d) => `'${d}'`).join(',')}])[1+g%16], 'active','district',1 FROM generate_series(1,16) g;
    INSERT INTO locations SELECT 200+g, 'a'||g, (array[${areas.map((d) => `'${d}'`).join(',')}])[1+g%10]||(CASE WHEN g>10 THEN g::text ELSE '' END), 'active','business_area',100+1+g%16 FROM generate_series(1,80) g;
    INSERT INTO locations SELECT 300+g, 'm'||g, (array[${metros.map((d) => `'${d}'`).join(',')}])[1+g%8]||(CASE WHEN g>8 THEN g::text ELSE '' END), 'active','metro_station',NULL FROM generate_series(1,200) g;
    INSERT INTO buildings SELECT g, 1, 100+1+g%16, CASE WHEN g%13=0 THEN NULL ELSE 200+1+g%80 END, CASE WHEN g%7=0 THEN NULL ELSE 300+1+g%200 END,
      (array[${prefixes.map((d) => `'${d}'`).join(',')}])[1+g%12]||(array[${suffixes.map((d) => `'${d}'`).join(',')}])[1+g%6]||(CASE WHEN g%5=0 THEN '' ELSE g::text END),
      CASE WHEN g%11=0 THEN NULL ELSE '上海市'||(array[${roads.map((d) => `'${d}'`).join(',')}])[1+g%6]||(g%900)||'号' END,
      CASE WHEN g%97=0 THEN 'draft' ELSE 'published' END, 'active', NULL FROM generate_series(1,${BUILDINGS}) g;
    INSERT INTO merchants SELECT g, 'active','valid', NULL FROM generate_series(1,50) g;
    INSERT INTO merchants_rels SELECT g,'serviceCities',1 FROM generate_series(1,50) g;
    INSERT INTO listings SELECT g, 1+g%${BUILDINGS}, 1+g%50,
      (array[${titleA.map((d) => `'${d}'`).join(',')}])[1+g%6]||(array[${titleB.map((d) => `'${d}'`).join(',')}])[1+g%4]||(CASE WHEN g%3=0 THEN g::text ELSE '' END),
      'lease', CASE WHEN g%4=0 THEN 'coworking' ELSE 'traditional-office' END, 50+(g%40)*20, NULL, g%50=0,
      '2026-10-01'::timestamptz + (g%1000)*interval '1 minute',
      CASE WHEN g%53=0 THEN 'draft' ELSE 'published' END, 'approved','normal', NULL,
      10+g%20, 'CNY','day','sqm', NULL, NULL FROM generate_series(1,${LISTINGS}) g;
    CREATE INDEX ON listings(building_id);
    CREATE INDEX ON merchants_rels(parent_id);
    ANALYZE;`)

  const oldMod = await import(pathToFileURL(oldFile).href)
  const newMod = await import(pathToFileURL(path.join(dir, 'listing-query-sql.ts')).href)
  const { createSearchContext } = await import(pathToFileURL(path.join(dir, 'types.ts')).href)
  const ctx = createSearchContext('shanghai', new Date('2026-10-12T00:00:00.000Z'), 'lease')

  const run = async (build: typeof newMod.buildListingPageQuery, q: (typeof QUERIES)[number]) => {
    const input = { sort: 'recommended', page: 1, pageSize: 100_000, ...q.input }
    const query = build(input, ctx, q.ranking)
    const times: number[] = []
    let row: Record<string, unknown> = {}
    for (let i = 0; i < REPEAT; i++) {
      const t0 = performance.now()
      row = (await c.query(query.text, query.values)).rows[0]
      times.push(performance.now() - t0)
    }
    times.sort((a, b) => a - b)
    return { ids: row.ids as number[], total: Number(row.total), ms: times[Math.floor(times.length / 2)] }
  }

  let mismatches = 0
  let sumOld = 0
  let sumNew = 0
  const rows: string[] = []
  const only = process.env.ONLY
  for (const q of QUERIES.filter((x) => !only || x.name.includes(only))) {
    const before = await run(oldMod.buildListingPageQuery, q)
    const after = await run(newMod.buildListingPageQuery, q)
    const same = before.total === after.total && JSON.stringify(before.ids) === JSON.stringify(after.ids)
    if (!same) mismatches++
    sumOld += before.ms
    sumNew += after.ms
    rows.push(`${same ? 'OK ' : 'DIFF'} | ${q.name.padEnd(34)} | total ${String(after.total).padStart(6)} | 改前 ${before.ms.toFixed(0).padStart(5)} ms | 改后 ${after.ms.toFixed(0).padStart(5)} ms`)
  }
  console.log(rows.join('\n'))
  console.log(`\n查询数 ${QUERIES.length}，不一致 ${mismatches}；中位数耗时合计 改前 ${sumOld.toFixed(0)} ms → 改后 ${sumNew.toFixed(0)} ms`)

  c.release()
  await pool.end()
  if (process.env.KEEP_DB !== '1') {
    const admin2 = new pg.Client({ connectionString: ADMIN_URL })
    await admin2.connect()
    await admin2.query(`DROP DATABASE ${DB}`)
    await admin2.end()
  }
  if (mismatches > 0) process.exitCode = 1
}

main().finally(() => rmSync(oldFile, { force: true }))
