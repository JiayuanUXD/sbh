import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const routingEnabled = process.env.MULTI_CITY_ROUTING_ENABLED === 'true'
const LISTING_SLUG = 'jingan-serviced-office-42-seats'
const BUILDING_SLUG = 'west-nanjing-premium-center'
const CITY_HOMES = [
  ['shanghai', '上海', 'live'],
  ['hangzhou', '杭州', 'coming-soon'],
  ['ningbo', '宁波', 'coming-soon'],
  ['suzhou', '苏州', 'coming-soon'],
  ['nanjing', '南京', 'coming-soon'],
  ['jiaxing', '嘉兴', 'coming-soon'],
  ['wuxi', '无锡', 'coming-soon'],
] as const
const KNOWN_UNAVAILABLE_SEED_MEDIA = [
  'cover-changning-hongqiao-3.jpg',
  'cover-empty-building.jpg',
  'cover-huangpu-bund-3.jpg',
  'cover-lujiazui-grade-a-river-view-3.jpg',
  'cover-west-nanjing-premium-center-3.jpg',
  'cover-xuhui-xujiahui-3.jpg',
  'hero-bg.mp4',
] as const

const browserErrors = new WeakMap<Page, string[]>()

async function stubKnownUnavailableSeedMedia(page: Page): Promise<void> {
  for (const filename of KNOWN_UNAVAILABLE_SEED_MEDIA) {
    await page.route(`**/api/media/file/${filename}?*`, (route) =>
      route.fulfill({ status: 204, body: '' }))
  }
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  await stubKnownUnavailableSeedMedia(page)
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([])
})

async function expectCanonical(page: Page, expected: string): Promise<void> {
  const href = await page.locator('link[rel="canonical"]').getAttribute('href')
  expect(href).not.toBeNull()
  const canonical = new URL(href!, page.url())
  expect(`${canonical.pathname}${canonical.search}`).toBe(expected)
}

async function expectRedirect(
  request: APIRequestContext,
  source: string,
  destination: string,
): Promise<void> {
  const response = await request.get(source, { maxRedirects: 0 })
  expect(response.status(), source).toBe(307)
  expect(response.headers().location, source).toBe(destination)
}

test.describe('multi-city route ownership', () => {
  for (const [slug, name, status] of CITY_HOMES) {
    test(`${slug} home is public with exact canonical ownership`, async ({ page }) => {
      const response = await page.goto(`/${slug}`)

      expect(response?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.locator('.city-switcher__trigger')).toContainText(name)
      await expectCanonical(page, routingEnabled ? `/${slug}` : '/')
      const robots = page.locator('meta[name="robots"]')
      if (status === 'coming-soon' || !routingEnabled) {
        await expect(robots).toHaveAttribute('content', /noindex/i)
      } else {
        await expect(robots).toHaveAttribute('content', /index/i)
        await expect(robots).not.toHaveAttribute('content', /noindex/i)
      }
    })
  }

  test('unknown and profile-less city is a real 404', async ({ request }) => {
    expect((await request.get('/wuhan', { maxRedirects: 0 })).status()).toBe(404)
    expect((await request.get('/wuhan/listings', { maxRedirects: 0 })).status()).toBe(404)
  })

  test('five reserved global routes cannot be captured as city homes', async ({ request }) => {
    const expected = new Map<string, number>([
      ['/news', 200],
      ['/pages/privacy', 200],
      ['/entrust', 200],
      ['/publish', 200],
      ['/city-partner', 200],
    ])
    for (const [path, status] of expected) {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.status(), path).toBe(status)
    }
  })

  test('legacy roots have exact flag-dependent status and Location', async ({ request }) => {
    if (routingEnabled) {
      await expectRedirect(request, '/', '/shanghai')
      await expectRedirect(request, '/listings', '/shanghai/listings')
      await expectRedirect(request, '/buildings', '/shanghai/buildings')
      await expectRedirect(
        request,
        '/listings?district=pudong&areaMin=100&page=3&rentMax=10',
        '/shanghai/listings?areaMin=100&rentMax=10',
      )
      return
    }

    for (const path of ['/', '/listings', '/buildings']) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200)
    }
  })

  test('legacy and wrong-city detail redirects use DTO identity exactly', async ({ request }) => {
    if (!routingEnabled) {
      const listing = await request.get(`/listings/${LISTING_SLUG}`, { maxRedirects: 0 })
      const building = await request.get(`/buildings/${BUILDING_SLUG}`, { maxRedirects: 0 })
      expect(listing.status()).toBe(200)
      expect(building.status()).toBe(200)
      await expectRedirect(
        request,
        `/hangzhou/buildings/${BUILDING_SLUG}`,
        `/shanghai/buildings/${BUILDING_SLUG}`,
      )
      return
    }

    await expectRedirect(
      request,
      `/listings/${LISTING_SLUG}`,
      `/shanghai/listings/${LISTING_SLUG}`,
    )
    await expectRedirect(
      request,
      `/hangzhou/listings/${LISTING_SLUG}`,
      `/shanghai/listings/${LISTING_SLUG}`,
    )
    await expectRedirect(
      request,
      `/buildings/${BUILDING_SLUG}`,
      `/shanghai/buildings/${BUILDING_SLUG}`,
    )
    await expectRedirect(
      request,
      `/hangzhou/buildings/${BUILDING_SLUG}`,
      `/shanghai/buildings/${BUILDING_SLUG}`,
    )
  })

  test('query canonical retains valid filters and strips unknown values', async ({ page }) => {
    const response = await page.goto(
      '/shanghai/listings?district=pudong&areaMin=100&page=3&rentMax=10&unknown=drop',
    )
    expect(response?.status()).toBe(200)
    await expectCanonical(
      page,
      routingEnabled
        ? '/shanghai/listings?district=pudong&areaMin=100&rentMax=10&page=3'
        : '/listings?district=pudong&areaMin=100&rentMax=10&page=3',
    )
  })
})
