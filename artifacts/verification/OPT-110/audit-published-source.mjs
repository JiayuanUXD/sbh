import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
const appRequire = createRequire(new URL('../../../payload-office-platform/package.json', import.meta.url))
const postgresRequire = createRequire(appRequire.resolve('@payloadcms/db-postgres'))
const { Client } = postgresRequire('pg')
const url = new URL(process.env.DATABASE_URL ?? '')
url.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=60000')
const client = new Client({ connectionString: url.toString() })
try {
  await client.connect()
  if ((await client.query('SHOW default_transaction_read_only')).rows[0]?.default_transaction_read_only !== 'on') throw new Error('Read-only guard failed')
  const buildings = (await client.query(`SELECT COUNT(*)::int AS total,
    COUNT(DISTINCT data_source_external_id)::int AS unique_ids,
    COUNT(*) FILTER (WHERE status='published' AND operational_status='active' AND deleted_at IS NULL)::int AS published
    FROM buildings WHERE data_source_source=$1`, ['huizuxuanzhi'])).rows[0]
  const listings = (await client.query(`SELECT COUNT(*)::int AS total,
    COUNT(DISTINCT data_source_external_id)::int AS unique_ids,
    COUNT(*) FILTER (WHERE publication_status='published' AND review_status='approved')::int AS published,
    COUNT(*) FILTER (WHERE publication_status='draft')::int AS drafts,
    COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
    COUNT(*) FILTER (WHERE supply_visibility_hold IS DISTINCT FROM 'normal')::int AS held,
    COUNT(*) FILTER (WHERE publication_status='leased')::int AS leased,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM listing_reports r WHERE r.target_listing_id=l.id AND r.supply_paused=true))::int AS paused
    FROM listings l WHERE data_source_source=$1`, ['huizuxuanzhi'])).rows[0]
  const reviews = (await client.query(`SELECT COUNT(*)::int AS with_fast_track_review
    FROM listings l WHERE data_source_source=$1 AND EXISTS (SELECT 1 FROM listing_reviews r
      WHERE r.listing_id=l.id AND r.decision='fast_track' AND r.reviewed_by_id IS NOT NULL)`, ['huizuxuanzhi'])).rows[0]
  const result = { at: new Date().toISOString(), buildings, listings, reviews }
  console.log(JSON.stringify(result))
  if (buildings.total !== 4442 || buildings.unique_ids !== 4442 || buildings.published !== 4442 ||
    listings.total !== 57500 || listings.unique_ids !== 57500 || listings.published !== 57500 ||
    listings.drafts || listings.deleted || listings.held || listings.leased || listings.paused || reviews.with_fast_track_review !== 55381) {
    throw new Error('Published source audit mismatch')
  }
  await writeFile(new URL('./final-source-audit.json', import.meta.url), JSON.stringify(result, null, 2) + '\n')
  const buildingUrls = (await client.query(`SELECT 'https://shangban.cc/' || c.slug || '/buildings/' || b.slug AS url
    FROM buildings b JOIN locations c ON c.id=b.city_id
    WHERE b.data_source_source=$1 ORDER BY b.id`, ['huizuxuanzhi'])).rows.map(row => row.url)
  const listingUrls = (await client.query(`SELECT 'https://shangban.cc/' || c.slug || '/listings/' || l.slug AS url
    FROM listings l JOIN buildings b ON b.id=l.building_id JOIN locations c ON c.id=b.city_id
    WHERE l.data_source_source=$1 ORDER BY l.id`, ['huizuxuanzhi'])).rows.map(row => row.url)
  if (buildingUrls.length !== 4442 || new Set(buildingUrls).size !== 4442 ||
    listingUrls.length !== 57500 || new Set(listingUrls).size !== 57500 ||
    [...buildingUrls, ...listingUrls].some(url => !url || !url.startsWith('https://shangban.cc/'))) {
    throw new Error('Source URL audit mismatch')
  }
  await writeFile(new URL('./published-source-urls.json', import.meta.url),
    JSON.stringify({ at: result.at, buildings: buildingUrls, listings: listingUrls }, null, 2) + '\n')
} finally { await client.end() }
