import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Building } from '@/payload-types'
import { buildBuildingPageQuery, PUBLIC_BUILDING_METADATA_SQL, type BuildingSqlResult } from '@/domain/public-catalog/building-query-sql'
import { parseBuildingSearchInput } from '@/domain/public-catalog/building-search'
import { searchBuildingsFiltered } from '@/domain/public-catalog/facade'
import { mapBuildingCity } from '@/domain/public-catalog/mappers'
import { createSearchContext } from '@/domain/public-catalog/types'
import { CITY_SHANGHAI, DISTRICT_JINGAN, makeArea, makeBuilding, makeHomepageAdapter } from './helpers/opt035-fixtures'

const databaseAvailable = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres'))
const ctx = createSearchContext('shanghai', new Date('2026-10-12T00:00:00Z'))
const cases = ['', 'page=2', 'page=3', 'page=999', 'sort=area-desc', 'sort=grade', 'sort=completion-desc',
  'district=jingan', 'district=second', 'district=missing', 'district=jingan&district=second',
  'businessArea=area-3', 'businessArea=missing', 'district=jingan&businessArea=area-4',
  'grade=grade-a', 'grade=grade-b', 'grade=ungraded', 'grade=ungraded&sort=grade', 'grade=ungraded&grade=grade-b', 'metro=metro', 'metro=missing',
  'leasableAreaMin=100', 'leasableAreaMax=200', 'leasableAreaMin=100&leasableAreaMax=500',
  'completedAfter=2020', 'completedAfter=2000', 'onlyWithStock=1',
  'district=jingan&grade=grade-a&onlyWithStock=1', 'grade=ungraded&completedAfter=2020',
  'metro=metro&leasableAreaMin=1000', 'district=missing&grade=grade-a']

