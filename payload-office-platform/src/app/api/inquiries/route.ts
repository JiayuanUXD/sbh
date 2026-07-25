import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import { validateInquiry } from '@/lib/frontend/validation'
import { checkRateLimit, type RateLimitStore } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Per-process store. On CloudRun's multi-instance runtime each instance keeps
// its own window — basic abuse mitigation, not a global quota (see rate-limit.ts).
const rateStore: RateLimitStore = new Map()
const RATE_LIMIT = { windowMs: 60_000, max: 5 }

function clientIp(req: Request): string {
  // CloudRun / proxies set x-forwarded-for; take the first hop. Fall back to a
  // shared bucket when absent so a spoofed-empty header can't bypass the limit.
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

export async function POST(req: Request) {
  const rate = checkRateLimit(rateStore, clientIp(req), Date.now(), RATE_LIMIT)
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds) } },
    )
  }

  // 请求体视为 unknown，由 schema 白名单收窄
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const result = validateInquiry(body as Parameters<typeof validateInquiry>[0])
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 })
  }

  const payload = await getPayload({ config })

  // Resolve the listing by slug so we can link it.
  const listing = await payload.find({
    collection: 'listings',
    where: { slug: { equals: result.data.listingSlug } },
    limit: 1,
    depth: 0,
  })
  const listingDoc = listing.docs[0]
  if (!listingDoc) {
    return NextResponse.json({ ok: false, error: 'listing_not_found' }, { status: 404 })
  }

  try {
    const lead = await payload.create({
      collection: 'leads',
      data: {
        name: result.data.name,
        phone: result.data.phone,
        status: 'new',
        source: 'frontend-form',
        interestedListing: listingDoc.id,
        notes: result.data.message,
      },
    })
    return NextResponse.json({ ok: true, id: lead.id })
  } catch (e) {
    payload.logger.error({ err: e }, 'inquiry create failed')
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 })
  }
}
