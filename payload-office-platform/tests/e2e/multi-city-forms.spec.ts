import { expect, test, type Page } from '@playwright/test'
import { createRequire } from 'node:module'

type QueryResult = Readonly<{ rows: unknown[] }>
type QueryPool = Readonly<{
  query: (sql: string, values?: unknown[]) => Promise<QueryResult>
  end: () => Promise<void>
}>
type PoolConstructor = new (options: Readonly<{ connectionString: string }>) => QueryPool

const localRequire = createRequire(import.meta.url)
const adapterRequire = createRequire(localRequire.resolve('@payloadcms/db-postgres'))
const pgModule = adapterRequire('pg') as unknown

function resolvePoolConstructor(moduleValue: unknown): PoolConstructor {
  if (
    typeof moduleValue === 'object'
    && moduleValue !== null
    && 'Pool' in moduleValue
    && typeof moduleValue.Pool === 'function'
  ) {
    return moduleValue.Pool as PoolConstructor
  }
  throw new Error('postgres_pool_unavailable')
}

const Pool = resolvePoolConstructor(pgModule)

process.loadEnvFile('.env.local')

const databaseUrl = process.env.DATABASE_URL
const flagSuffix = process.env.MULTI_CITY_ROUTING_ENABLED === 'true' ? '2' : '1'
const uuid = `00000000-0000-4000-8000-00000000000${flagSuffix}`
const requestIds = {
  demand: `entrust-${uuid}`,
  supply: `publish-${uuid}`,
  partner: `city-partner-${uuid}`,
} as const
const phones = {
  demand: `1390000000${flagSuffix}`,
  supply: `1380000000${flagSuffix}`,
  partner: `1370000000${flagSuffix}`,
} as const

let pool: QueryPool | undefined

async function rows(sql: string, values: readonly unknown[] = []) {
  if (!pool) throw new Error('postgres_pool_not_initialized')
  const result = await pool.query(sql, [...values])
  return result.rows as Array<Record<string, unknown>>
}

async function cleanupFixtures(): Promise<void> {
  if (!pool) return
  const partner = await rows(
    'SELECT id FROM city_partner_applications WHERE request_id = $1',
    [requestIds.partner],
  )
  for (const row of partner) {
    const applicationId = String(row.id)
    const eventId = `city-partner-application-created:${applicationId}`
    await pool.query("DELETE FROM payload_jobs WHERE input ->> 'eventId' = $1", [eventId])
    await pool.query('DELETE FROM domain_events WHERE event_id = $1', [eventId])
  }
  await pool.query('DELETE FROM city_partner_applications WHERE request_id = $1', [requestIds.partner])
  await pool.query('DELETE FROM supply_submissions WHERE request_id = $1', [requestIds.supply])
  await pool.query('DELETE FROM leads WHERE request_id = $1', [requestIds.demand])
}

async function installFixtureIdentity(page: Page, phone: string): Promise<void> {
  await page.context().setExtraHTTPHeaders({
    'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 240) + 10}`,
  })
  await page.addInitScript(({ fixedUuid }) => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: () => fixedUuid,
    })
  }, { fixedUuid: uuid })
  await page.addInitScript(({ fixturePhone }) => {
    Object.defineProperty(globalThis, '__MCF_FIXTURE_PHONE__', { value: fixturePhone })
  }, { fixturePhone: phone })
}

test.beforeAll(async () => {
  expect(databaseUrl, 'DATABASE_URL must be loaded from .env.local for relationship assertions').toMatch(/^postgres/)
  pool = new Pool({ connectionString: databaseUrl! })
  await cleanupFixtures()
})

test.afterAll(async () => {
  await cleanupFixtures()
  await pool?.end()
})

test('Entrust stage one persists the Hangzhou city relationship', async ({ page }) => {
  await installFixtureIdentity(page, phones.demand)
  await page.goto('/entrust?city=hangzhou')
  await expect(page.getByLabel('服务城市')).toHaveValue('hangzhou')
  await page.getByLabel('手机号').fill(phones.demand)
  await page.getByRole('button', { name: '免费委托', exact: true }).click()
  await expect(page.locator('.entrust-form__success')).toContainText('已收到您的委托')

  const result = await rows(`
    SELECT l.request_id, c.slug AS city_slug
    FROM leads l JOIN locations c ON c.id = l.city_id
    WHERE l.request_id = $1
  `, [requestIds.demand])
  expect(result).toEqual([{ request_id: requestIds.demand, city_slug: 'hangzhou' }])
})

test('Publish persists only a Hangzhou supply submission relationship', async ({ page }) => {
  await installFixtureIdentity(page, phones.supply)
  await page.goto('/publish?city=hangzhou')
  await expect(page.getByLabel('服务城市')).toHaveValue('hangzhou')
  await page.getByLabel('楼盘名称').fill('MCF-04 测试楼盘')
  await page.getByLabel('详细地址').fill('测试地址 04 号')
  await page.getByLabel('出租面积').fill('188')
  await page.getByLabel('手机号').fill(phones.supply)
  await page.getByRole('button', { name: '立即投放' }).click()
  await expect(page.getByRole('status')).toContainText('已收到您的房源')

  const result = await rows(`
    SELECT s.request_id, c.slug AS city_slug
    FROM supply_submissions s JOIN locations c ON c.id = s.city_id
    WHERE s.request_id = $1
  `, [requestIds.supply])
  expect(result).toEqual([{ request_id: requestIds.supply, city_slug: 'hangzhou' }])
})

test('City Partner stages persist Hangzhou without auto-converting business records', async ({ page }) => {
  await installFixtureIdentity(page, phones.partner)
  const before = await rows(`
    SELECT
      (SELECT count(*)::int FROM leads) AS leads,
      (SELECT count(*)::int FROM supply_submissions) AS supply,
      (SELECT count(*)::int FROM buildings) AS buildings,
      (SELECT count(*)::int FROM listings) AS listings
  `)
  await page.goto('/city-partner?city=hangzhou')
  await page.getByLabel('姓名').fill('MCF 测试申请')
  await page.getByLabel('手机号').fill(phones.partner)
  await page.getByLabel('合作身份').selectOption('local-operations')
  await page.getByLabel(/我已阅读并同意/).check()
  await page.getByRole('button', { name: '保存并继续' }).click()
  await expect(page.getByRole('heading', { name: '补充合作信息（可选）' })).toBeVisible()
  await page.getByLabel('机构名称').fill('MCF 测试机构')
  await page.getByLabel('本地运营团队').check()
  await page.getByRole('button', { name: '提交补充信息' }).click()
  await expect(page.getByRole('status')).toContainText('申请已收到')

  const application = await rows(`
    SELECT a.request_id, a.status, a.details_completed_at, c.slug AS city_slug
    FROM city_partner_applications a JOIN locations c ON c.id = a.city_id
    WHERE a.request_id = $1
  `, [requestIds.partner])
  expect(application).toEqual([
    expect.objectContaining({ request_id: requestIds.partner, status: 'pending', city_slug: 'hangzhou' }),
  ])
  expect(application[0]?.details_completed_at).not.toBeNull()
  const after = await rows(`
    SELECT
      (SELECT count(*)::int FROM leads) AS leads,
      (SELECT count(*)::int FROM supply_submissions) AS supply,
      (SELECT count(*)::int FROM buildings) AS buildings,
      (SELECT count(*)::int FROM listings) AS listings
  `)
  expect(after).toEqual(before)
})
