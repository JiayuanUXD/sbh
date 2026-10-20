import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPayload } from 'payload'

import config from '@/payload.config'
import { buildSearchVocabularyQuery, type SearchVocabularyRow } from '@/domain/public-catalog/search-vocabulary-sql'

const databaseAvailable = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres'))

describe.skipIf(!databaseAvailable)('公开搜索词表 SQL', () => {
  let client: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; release(): void }

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!)
    if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
      throw new Error('SQL 夹具只允许本地隔离库')
    }
    const payload = await getPayload({ config })
    client = await payload.db.pool.connect()
    await client.query('BEGIN')
    await client.query(`
      CREATE TEMP TABLE locations (
        id int, slug text, name text, type text, status text,
        frontend_visible boolean, parent_id int
      ) ON COMMIT DROP;
      CREATE TEMP TABLE buildings (
        id int, slug text, name text, city_id int, district_id int,
        business_district_id int, status text, operational_status text, deleted_at timestamptz
      ) ON COMMIT DROP;

      INSERT INTO locations VALUES
        (100, 'shanghai', '上海', 'city', 'active', true, NULL),
        (1, 'jingan', '静安', 'district', 'active', true, 100),
        (2, 'lujiazui', '陆家嘴', 'business_area', 'active', true, 1),
        (3, 'jingansi', '静安寺', 'metro_station', 'active', true, 1),
        (4, 'hidden', '隐藏区', 'district', 'active', false, 100),
        (5, 'disabled', '停用区', 'district', 'disabled', true, 100);

      INSERT INTO buildings VALUES
        (10, 'shanghai-tower', '上海中心', 100, 1, 2, 'published', 'active', NULL),
        (11, 'draft-tower', '草稿楼', 100, 1, NULL, 'draft', 'active', NULL),
        (12, 'deleted-tower', '已删楼', 100, 1, NULL, 'published', 'active', now());
    `)
  })

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => undefined)
    client?.release()
  })

  it('只返回公开实体，并带出父级名称', async () => {
    const query = buildSearchVocabularyQuery('shanghai')
    const result = await client.query(query.text, query.values)
    const rows = result.rows as SearchVocabularyRow[]
    const names = rows.map((row) => row.name)

    expect(names).toContain('上海')
    expect(names).toContain('静安')
    expect(names).toContain('陆家嘴')
    expect(names).toContain('静安寺')
    expect(names).toContain('上海中心')

    expect(names).not.toContain('隐藏区')
    expect(names).not.toContain('停用区')
    expect(names).not.toContain('草稿楼')
    expect(names).not.toContain('已删楼')

    const building = rows.find((row) => row.name === '上海中心')
    expect(building).toMatchObject({ kind: 'building', parent_name: '陆家嘴' })
  })
})