// 仅本地隔离库、单连接事务内临时表；正式表不受影响。
describe.skipIf(!databaseAvailable)('楼盘 SQL 与原目录分面排序逐项一致', () => {
  let client: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; release(): void }
  const documents: Building[] = []
  const stocks = new Map<string, Map<string, { count: number; area: number }>>([['lease', new Map()], ['sale', new Map()]])
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!)
    if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) throw new Error('SQL 夹具只允许本地隔离库')
    const payload = await getPayload({ config })
    client = await payload.db.pool.connect()
    await client.query('BEGIN')
    await client.query(`CREATE TEMP TABLE locations (id int, slug text, name text, type text, status text) ON COMMIT DROP;
      CREATE TEMP TABLE media (id int, url text) ON COMMIT DROP;
      CREATE TEMP TABLE buildings (id int, slug text, name text, city_id int, district_id int,
        business_district_id int, nearest_metro_id int, cover_image_id int, grade text,
        completion_date timestamptz, updated_at timestamptz, recommended_order int DEFAULT 0, status text, operational_status text, deleted_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE merchants (id int, status text, qualification_status text, qualification_expires_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE merchants_rels (parent_id int, path text, locations_id int) ON COMMIT DROP;
      CREATE TEMP TABLE listing_reports (target_listing_id int, supply_paused boolean) ON COMMIT DROP;
      CREATE TEMP TABLE listings (id int, building_id int, merchant_id int, business_type text, area numeric,
        publication_status text, review_status text, supply_visibility_hold text, deleted_at timestamptz) ON COMMIT DROP;
      INSERT INTO locations VALUES (100,'shanghai','上海','city','active'),(1,'jingan','静安','district','active'),
        (2,'second','另一区','district','active'),(3,'area-3','商圈三','business_area','active'),
        (4,'area-4','商圈四','business_area','active'),(5,'metro','地铁','metro_station','active');
      INSERT INTO media VALUES (9001,'/media/m1.jpg');
      INSERT INTO merchants VALUES (1,'active','valid',NULL),(2,'disabled','valid',NULL);
      INSERT INTO merchants_rels VALUES (1,'serviceCities',100),(1,'serviceCities',100),(2,'serviceCities',100);`)
    const grades = ['super-grade-a', 'grade-a', 'grade-b', 'ungraded', 'creative-park', 'serviced-office', null] as const
    for (let id = 1; id <= 60; id++) {
      const district = id % 2 ? DISTRICT_JINGAN : { ...DISTRICT_JINGAN, id: 2, slug: 'second', name: '另一区' }
      const area = makeArea({ id: id % 3 ? 3 : 4, slug: id % 3 ? 'area-3' : 'area-4', name: id % 3 ? '商圈三' : '商圈四' })
      const metro = id % 2 ? makeArea({ id: 5, slug: 'metro', name: '地铁', type: 'metro_station' }) : null
      const date = id % 5 === 0 ? null : id % 7 === 0 ? '2019-12-31T23:59:59Z' : `${2000 + id % 25}-01-01T00:00:00Z`
      const doc = makeBuilding({ id, slug: `building-${id % 2 ? '_' : '-'}${id}`, district,
        businessDistrict: area, nearestMetro: metro, grade: grades[id % grades.length], completionDate: date,
        updatedAt: `2026-10-01T00:00:0${id % 3}.000Z` })
      documents.push(doc)
      await client.query(`INSERT INTO buildings VALUES ($1,$2,$3,100,$4,$5,$6,9001,$7,$8,$9,0,'published','active',NULL)`,
        [id, doc.slug, doc.name, district.id, area.id, metro?.id ?? null, doc.grade, date, doc.updatedAt])
      for (const business of ['lease', 'sale']) {
        const count = business === 'lease' ? id % 4 : id % 5 === 0 ? 1 : 0
        let total = 0
        for (let n = 0; n < count; n++) {
          const value = id % 6 === 0 ? null : id % 11 === 0 ? -1 : id * 10 + n * 0.005
          total += value ?? 0
          await client.query(`INSERT INTO listings VALUES ($1,$2,1,$3,$4,'published','approved','normal',NULL)`,
            [id * 10 + n + (business === 'sale' ? 10000 : 0), id, business, value])
        }
        if (count) stocks.get(business)!.set(String(id), { count, area: total > 0 ? Math.round(total * 100) / 100 : 0 })
      }
    }
    await client.query(`INSERT INTO listings VALUES (99991,1,2,'lease',99999,'published','approved','normal',NULL),
      (99992,1,1,'lease',99999,'draft','approved','normal',NULL),
      (99993,1,1,'lease',99999,'published','approved','normal',NULL);
      INSERT INTO listing_reports VALUES (99993,true);
      INSERT INTO buildings SELECT 999,'invalid','未公开楼盘',city_id,district_id,business_district_id,
        nearest_metro_id,cover_image_id,grade,completion_date,updated_at,recommended_order,'draft',operational_status,NULL FROM buildings WHERE id=1;`)
    // 原适配器先由 PG numeric 求和，再在 JS 将 float8 结果收敛到两位；不是逐行 JS 累加。
    for (const business of ['lease', 'sale']) {
      const rows = (await client.query(`SELECT building_id, SUM(area)::float8 AS area, COUNT(*)::int AS count
        FROM listings l WHERE merchant_id=1 AND publication_status='published' AND business_type=$1
          AND NOT EXISTS (SELECT 1 FROM listing_reports r WHERE r.target_listing_id=l.id AND r.supply_paused=true)
        GROUP BY building_id`, [business])).rows
      stocks.get(business)!.clear()
      for (const row of rows) stocks.get(business)!.set(String(row.building_id), {
        count: Number(row.count), area: Number(row.area) > 0 ? Math.round(Number(row.area) * 100) / 100 : 0,
      })
    }
    documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id - b.id)
  }, 60000)
  afterAll(async () => {
    if (client) { try { await client.query('ROLLBACK') } finally { client.release() } }
  })

  for (const business of ['lease', 'sale'] as const) {
    it.each(cases)(`${business} / %s`, async query => {
      const input = parseBuildingSearchInput(new URLSearchParams(query + (business === 'sale' ? '&business=sale' : '')))
      const expected = await searchBuildingsFiltered(input, ctx, makeHomepageAdapter({
        findEffectiveBuildings: async () => documents,
        aggregateEffectiveSupplyByBuildings: async () => stocks.get(business)!,
      }))
      const ordered = [...documents].sort((a, b) => a.slug.localeCompare(b.slug)).map(doc => doc.id)
      const sql = buildBuildingPageQuery(input, ctx, ordered)
      const actual = (await client.query(sql.text, sql.values)).rows[0].result as BuildingSqlResult
      const metadata = Object.fromEntries(Object.entries(expected).filter(([key]) =>
        !['docs', 'groups', 'page', 'totalPages'].includes(key)))
      expect(actual).toEqual({ ...metadata, supply: expected.docs.map(doc => ({ id: doc.id,
        count: doc.listingCount ?? 0, area: doc.leasableArea ?? null })) })
    })
  }
  it('轻量身份查询保持完整资格、稳定时间和城市映射', async () => {
    const rows = (await client.query(PUBLIC_BUILDING_METADATA_SQL, ['shanghai'])).rows
    expect(rows.map(row => row.id)).toEqual(documents.map(doc => doc.id))
    expect(rows.every(row => mapBuildingCity({ city: row.city })?.citySlug === CITY_SHANGHAI.slug)).toBe(true)
    expect(rows.every(row => row.recommended_order === 0)).toBe(true)
  })
})

