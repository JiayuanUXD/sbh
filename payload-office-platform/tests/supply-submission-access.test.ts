import { describe, expect, it } from 'vitest'

import { SupplySubmissions } from '@/collections/SupplySubmissions'
import { ForbiddenError } from '@/domain/shared/errors'
import { protectSupplySubmission } from '@/domain/supply-submission/submission-protect'

function accessRequest(path: string): Record<string, unknown> {
  return {
    url: path,
    user: null,
  }
}

function roleRequest(operationPermissions: string[]): Record<string, unknown> {
  return {
    user: {
      id: 7,
      status: 'active',
      sessionVersion: 1,
      cityScope: [],
      roles: [
        {
          id: 70,
          code: 'CUSTOM',
          status: 'active',
          dataScope: 'global',
          menuPermissions: [],
          operationPermissions,
          fieldPermissions: [],
        },
      ],
    },
    payload: {},
  }
}

async function runCreateAccess(path: string): Promise<unknown> {
  const create = SupplySubmissions.access?.create
  if (typeof create !== 'function') return create
  return create({ req: accessRequest(path) } as never)
}

async function runUpdate(params: {
  data: Record<string, unknown>
  originalDoc: Record<string, unknown>
  operationPermissions?: string[]
  system?: boolean
}): Promise<unknown> {
  return protectSupplySubmission({
    operation: 'update',
    data: params.data,
    originalDoc: params.originalDoc,
    req: params.system ? { user: null, payload: {} } : roleRequest(params.operationPermissions ?? []),
  } as never)
}

describe('SupplySubmissions collection create boundary', () => {
  it.each([
    ['/api/supply-submissions', 'Payload REST'],
    ['/api/graphql', 'Payload GraphQL'],
    ['/admin/collections/supply-submissions/create', 'collection admin'],
  ])('fails closed for anonymous %s create (%s)', async (path) => {
    await expect(runCreateAccess(path)).resolves.toBe(false)
  })
})

describe('SupplySubmissions conversion permission', () => {
  const original = {
    id: 1,
    status: 'contacted',
    convertedListing: null,
    buildingName: 'Test building',
  }

  it('rejects a manage-only actor transitioning status to converted', async () => {
    await expect(
      runUpdate({
        data: { status: 'converted' },
        originalDoc: original,
        operationPermissions: ['supply_submission:manage'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects a manage-only actor changing convertedListing', async () => {
    await expect(
      runUpdate({
        data: { convertedListing: 99 },
        originalDoc: original,
        operationPermissions: ['supply_submission:manage'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects a convert-only actor when overrideAccess bypasses collection update access', async () => {
    await expect(
      runUpdate({
        data: { status: 'converted' },
        originalDoc: original,
        operationPermissions: ['supply_submission:convert'],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('allows an actor with both manage and convert permissions', async () => {
    await expect(
      runUpdate({
        data: { status: 'converted', convertedListing: 99 },
        originalDoc: original,
        operationPermissions: ['supply_submission:manage', 'supply_submission:convert'],
      }),
    ).resolves.toMatchObject({ status: 'converted', convertedListing: 99 })
  })

  it('does not require convert for an unrelated managed update', async () => {
    await expect(
      runUpdate({
        data: { reviewNote: 'checked' },
        originalDoc: original,
        operationPermissions: ['supply_submission:manage'],
      }),
    ).resolves.toMatchObject({ reviewNote: 'checked' })
  })

  it('allows an explicit system Local API update with no authenticated actor', async () => {
    await expect(
      runUpdate({
        data: { status: 'converted', convertedListing: 99 },
        originalDoc: original,
        system: true,
      }),
    ).resolves.toMatchObject({ status: 'converted', convertedListing: 99 })
  })
})
