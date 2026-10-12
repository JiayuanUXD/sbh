import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload } from 'payload'
import config from '@/payload.config'
import { buildListingFacetsQuery, buildListingPageQuery, buildRecommendationCandidatesQuery } from '@/domain/public-catalog/listing-query-sql'
import { applyMemoryFilters, computeFacets, rowFromListing, rowToCandidate, selectListingPage } from '@/domain/public-catalog/listing-scan'
import { parseSearchInput } from '@/domain/public-catalog/facade'
import { createSearchContext } from '@/domain/public-catalog/types'
import { DISPLAY_UNIT_BY_PERIOD_BASIS } from '@/domain/public-catalog/mappers'

const databaseAvailable = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.startsWith('postgres')
const asOf = new Date('2026-10-12T00:00:00.000Z')
const district = { id: 2, slug: 'district', name: '测试区' }
const area = { id: 3, slug: 'area', name: '测试商圈' }
const structured = Object.entries(DISPLAY_UNIT_BY_PERIOD_BASIS).flatMap(([period, bases]) =>
  Object.entries(bases).map(([basis, displayUnit]) => ({ period, unit: basis === 'total' ? 'suite' : basis, displayUnit })),
)

// 单连接事务内 TEMP 表遮蔽正式表；不创建迁移、不修改持久数据。
describe.skipIf(!databaseAvailable)('数据库目录与扫描语义逐项一致', () => {
  let client: {
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
    release(): void
  }
  const docs: Record<string, unknown>[] = []
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
      CREATE TEMP TABLE listings_building_form (parent_id int, value text, "order" int) ON COMMIT DROP;
      CREATE TEMP TABLE listings (id int, building_id int, merchant_id int, title text, business_type text,
        listing_type text, area numeric, available_from timestamptz, is_featured boolean, updated_at timestamptz,
        publication_status text, review_status text, supply_visibility_hold text, deleted_at timestamptz,
        price_amount numeric, price_currency text, price_period text, price_unit text, rent numeric, rent_unit text) ON COMMIT DROP;
      INSERT INTO locations VALUES (1,'shanghai','上海','active'),(2,'district','测试区','active'),
        (3,'area','测试商圈','active'),(4,'metro','测试地铁','active'),(5,'hangzhou','杭州','active');
      INSERT INTO buildings VALUES (1,1,2,3,4,'虹桥测试楼盘','published','active',NULL),
        (2,5,2,3,4,'杭州楼盘','published','active',NULL), (3,1,2,3,4,'停用楼盘','published','disabled',NULL);
      INSERT INTO merchants VALUES (1,'active','valid',NULL), (2,'disabled','valid',NULL),
        (3,'active','valid','2026-10-11'),(4,'active','valid',NULL),(5,'active','invalid',NULL),
        (6,'active','valid','2026-10-12T00:00:00Z');
      INSERT INTO merchants_rels VALUES (1,'serviceCities',1),(1,'serviceCities',5),
        (2,'serviceCities',1),(3,'serviceCities',1),(5,'serviceCities',1),(6,'serviceCities',1);`)
    const variants: Array<Record<string, unknown>> = [
      ...structured.map((price, index) => ({ price: { ...price, amount: index + 1, currency: 'CNY' } })),
      { rent: 6, rentUnit: 'rmb-sqm-day' }, { rent: 12, rentUnit: 'rmb-month' },
      { rent: 18, rentUnit: 'rmb-seat-month' }, {},
      { price: { amount: -1, currency: 'CNY', period: 'month', unit: 'suite' }, rent: 4, rentUnit: 'rmb-sqm-day' },
      { price: { amount: 12, currency: 'USD', period: 'month', unit: 'suite' }, rent: 3, rentUnit: 'rmb-month' },
      { price: { amount: 0, currency: 'CNY', period: 'month', unit: 'suite' }, businessType: 'sale' },
      { merchant: 6 },
    ]
    for (const [index, variant] of variants.entries()) {
      const id = index + 1
      const doc = { id, slug: `fixture-${id}`, title: id % 2 ? '虹桥房源' : '测试房源',
        listingType: id % 2 ? 'traditional-office' : 'coworking', businessType: 'lease',
        area: id * 10, isFeatured: id % 3 === 0, updatedAt: `2026-10-01T00:00:00.00${id % 2}Z`,
        availableFrom: id % 2 ? null : '2026-12-01T00:00:00Z',
        building: { id: 1, district, businessDistrict: area }, buildingForm: id % 2 ? ['detached', 'park'] : ['park'],
        ...variant }
      docs.push(doc)
      const price = variant.price as Record<string, unknown> | undefined
      await client.query(`INSERT INTO listings VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,
        'published','approved','normal',NULL,$10,$11,$12,$13,$14,$15)`,
      [id, variant.merchant ?? 1, doc.title, doc.businessType, doc.listingType, doc.area, doc.availableFrom,
        doc.isFeatured, doc.updatedAt, price?.amount ?? null, price?.currency ?? null,
        price?.period ?? null, price?.unit ?? null, variant.rent ?? null, variant.rentUnit ?? null])
      for (const [order, value] of doc.buildingForm.entries()) {
        await client.query('INSERT INTO listings_building_form VALUES ($1,$2,$3)', [id, value, order])
      }
    }
    // 每个失效变体都来自同一条合格记录，确保排除不是别的条件意外造成。
    const invalid = ["publication_status='draft'", "review_status='pending'", "supply_visibility_hold='review'",
      "deleted_at='2026-10-01'", 'merchant_id=NULL', 'merchant_id=2', 'merchant_id=3', 'merchant_id=4',
      'merchant_id=5', 'building_id=3', 'building_id=2', 'id=id']
    for (const [index, mutation] of invalid.entries()) {
      const id = 100 + index
      await client.query(`INSERT INTO listings SELECT * FROM listings WHERE id=1`)
      // 新副本先通过 ctid 定位，随后固定独立 ID；原记录不受影响。
      await client.query('UPDATE listings SET id=$1 WHERE ctid=(SELECT ctid FROM listings WHERE id=1 ORDER BY ctid DESC LIMIT 1)', [id])
      await client.query(`UPDATE listings SET ${mutation} WHERE id=$1`, [id])
    }
    await client.query('INSERT INTO listing_reports VALUES (111,true)')
  }, 60000)
  afterAll(async () => {
    if (client) {
      try { await client.query('ROLLBACK') } finally { client.release() }
    }
  })

  const cases = ['', 'sort=newest', 'page=2', 'page=999', 'sort=price-asc', 'sort=price-desc',
    'type=coworking', 'form=detached', 'form=detached,park', 'district=district', 'district=missing',
    'businessArea=area', 'metro=metro', 'metro=missing', 'areaMin=30&areaMax=80',
    'availableBefore=2026-11-01', 'q=虹桥', 'q=测试区', 'q=测试商圈', 'q=测试地铁', 'q=不存在', 'priceMin=1&priceMax=5',
    ...structured.flatMap(({ displayUnit }) => [`priceUnit=${displayUnit}`, `priceUnit=${displayUnit}&sort=price-asc`,
      `priceUnit=${displayUnit}&sort=price-desc`, `priceUnit=${displayUnit}&priceMin=0&priceMax=5`])]
  for (const businessType of ['lease', 'sale'] as const) {
    it.each(cases)(`${businessType} / %s`, async query => {
      const input = parseSearchInput(new URLSearchParams(query))
      const ctx = createSearchContext('shanghai', asOf, businessType)
      const rows = docs.filter(doc => doc.businessType === businessType)
        .filter(doc => !input.metro?.length || input.metro.includes('metro'))
        .filter(doc => (input.areaMin == null || Number(doc.area) >= input.areaMin) &&
          (input.areaMax == null || Number(doc.area) <= input.areaMax))
        .filter(doc => !input.availableBefore || doc.availableFrom == null ||
          Date.parse(String(doc.availableFrom)) <= Date.parse(input.availableBefore))
        .filter(doc => !input.q || [String(doc.title), '虹桥测试楼盘', district.name, area.name, '测试地铁']
          .some(name => name.includes(input.q!)))
        .flatMap(doc => { const row = rowFromListing(doc); return row ? [row] : [] })
      const pageQuery = buildListingPageQuery(input, ctx)
      const page = (await client.query(pageQuery.text, pageQuery.values)).rows[0]
      const expected = selectListingPage(rows, input)
      expect(page.ids).toEqual(expected.ids)
      expect(page.total).toEqual(expected.pagination.totalDocs)
      expect(page.filtered).toEqual(expected.filteredByRentUnit)
      const facetQuery = buildListingFacetsQuery(input, ctx)
      expect((await client.query(facetQuery.text, facetQuery.values)).rows[0].facets)
        .toEqual(computeFacets(applyMemoryFilters(rows, input)))
    })
  }

  it('推荐候选 SQL 在商圈、行政区、楼盘三档范围下与扫描行字段严格一致且排除全部失效供给', async () => {
    const ctx = createSearchContext('shanghai', asOf, 'lease')
    const expected = docs
      .filter(doc => doc.businessType === 'lease')
      .flatMap(doc => { const row = rowFromListing(doc); return row ? [rowToCandidate(row)] : [] })
      .map(c => ({
        id: c.id,
        listing_type: c.listingType,
        business_type: c.businessType,
        area: c.area,
        price_amount: c.priceAmount,
        price_unit: c.priceUnit,
        district_id: c.buildingDistrictId,
        business_district_id: c.buildingBusinessDistrictId,
      }))

    for (const scope of [
      { businessDistrictId: area.id, districtId: district.id, buildingId: 1 },
      { businessDistrictId: null, districtId: district.id, buildingId: 1 },
      { businessDistrictId: null, districtId: null, buildingId: 1 },
    ]) {
      const q = buildRecommendationCandidatesQuery(scope, ctx)!
      const actual = (await client.query(q.text, q.values)).rows
      expect(actual).toEqual(expected)
    }
  })
})


