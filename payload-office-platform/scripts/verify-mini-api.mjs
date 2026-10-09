import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const EXPECTED_CACHE_CONTROL = 'private, no-store'
const REQUEST_TIMEOUT_MS = 10_000
const baseUrl = process.argv[2] ?? 'http://localhost:3717'
const outputPath = resolve(
  process.argv[3] ?? '../artifacts/verification/MP-101/http.json',
)
const temporaryPath = `${outputPath}.${process.pid}.tmp`

await rm(outputPath, { force: true })
await rm(temporaryPath, { force: true })

function isIsoInstant(value) {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value
}

async function inspect(path, expectedStatus, expectedCode = null) {
  let response
  try {
    response = await fetch(new URL(path, baseUrl), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${path}: request failed or timed out after ${REQUEST_TIMEOUT_MS}ms: ${detail}`)
  }

  const contentType = response.headers.get('content-type') ?? '(missing)'
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    const preview = text.slice(0, 240).replaceAll(/\s+/g, ' ')
    throw new Error(
      `${path}: invalid JSON; status=${response.status}; content-type=${contentType}; body=${JSON.stringify(preview)}`,
    )
  }
  if (response.status !== expectedStatus) {
    throw new Error(
      `${path}: expected ${expectedStatus}, got ${response.status}; content-type=${contentType}`,
    )
  }
  if (expectedCode && body?.error?.code !== expectedCode) {
    throw new Error(
      `${path}: expected ${expectedCode}, got ${body?.error?.code}`,
    )
  }

  const requestId = response.headers.get('x-request-id')
  if (!requestId || body?.meta?.requestId !== requestId) {
    throw new Error(`${path}: missing or mismatched request ID`)
  }

  const cacheControl = response.headers.get('cache-control')
  const asOf = body?.meta?.asOf ?? null
  if (cacheControl !== EXPECTED_CACHE_CONTROL) {
    throw new Error(
      `${path}: expected Cache-Control ${EXPECTED_CACHE_CONTROL}, got ${cacheControl}`,
    )
  }

  if (expectedStatus === 200) {
    if (body?.ok !== true || Object.hasOwn(body, 'error')) {
      throw new Error(`${path}: successful response must contain ok=true and no error`)
    }
    if (body?.meta?.maxAgeSeconds !== 300 || !isIsoInstant(asOf)) {
      throw new Error(`${path}: invalid maxAgeSeconds or asOf`)
    }
  } else {
    if (body?.ok !== false) {
      throw new Error(`${path}: error response must contain ok=false`)
    }
  }

  return {
    path,
    status: response.status,
    requestId,
    cacheControl,
    asOf,
    errorCode: body?.error?.code ?? null,
    itemCount: Array.isArray(body?.data?.items)
      ? body.data.items.length
      : null,
    firstSlug: body?.data?.items?.[0]?.slug ?? null,
    listingSlug: body?.data?.listing?.slug ?? null,
  }
}

const home = await inspect('/api/mini/v1/home?city=shanghai', 200)
const list = await inspect(
  '/api/mini/v1/listings?city=shanghai&priceUnit=rmb-sqm-day&page=1',
  200,
)
if (!list.firstSlug) {
  throw new Error(
    'Shanghai fixture has no rmb-sqm-day listing for detail verification',
  )
}
const detail = await inspect(
  `/api/mini/v1/listings/${encodeURIComponent(list.firstSlug)}?city=shanghai`,
  200,
)
if (detail.listingSlug !== list.firstSlug) {
  throw new Error(
    `detail slug mismatch: expected ${list.firstSlug}, got ${detail.listingSlug}`,
  )
}
const invalidCity = await inspect(
  '/api/mini/v1/home?city=unknown-city',
  404,
  'city_not_found',
)
const invalidListing = await inspect(
  '/api/mini/v1/listings/not-a-real-listing?city=shanghai',
  404,
  'listing_not_found',
)

try {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        baseUrl,
        home,
        list,
        detail,
        invalidCity,
        invalidListing,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  await rename(temporaryPath, outputPath)
  console.log(outputPath)
} finally {
  await rm(temporaryPath, { force: true })
}
