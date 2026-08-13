import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import { CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY } from '@/domain/city-partner-application/application-protect'
import {
  CITY_PARTNER_NOTIFICATION_TASK,
  CITY_PARTNER_NOTIFICATION_QUEUE,
  CITY_PARTNER_NOTIFICATION_RECONCILE_TASK,
  recoverStaleCityPartnerNotificationJobs,
  reconcileCityPartnerNotificationOutbox,
} from '@/domain/city-partner-application/application-notify'

const databaseAvailable = typeof process.env.DATABASE_URL === 'string' &&
  process.env.DATABASE_URL.startsWith('postgres')

describe.skipIf(!databaseAvailable)('city partner notification PostgreSQL outbox recovery', () => {
  let payload: Payload
  let applicationId: number | null = null
  let stableEventId = ''
  const leaseJobIds: Array<number | string> = []

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
    for (const id of leaseJobIds) {
      const remaining = await payload.find({
        collection: 'payload-jobs',
        where: { id: { equals: id } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
      if (remaining.docs.length === 1) {
        await payload.delete({ collection: 'payload-jobs', id, overrideAccess: true })
      }
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

  it('atomically releases stale leases without taking fresh processing jobs', async () => {
    const now = new Date('2026-08-13T06:30:00.000Z')
    const stale = await payload.jobs.queue({
      task: CITY_PARTNER_NOTIFICATION_TASK,
      queue: CITY_PARTNER_NOTIFICATION_QUEUE,
      input: { eventId: `lease-stale-${randomUUID()}` },
      overrideAccess: true,
    })
    const fresh = await payload.jobs.queue({
      task: CITY_PARTNER_NOTIFICATION_RECONCILE_TASK,
      queue: CITY_PARTNER_NOTIFICATION_QUEUE,
      input: {},
      overrideAccess: true,
    })
    leaseJobIds.push(stale.id, fresh.id)
    await payload.update({
      collection: 'payload-jobs',
      id: stale.id,
      data: { processing: true },
      overrideAccess: true,
    })
    await payload.update({
      collection: 'payload-jobs',
      id: fresh.id,
      data: { processing: true },
      overrideAccess: true,
    })
    const pgClient = payload.db.pool
    await pgClient.query(
      `UPDATE payload_jobs SET updated_at = $1 WHERE id = $2`,
      [new Date(now.getTime() - 16 * 60 * 1_000).toISOString(), stale.id],
    )
    await pgClient.query(
      `UPDATE payload_jobs SET updated_at = $1 WHERE id = $2`,
      [new Date(now.getTime() - 14 * 60 * 1_000).toISOString(), fresh.id],
    )

    const results = await Promise.all([
      recoverStaleCityPartnerNotificationJobs(payload, now),
      recoverStaleCityPartnerNotificationJobs(payload, now),
    ])
    expect(results.reduce((sum, result) => sum + result.recovered, 0)).toBe(1)
    const persistedStale = await payload.findByID({
      collection: 'payload-jobs', id: stale.id, depth: 0, overrideAccess: true,
    })
    const persistedFresh = await payload.findByID({
      collection: 'payload-jobs', id: fresh.id, depth: 0, overrideAccess: true,
    })
    expect(persistedStale.processing).toBe(false)
    expect(persistedFresh.processing).toBe(true)
    await payload.delete({ collection: 'payload-jobs', id: stale.id, overrideAccess: true })
    await payload.delete({ collection: 'payload-jobs', id: fresh.id, overrideAccess: true })
  })
})
