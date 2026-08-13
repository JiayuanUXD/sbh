import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY } from '@/domain/city-partner-application/application-protect'
import {
  CITY_PARTNER_NOTIFICATION_TASK,
  reconcileCityPartnerNotificationOutbox,
} from '@/domain/city-partner-application/application-notify'

const databaseAvailable = typeof process.env.DATABASE_URL === 'string' &&
  process.env.DATABASE_URL.startsWith('postgres')

describe.skipIf(!databaseAvailable)('city partner notification PostgreSQL outbox recovery', () => {
  let payload: Payload
  let applicationId: number | null = null
  let stableEventId = ''

  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  afterAll(async () => {
    const jobs = stableEventId
      ? await payload.find({
          collection: 'payload-jobs',
          where: { 'input.eventId': { equals: stableEventId } },
          limit: 20,
          depth: 0,
          overrideAccess: true,
        })
      : { docs: [] }
    for (const job of jobs.docs) {
      await payload.delete({ collection: 'payload-jobs', id: job.id, overrideAccess: true })
    }
    const events = stableEventId
      ? await payload.find({
          collection: 'domain-events',
          where: { eventId: { equals: stableEventId } },
          limit: 20,
          depth: 0,
          overrideAccess: true,
        })
      : { docs: [] }
    for (const event of events.docs) {
      await payload.delete({ collection: 'domain-events', id: event.id, overrideAccess: true })
    }
    if (applicationId !== null) {
      await payload.delete({
        collection: 'city-partner-applications', id: applicationId, overrideAccess: true,
      })
    }
  })

  it('recovers a durable committed event and concurrent scans persist exactly one active notify job', async () => {
    const cityResult = await payload.find({
      collection: 'locations',
      where: { and: [{ type: { equals: 'city' } }, { status: { equals: 'active' } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const city = cityResult.docs[0]
    expect(city).toBeDefined()
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const req = await createLocalReq({
      context: { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-one' },
    }, payload)
    const application = await payload.create({
      collection: 'city-partner-applications',
      data: {
        city: city!.id,
        applicantName: `outbox-${suffix}`,
        contactPhone: '19900002222',
        applicantIdentity: 'local-operations',
        status: 'pending',
        requestId: `outbox-${suffix}`,
        idempotencyKey: `outbox-${randomUUID()}`,
        sourcePath: '/city-partner',
        consentAccepted: true,
        consentPolicyVersion: 'MVP-R1',
      },
      overrideAccess: true,
      req,
    })
    applicationId = application.id
    stableEventId = `city-partner-application-created:${application.id}`

    const preexisting = await payload.find({
      collection: 'payload-jobs',
      where: { and: [
        { taskSlug: { equals: CITY_PARTNER_NOTIFICATION_TASK } },
        { 'input.eventId': { equals: stableEventId } },
      ] },
      limit: 20,
      depth: 0,
      overrideAccess: true,
    })
    for (const job of preexisting.docs) {
      await payload.delete({ collection: 'payload-jobs', id: job.id, overrideAccess: true })
    }

    await Promise.all([
      reconcileCityPartnerNotificationOutbox(payload),
      reconcileCityPartnerNotificationOutbox(payload),
    ])
    const recovered = await payload.find({
      collection: 'payload-jobs',
      where: { and: [
        { taskSlug: { equals: CITY_PARTNER_NOTIFICATION_TASK } },
        { 'input.eventId': { equals: stableEventId } },
        { completedAt: { exists: false } },
      ] },
      limit: 20,
      depth: 0,
      overrideAccess: true,
    })
    expect(recovered.docs).toHaveLength(1)
    expect(recovered.docs[0]?.input).toEqual({ eventId: stableEventId })
    const event = await payload.find({
      collection: 'domain-events',
      where: { eventId: { equals: stableEventId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    expect(event.docs[0]?.processedAt).toBeFalsy()
  })
})
