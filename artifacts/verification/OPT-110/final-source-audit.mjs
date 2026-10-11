import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../../payload-office-platform/package.json', import.meta.url))
const pg = createRequire(require.resolve('@payloadcms/db-postgres'))('pg')
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
const directory = process.env.PUBLICATION_AUDIT_OUTPUT_DIR ?? fileURLToPath(new URL('.', import.meta.url))
mkdirSync(directory, { recursive: true })
await client.connect()
await client.query('SET default_transaction_read_only = on')
try {
  const buildings = (await client.query("select count(*)::int total,count(distinct data_source_external_id)::int unique_ids,count(*) filter(where status='published' and operational_status='active' and deleted_at is null)::int published from buildings where data_source_source='huizuxuanzhi'")).rows[0]
  const listings = (await client.query("select count(*)::int total,count(distinct data_source_external_id)::int unique_ids,count(*) filter(where publication_status='published' and review_status='approved')::int published,count(*) filter(where publication_status='draft')::int drafts,count(*) filter(where deleted_at is not null)::int deleted,count(*) filter(where supply_visibility_hold<>'normal')::int held,count(*) filter(where status='leased')::int leased from listings where data_source_source='huizuxuanzhi'")).rows[0]
  const reviews = (await client.query("select count(*)::int with_fast_track_review from listings l where data_source_source='huizuxuanzhi' and exists(select 1 from listing_reviews r where r.listing_id=l.id and r.decision='fast_track' and r.reviewed_by_id is not null)")).rows[0]
  const result = { at: new Date().toISOString(), buildings, listings, reviews }
  writeFileSync(`${directory}/final-source-audit.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  if (buildings.total !== 4442 || buildings.unique_ids !== 4442 || buildings.published !== 4442 ||
      listings.total !== 57500 || listings.unique_ids !== 57500 || listings.published !== 57500 ||
      listings.drafts !== 0 || listings.deleted !== 0 || listings.held !== 0 || listings.leased !== 0 ||
      reviews.with_fast_track_review !== 55381) throw new Error('采集数据发布或审计结果不完整')
  const urls = {}
  for (const collection of ['buildings', 'listings']) {
    urls[collection] = (await client.query(`select slug from ${collection} where data_source_source='huizuxuanzhi' order by id`)).rows.map(row => `https://shangban.cc/shanghai/${collection}/${row.slug}`)
  }
  writeFileSync(`${directory}/published-source-urls.json`, JSON.stringify(urls))
} finally {
  await client.end()
}
