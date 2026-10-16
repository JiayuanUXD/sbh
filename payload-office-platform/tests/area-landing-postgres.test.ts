import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { buildAreaLandingStatsQuery } from '@/domain/public-catalog/area-landing-sql'
import { createSearchContext } from '@/domain/public-catalog/types'

const databaseAvailable = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')
const asOf = new Date('2026-10-16T00:00:00.000Z')

type Row = {
  kind: string; slug: string; parent_slug: string | null; listing_count: number; building_count: number
  price_sample_count: number; price_min: number | null; price_p25: number | null; price_median: number | null
  price_p75: number | null; price_max: number | null; other_unit_count: number; area_median: number | null
  last_updated_at: Date | null
}

// 单连接事务内 TEMP 表遮蔽正式表（同 listing-query-postgres.test.ts）：不建迁移、不改持久数据。
describe.skipIf(!databaseAvailable)('区域落地页统计在真实 PostgreSQL 上的语义', () => {
  let client: {
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
    release(): void
  }
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!)
    if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) throw new Error('SQL 夹具只允许本地隔离库')
    const payload = await getPayload({ config })
    client = await payload.db.pool.connect()
    await client.query('BEGIN')
    await client.query(`CREATE TEMP TABLE locations (id int, slug text, name text, status text) ON COMMIT DROP;
      CREATE TEMP TABLE buildings (id int, city_id int, district_id int, business_district_id int,
        nearest_metro_id int, name text, status text, operational_status text, deleted_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE merchants (id int, status text, qualification_status text, qualification_expires_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE merchants_rels (parent_id int, path text, locations_id int) ON COMMIT DROP;
      CREATE TEMP TABLE listing_reports (target_listing_id int, supply_paused boolean) ON COMMIT DROP;
      CREATE TEMP TABLE listings (id int, building_id int, merchant_id int, title text, business_type text,
        listing_type text, area numeric, available_from timestamptz, is_featured boolean, updated_at timestamptz,
        publication_status text, review_status text, supply_visibility_hold text, deleted_at timestamptz,
        price_amount numeric, price_currency text, price_period text, price_unit text, rent numeric, rent_unit text) ON COMMIT DROP;
      INSERT INTO locations VALUES (1,'shanghai','上海','active'),(2,'xuhui','徐汇区','active'),
        (3,'caohejing','漕河泾','active'),(4,'longhua','龙华','active'),(5,'hangzhou','杭州','active');
      -- 楼盘 1、2 在徐汇（分别属漕河泾 / 龙华），楼盘 3 在徐汇但无商圈，楼盘 4 在杭州
      INSERT INTO buildings VALUES (1,1,2,3,NULL,'甲楼','published','active',NULL),
        (2,1,2,4,NULL,'乙楼','published','active',NULL), (3,1,2,NULL,NULL,'丙楼','published','active',NULL),
        (4,5,2,3,NULL,'杭州楼','published','active',NULL);
      INSERT INTO merchants VALUES (1,'active','valid',NULL);
      INSERT INTO merchants_rels VALUES (1,'serviceCities',1),(1,'serviceCities',5);`)
    // 日单价 1~5（building 1），另有一条月租总价、一条面议、一条草稿、一条已出租到杭州的楼盘
    let id = 0
    const insert = async (building: number, extra: string, price: unknown[], area = 100, updated = '2026-10-10T00:00:00Z') => {
      id += 1
      await client.query(`INSERT INTO listings VALUES ($1,$2,1,'t','lease','traditional-office',$3,NULL,false,$4,
        'published','approved','normal',NULL,${extra})`, [id, building, area, updated, ...price])
    }
    for (const amount of [1, 2, 3, 4, 5]) {
      await insert(1, "$5,'CNY','day','sqm',NULL,NULL", [amount], 100 * amount, `2026-10-0${amount}T00:00:00Z`)
    }
    await insert(2, "$5,'CNY','month','total',NULL,NULL", [20000])
    await insert(2, 'NULL,NULL,NULL,NULL,NULL,NULL', [])
    await insert(3, "$5,'CNY','day','sqm',NULL,NULL", [10], 100, '2026-10-12T00:00:00Z')
    await insert(4, "$5,'CNY','day','sqm',NULL,NULL", [99])
    await client.query("UPDATE listings SET publication_status='draft' WHERE id=1")
  }, 60000)
  afterAll(async () => {
    if (client) {
      try { await client.query('ROLLBACK') } finally { client.release() }
    }
  })

  async function stats() {
    const query = buildAreaLandingStatsQuery(createSearchContext('shanghai', asOf, 'lease'))
    return (await client.query(query.text, query.values)).rows as unknown as Row[]
  }

  it('行政区行：只数有效房源（草稿与他城楼盘排除），分位数只用 元/㎡/天', async () => {
    const district = (await stats()).find((row) => row.kind === 'district' && row.slug === 'xuhui')!
    // 有效：日单价 2,3,4,5（楼盘 1）+ 10（楼盘 3）；月租总价与面议（楼盘 2）只计 other_unit_count
    expect(district.listing_count).toBe(7)
    expect(district.building_count).toBe(3)
    expect(district.price_sample_count).toBe(5)
    expect(district.other_unit_count).toBe(2)
    expect(district.price_min).toBe(2)
    expect(district.price_max).toBe(10)
    expect(district.price_median).toBe(4)
    expect(district.price_p25).toBe(3)
    expect(district.price_p75).toBe(5)
  })

  it('商圈行：只含挂了该商圈的楼盘，并带上所属行政区', async () => {
    const rows = await stats()
    const caohejing = rows.find((row) => row.kind === 'business_area' && row.slug === 'caohejing')!
    expect(caohejing.parent_slug).toBe('xuhui')
    expect(caohejing.listing_count).toBe(4)
    expect(caohejing.price_sample_count).toBe(4)
    const longhua = rows.find((row) => row.kind === 'business_area' && row.slug === 'longhua')!
    expect(longhua.listing_count).toBe(2)
    expect(longhua.price_sample_count).toBe(0)
    expect(longhua.price_median).toBeNull()
    // 无商圈的楼盘不产生商圈行
    expect(rows.filter((row) => row.kind === 'business_area')).toHaveLength(2)
  })

  it('last_updated_at 是该区域有效房源 updated_at 的最大值（真实时间，不是请求时刻）', async () => {
    const district = (await stats()).find((row) => row.kind === 'district' && row.slug === 'xuhui')!
    expect(new Date(district.last_updated_at!).toISOString()).toBe('2026-10-12T00:00:00.000Z')
  })

  it('面积中位数按有效房源计算', async () => {
    const caohejing = (await stats()).find((row) => row.kind === 'business_area' && row.slug === 'caohejing')!
    expect(caohejing.area_median).toBe(350)
  })
})
