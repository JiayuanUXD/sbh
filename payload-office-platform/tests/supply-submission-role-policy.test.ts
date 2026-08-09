import { describe, expect, it, vi } from 'vitest'

import { BUILTIN_ROLES } from '@/test/factory/roles'
import {
  planSupplySubmissionRoleUpdate,
  down,
  up,
  type SupplySubmissionMigrationRole,
} from '@/migrations/20260810_090000_supply_submission_role_permissions'

describe('built-in supply submission role matrix', () => {
  it('ADM and OPS can read and write, including conversion', () => {
    expect(BUILTIN_ROLES.ADM.operationPermissions).toEqual(['*'])
    expect(BUILTIN_ROLES.OPS.menuPermissions).toContain('supply-submissions')
    expect(BUILTIN_ROLES.OPS.operationPermissions).toEqual(
      expect.arrayContaining([
        'notification:read',
        'supply_submission:read',
        'supply_submission:manage',
        'supply_submission:convert',
      ]),
    )
  })

  it.each(['MGR', 'BRK'] as const)('%s has read-only access', (code) => {
    expect(BUILTIN_ROLES[code].menuPermissions).toContain('supply-submissions')
    expect(BUILTIN_ROLES[code].operationPermissions).toContain('supply_submission:read')
    expect(BUILTIN_ROLES[code].operationPermissions).not.toContain('supply_submission:manage')
    expect(BUILTIN_ROLES[code].operationPermissions).not.toContain('supply_submission:convert')
  })

  it('CSR has no supply submission menu or operation permission', () => {
    expect(BUILTIN_ROLES.CSR.menuPermissions).not.toContain('supply-submissions')
    expect(BUILTIN_ROLES.CSR.operationPermissions).not.toContain('supply_submission:read')
    expect(BUILTIN_ROLES.CSR.operationPermissions).not.toContain('supply_submission:manage')
    expect(BUILTIN_ROLES.CSR.operationPermissions).not.toContain('supply_submission:convert')
  })
})

describe('supply submission role data migration planner', () => {
  function role(overrides: Partial<SupplySubmissionMigrationRole>): SupplySubmissionMigrationRole {
    return {
      id: 1,
      code: 'OPS',
      isBuiltin: true,
      menuPermissions: ['dashboard', 'custom-menu'],
      operationPermissions: ['notification:read', 'custom:permission'],
      ...overrides,
    }
  }

  it('adds the OPS permissions without removing existing custom permissions', () => {
    const update = planSupplySubmissionRoleUpdate(role({}))

    expect(update).toEqual({
      id: 1,
      menuPermissions: ['dashboard', 'custom-menu', 'supply-submissions'],
      operationPermissions: [
        'notification:read',
        'custom:permission',
        'supply_submission:read',
        'supply_submission:manage',
        'supply_submission:convert',
      ],
    })
  })

  it.each(['MGR', 'BRK'])('adds read-only access for %s', (code) => {
    const update = planSupplySubmissionRoleUpdate(role({ code }))

    expect(update?.menuPermissions).toContain('supply-submissions')
    expect(update?.operationPermissions).toContain('supply_submission:read')
    expect(update?.operationPermissions).not.toContain('supply_submission:manage')
    expect(update?.operationPermissions).not.toContain('supply_submission:convert')
  })

  it.each([
    role({ code: 'ADM' }),
    role({ code: 'CSR' }),
    role({ code: 'OPS', isBuiltin: false }),
  ])('does not modify roles outside the additive target matrix', (document) => {
    expect(planSupplySubmissionRoleUpdate(document)).toBeNull()
  })

  it('is idempotent when every required permission already exists', () => {
    expect(
      planSupplySubmissionRoleUpdate(
        role({
          menuPermissions: ['supply-submissions'],
          operationPermissions: [
            'supply_submission:read',
            'supply_submission:manage',
            'supply_submission:convert',
          ],
        }),
      ),
    ).toBeNull()
  })

  it('updates only changed fields through Payload Local API with overrideAccess', async () => {
    const update = vi.fn(async () => undefined)
    const payload = {
      find: vi.fn(async () => ({ docs: [role({})] })),
      update,
    }

    await up({ payload, req: { id: 'migration-request' } } as never)

    expect(update).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'roles',
        id: 1,
        overrideAccess: true,
        data: expect.objectContaining({
          menuPermissions: ['dashboard', 'custom-menu', 'supply-submissions'],
          operationPermissions: expect.arrayContaining([
            'custom:permission',
            'supply_submission:read',
            'supply_submission:manage',
            'supply_submission:convert',
          ]),
        }),
      }),
    )
  })

  it('uses a non-destructive down path', async () => {
    const info = vi.fn()
    const payload = { logger: { info } }

    await down({ payload } as never)

    expect(info).toHaveBeenCalledWith(expect.stringContaining('intentionally non-destructive'))
  })
})
