import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalReq, getPayload, type Payload } from 'payload'

import config from '@/payload.config'
import {
  CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY,
} from '@/domain/city-partner-application/application-protect'
import {
  completePublicCityPartnerDetails,
  type CityPartnerDetailsInput,
} from '@/domain/city-partner-application/public-service'

const databaseAvailable = typeof process.env.DATABASE_URL === 'string' &&
  process.env.DATABASE_URL.startsWith('postgres')

describe.skipIf(!databaseAvailable)('city partner details PostgreSQL concurrency', () => {
  let payload: Payload
  const createdIds: number[] = []

  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  afterAll(async () => {
    for (const id of createdIds) {
      await payload.delete({
        collection: 'city-partner-applications',
        id,
        overrideAccess: true,
      })
    }
    if (createdIds.length > 0) {
      const remaining = await payload.find({
        collection: 'city-partner-applications',
        where: { id: { in: createdIds } },
        select: { requestId: true },
        limit: createdIds.length,
        depth: 0,
        overrideAccess: true,
      })
      expect(remaining.docs).toHaveLength(0)
    }
  })

  it('allows exactly one of two independent conflicting completions and persists its versioned markers', async () => {
    const cityResult = await payload.find({
      collection: 'locations',
      where: { and: [{ type: { equals: 'city' } }, { status: { equals: 'active' } }] },
      select: { name: true },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const city = cityResult.docs[0]
    expect(city).toBeDefined()

    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const requestId = `integration-${suffix}`
    const phoneNormalized = `199${suffix.replace(/[^0-9]/g, '').padEnd(8, '0').slice(0, 8)}`
    const stageOneReq = await createLocalReq({
      context: { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-one' },
    }, payload)
    const created = await payload.create({
      collection: 'city-partner-applications',
      data: {
        city: city!.id,
        applicantName: `integration-${suffix}`,
        contactPhone: phoneNormalized,
        applicantIdentity: 'local-operations',
        status: 'pending',
        requestId,
        idempotencyKey: `integration-${randomUUID()}`,
        sourcePath: '/city-partner',
        consentAccepted: true,
        consentPolicyVersion: 'MVP-R1',
      },
      overrideAccess: true,
      req: stageOneReq,
    })
    createdIds.push(created.id)

    const first: CityPartnerDetailsInput = {
      requestId,
      contactPhone: phoneNormalized,
      phoneNormalized,
      organizationName: `integration-a-${suffix}`,
    }
    const second: CityPartnerDetailsInput = {
      ...first,
      organizationName: `integration-b-${suffix}`,
    }

    const results = await Promise.all([
      completePublicCityPartnerDetails({ payload, input: first }),
      completePublicCityPartnerDetails({ payload, input: second }),
    ])
    expect(results.filter((result) => result.kind === 'completed')).toHaveLength(1)
    expect(results.filter((result) => result.kind === 'conflict')).toHaveLength(1)

    const persisted = await payload.findByID({
      collection: 'city-partner-applications',
      id: created.id,
      overrideAccess: true,
      depth: 0,
    })
    expect([first.organizationName, second.organizationName]).toContain(persisted.organizationName)
    expect(persisted.detailsCompletedAt).toBeTruthy()
    expect(persisted.detailsFingerprint).toMatch(/^[a-f0-9]{64}$/)

    const versions = await payload.findVersions({
      collection: 'city-partner-applications',
      where: { parent: { equals: created.id } },
      limit: 20,
      overrideAccess: true,
    })
    expect(versions.docs.some((entry) => Boolean(entry.version.detailsCompletedAt))).toBe(true)
    expect(Object.keys(payload.db.sessions ?? {})).toHaveLength(0)
  })

  it('performs a real authorized workflow update without dropping required facts and writes a version', async () => {
    const cityResult = await payload.find({
      collection: 'locations',
      where: { and: [{ type: { equals: 'city' } }, { status: { equals: 'active' } }] },
      select: { name: true },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const city = cityResult.docs[0]
    expect(city).toBeDefined()
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const stageOneReq = await createLocalReq({
      context: { [CITY_PARTNER_WRITE_STAGE_CONTEXT_KEY]: 'stage-one' },
    }, payload)
    const created = await payload.create({
      collection: 'city-partner-applications',
      data: {
        city: city!.id,
        applicantName: `workflow-${suffix}`,
        contactPhone: '19900001111',
        applicantIdentity: 'local-operations',
        status: 'pending',
        requestId: `workflow-${suffix}`,
        idempotencyKey: `workflow-${randomUUID()}`,
        sourcePath: '/city-partner',
        consentAccepted: true,
        consentPolicyVersion: 'MVP-R1',
      },
      overrideAccess: true,
      req: stageOneReq,
    })
    createdIds.push(created.id)

    const admUsers = await payload.find({
      collection: 'users',
      where: { 'roles.code': { equals: 'ADM' } },
      limit: 1,
      depth: 1,
      overrideAccess: true,
    })
    const admUser = admUsers.docs[0]
    expect(admUser).toBeDefined()
    const workflowReq = await createLocalReq({ user: admUser }, payload)
    const updated = await payload.update({
      collection: 'city-partner-applications',
      id: created.id,
      data: { status: 'contacted' },
      overrideAccess: true,
      req: workflowReq,
    })

    expect(updated).toMatchObject({
      id: created.id,
      city: expect.anything(),
      applicantName: created.applicantName,
      contactPhone: created.contactPhone,
      applicantIdentity: created.applicantIdentity,
      requestId: created.requestId,
      idempotencyKey: created.idempotencyKey,
      sourcePath: '/city-partner',
      consentAccepted: true,
      consentPolicyVersion: 'MVP-R1',
      status: 'contacted',
    })
    const versions = await payload.findVersions({
      collection: 'city-partner-applications',
      where: { parent: { equals: created.id } },
      limit: 20,
      overrideAccess: true,
    })
    expect(versions.docs.some((entry) => entry.version.status === 'contacted')).toBe(true)
  })
})
