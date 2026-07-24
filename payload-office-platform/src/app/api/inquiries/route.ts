import { getPayload } from 'payload'
import { NextResponse } from 'next/server'
import config from '@/payload.config'
import { validateInquiry } from '@/lib/frontend/validation'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const result = validateInquiry(body)
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
  if (!listing.docs[0]) {
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
        interestedListing: (listing.docs[0] as any).id,
        notes: result.data.message,
      },
    })
    return NextResponse.json({ ok: true, id: lead.id })
  } catch (e) {
    payload.logger.error({ err: e }, 'inquiry create failed')
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 })
  }
}
